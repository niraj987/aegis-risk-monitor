import { llmEnabled, settings } from "./config.js";
import { utcNow } from "./db.js";
import { loadPrices } from "./market.js";
import { buildSnapshot } from "./risk.js";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const ACTIONS_BY_CODE = {
  VAR_LIMIT: [
    "Review the largest risk contributors and decide whether the exposure still matches the mandate.",
    "Re-run the check after any rebalance so the audit trail shows the effect.",
  ],
  VOL_LIMIT: [
    "Check whether the volatility rise is broad or driven by one or two names.",
    "Confirm the risk budget with the desk before changing anything.",
  ],
  DRAWDOWN_LIMIT: [
    "Escalate to the risk committee and confirm the drawdown limit still fits the mandate.",
    "Document the decision in the audit log, including who reviewed it.",
  ],
  DAILY_MOVE: [
    "Verify the move against news or earnings before reacting to a single session.",
    "Compare the move with the model's expected 1-day loss range.",
  ],
  CONCENTRATION: [
    "Agree a plan to bring the largest position back toward the concentration guideline.",
    "Check that the position is intentional rather than drift from price moves.",
  ],
  UNUSUAL_ACTIVITY: [
    "Inspect the flagged names before changing weights; unusual moves can be data noise.",
    "Confirm the price feed is complete and correctly adjusted.",
  ],
};

const ALWAYS_ACTION = "A human reviewer must approve any trade, hedge or limit change.";

const ALERT_TITLES = {
  VAR_LIMIT: "Value-at-Risk above budget",
  VOL_LIMIT: "Volatility running above budget",
  DRAWDOWN_LIMIT: "Drawdown limit breached",
  DAILY_MOVE: "Sharp single-session loss",
  CONCENTRATION: "Position concentration above guideline",
  UNUSUAL_ACTIVITY: "Unusual price behaviour detected",
};

const percent = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const usd = (value) => `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// --------------------------------------------------------------------------- //
// Deterministic narration
// --------------------------------------------------------------------------- //
export function ruleBasedExplanation(snapshot, limits, note = null) {
  const metrics = snapshot.metrics;
  const breaches = snapshot.breaches;
  const top = snapshot.assets[0];
  const flagged = snapshot.anomalies.symbols;
  const positions = `${flagged.length} position${flagged.length === 1 ? "" : "s"}`;
  const primary = breaches.find((item) => item.unit === "%");
  let headline;
  let narrative;

  if (breaches.length) {
    if (primary) {
      headline = `${breaches.length} risk limit${breaches.length === 1 ? "" : "s"} ${
        breaches.length === 1 ? "needs" : "need"
      } a human decision`;
      narrative =
        `As of ${snapshot.as_of}, ${primary.metric.toLowerCase()} is ${primary.observed}% against a ` +
        `${primary.limit}% limit. The portfolio's 1-day 95% VaR is ${percent(metrics.var_95_1d)} of NAV ` +
        `(${usd(metrics.var_95_usd)}), and expected shortfall — the average loss when that tail is breached — ` +
        `is ${percent(metrics.es_95_1d)} (${usd(metrics.es_95_usd)}). `;
    } else {
      headline = `${positions} ${flagged.length === 1 ? "needs" : "need"} a closer look`;
      narrative =
        `As of ${snapshot.as_of}, every market-risk limit is intact, but ${positions} ` +
        `${flagged.length === 1 ? "shows" : "show"} unusual price behaviour. The portfolio's 1-day 95% VaR ` +
        `is ${percent(metrics.var_95_1d)} of NAV (${usd(metrics.var_95_usd)}), and expected shortfall is ` +
        `${percent(metrics.es_95_1d)} (${usd(metrics.es_95_usd)}). `;
    }
    if (top) {
      narrative += `${top.symbol} is the largest risk contributor at ${(top.risk_share * 100).toFixed(0)}% of total risk. `;
      if (primary && flagged.length) {
        narrative += `${positions} also ${flagged.length === 1 ? "shows" : "show"} unusual price behaviour. `;
      }
    }
    narrative +=
      "These are measured risks, not forecasts, and nothing here authorises a trade. A human reviewer owns the decision.";
  } else {
    headline = "Inside the agreed risk appetite";
    narrative =
      `Across the last ${metrics.observations} sessions to ${snapshot.as_of}, the portfolio's 1-day 95% VaR ` +
      `is ${percent(metrics.var_95_1d)} of NAV (${usd(metrics.var_95_usd)}) and expected shortfall is ` +
      `${percent(metrics.es_95_1d)}. Annualised volatility of ${percent(metrics.ann_vol)} and a drawdown of ` +
      `${(Math.abs(metrics.current_drawdown) * 100).toFixed(1)}% from the peak are within the limits set for this portfolio.`;
    if (top) narrative += ` ${top.symbol} carries the most risk at ${(top.risk_share * 100).toFixed(0)}% of the total.`;
  }

  const actions = [];
  for (const breach of breaches) {
    for (const action of ACTIONS_BY_CODE[breach.code] || []) {
      if (!actions.includes(action)) actions.push(action);
    }
  }
  if (!actions.length) {
    actions.push("No action required; keep the scheduled monitoring cycle running.");
    actions.push("Revisit the limits if the portfolio or mandate changes.");
  }
  actions.push(ALWAYS_ACTION);

  return {
    headline,
    narrative,
    actions: actions.slice(0, 5),
    mode: "rule-based",
    model: null,
    note,
    generated_at: snapshot.as_of,
  };
}

// --------------------------------------------------------------------------- //
// Optional LLM narration
// --------------------------------------------------------------------------- //
const SYSTEM_PROMPT =
  "You are a market-risk analyst assistant inside a portfolio monitoring tool. " +
  "Explain the supplied risk snapshot in plain business English for a portfolio manager. " +
  "Use only the numbers provided. Do not recommend specific trades, position sizes or limit changes. " +
  "Do not claim certainty or predict prices. Keep the narrative to 3-4 sentences and give 2-4 " +
  "short next steps for a human reviewer. Return ONLY JSON with the keys " +
  '"headline" (max 8 words), "narrative" (string), "actions" (array of short strings).';

function evidence(snapshot, limits) {
  const metrics = snapshot.metrics;
  return {
    as_of: snapshot.as_of,
    data_source: snapshot.data_source,
    portfolio_value: metrics.portfolio_value,
    risk_metrics_pct_of_nav: {
      var_95_1d: Number((metrics.var_95_1d * 100).toFixed(3)),
      var_99_1d: Number((metrics.var_99_1d * 100).toFixed(3)),
      var_95_5d: Number((metrics.var_95_5d * 100).toFixed(3)),
      expected_shortfall_95_1d: Number((metrics.es_95_1d * 100).toFixed(3)),
      annualised_volatility: Number((metrics.ann_vol * 100).toFixed(3)),
      current_drawdown: Number((metrics.current_drawdown * 100).toFixed(3)),
      latest_session_return: Number((metrics.latest_return * 100).toFixed(3)),
    },
    limits_pct: limits,
    breaches: snapshot.breaches,
    top_risk_contributors: snapshot.assets.slice(0, 4).map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      risk_share_pct: Number((asset.risk_share * 100).toFixed(1)),
      weight_pct: Number((asset.weight * 100).toFixed(1)),
    })),
    unusual_activity: snapshot.anomalies.details,
    health_score: snapshot.health,
  };
}

function parseModelJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const payload = JSON.parse(match[0]);
    if (!payload?.headline || !payload?.narrative) return null;
    payload.actions = Array.isArray(payload.actions) ? payload.actions.map(String).slice(0, 4) : [];
    return payload;
  } catch {
    return null;
  }
}

export async function narrate(snapshot, limits) {
  const fallback = ruleBasedExplanation(snapshot, limits);
  if (!llmEnabled()) return fallback;

  try {
    const response = await fetch(`${settings.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.llmModel,
        temperature: 0.2,
        max_tokens: 650,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Risk snapshot:\n${JSON.stringify(evidence(snapshot, limits), null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(settings.llmTimeoutMs),
    });
    if (!response.ok) throw new Error(`LLM responded ${response.status}`);

    const body = await response.json();
    const parsed = parseModelJson(body?.choices?.[0]?.message?.content || "");
    if (!parsed) {
      return ruleBasedExplanation(snapshot, limits, "The model reply was not valid JSON; rule-based note used.");
    }
    return {
      headline: String(parsed.headline).slice(0, 90),
      narrative: String(parsed.narrative),
      actions: [...parsed.actions, ALWAYS_ACTION].slice(0, 5),
      mode: "llm",
      model: settings.llmModel,
      note: null,
      generated_at: snapshot.as_of,
    };
  } catch (error) {
    return ruleBasedExplanation(
      snapshot,
      limits,
      `LLM call unavailable (${error.name || "error"}); rule-based note used.`,
    );
  }
}

// --------------------------------------------------------------------------- //
// Workflow nodes
// --------------------------------------------------------------------------- //
function addStep(trace, node, label, detail, started, status = "done", tool = null) {
  trace.push({
    node,
    label,
    status,
    detail,
    tool,
    at: utcNow(),
    duration_ms: Math.round(performance.now() - started),
  });
}

export async function monitorNode(portfolio, limits) {
  const symbols = portfolio.map((item) => item.symbol);
  const sectors = Object.fromEntries(portfolio.map((item) => [item.symbol, item.sector || "Diversified"]));
  const frame = await loadPrices(symbols, sectors, settings.historyDays);
  const snapshot = buildSnapshot({
    frame,
    portfolio,
    portfolioValue: settings.portfolioValue,
    limits,
    seed: settings.randomSeed,
  });
  snapshot.fetched_at = frame.fetchedAt;
  return {
    snapshot,
    detail:
      `Loaded ${snapshot.metrics.observations} sessions to ${snapshot.as_of} from ${frame.source}. ` +
      `1-day 95% VaR is ${(snapshot.metrics.var_95_1d * 100).toFixed(2)}% of NAV.`,
  };
}

function investigateNode(snapshot) {
  const contributors = snapshot.assets.slice(0, 3).map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
    risk_share: asset.risk_share,
    weight: asset.weight,
  }));
  const findings = {
    breach_count: snapshot.breaches.length,
    severity: snapshot.breaches.length
      ? [...snapshot.breaches].sort(
          (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
        )[0].severity
      : "none",
    top_contributors: contributors,
    anomaly_count: snapshot.anomalies.count,
    anomaly_symbols: snapshot.anomalies.symbols,
    latest_return: snapshot.metrics.latest_return,
    worst_day: snapshot.metrics.worst_day,
  };

  const detail = snapshot.breaches.length
    ? `Checked the evidence against ${snapshot.breaches.length} limit rule${snapshot.breaches.length === 1 ? "" : "s"}. ` +
      `The largest risk contributor is ${contributors[0].symbol} ` +
      `(${(contributors[0].risk_share * 100).toFixed(0)}% of total risk); ` +
      `${snapshot.anomalies.count} position${snapshot.anomalies.count === 1 ? "" : "s"} ` +
      `${snapshot.anomalies.count === 1 ? "shows" : "show"} unusual behaviour.`
    : `Checked every limit rule: no breaches. ${snapshot.anomalies.count} position(s) show unusual behaviour ` +
      "that remains within appetite.";

  return { findings, detail };
}

export function buildAlerts({ runId, snapshot, actions, trace }) {
  const top = snapshot.assets.slice(0, 3).map((asset) => ({
    symbol: asset.symbol,
    risk_share: asset.risk_share,
    weight: asset.weight,
  }));

  const alerts = snapshot.breaches.map((breach) => {
    const isCount = breach.unit === "count";
    const alertEvidence = {
      metric: breach.metric,
      observed_pct: breach.observed,
      limit_pct: breach.limit,
      observed_label: isCount
        ? `${Math.round(breach.observed)} position${breach.observed === 1 ? "" : "s"}`
        : `${breach.observed.toFixed(2)}%`,
      limit_label: isCount ? "No fixed limit" : `${breach.limit.toFixed(2)}%`,
      as_of: snapshot.as_of,
      data_source: snapshot.data_source,
      health_score: snapshot.health.score,
      top_risk_contributors: top,
    };
    if (breach.code === "UNUSUAL_ACTIVITY") alertEvidence.flagged = snapshot.anomalies.details;

    return {
      run_id: runId,
      created_at: utcNow(),
      severity: breach.severity,
      code: breach.code,
      title: ALERT_TITLES[breach.code] || breach.metric,
      message: breach.message,
      evidence: alertEvidence,
      actions,
      trace,
    };
  });

  return alerts.sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** The five-node cycle: monitor, investigate, explain, recommend, human review. */
export async function executeWorkflow({ portfolio, limits, runId }) {
  const trace = [];

  let started = performance.now();
  const { snapshot, detail: monitorDetail } = await monitorNode(portfolio, limits);
  addStep(trace, "monitor", "Monitor", monitorDetail, started, "done", "market data + risk engine");

  started = performance.now();
  const { findings, detail: investigateDetail } = investigateNode(snapshot);
  addStep(trace, "investigate", "Investigate", investigateDetail, started, "done", "anomaly detector");

  started = performance.now();
  let explanation;
  let explainDetail;
  if (snapshot.breaches.length) {
    explanation = await narrate(snapshot, limits);
    explainDetail =
      `Explained the ${findings.breach_count} ${findings.breach_count === 1 ? "breach" : "breaches"} ` +
      `in plain English using the ${explanation.mode} narrative.`;
  } else {
    explanation = ruleBasedExplanation(snapshot, limits);
    explainDetail = "No breach, so a short status note was recorded instead of an alert explanation.";
  }
  addStep(trace, "explain", "Explain", explainDetail, started, "done", explanation.model || "deterministic template");

  started = performance.now();
  const actions = explanation.actions || [];
  addStep(
    trace,
    "recommend",
    "Recommend",
    `Prepared ${actions.length} suggested next step(s). Nothing is executed automatically; the queue waits for a human reviewer.`,
    started,
  );

  started = performance.now();
  const alerts = buildAlerts({ runId, snapshot, actions, trace });
  const reviewStatus = alerts.length ? "awaiting_review" : "clear";
  addStep(
    trace,
    "human_review",
    "Human review",
    alerts.length
      ? `Queued ${alerts.length} alert(s) for human review. No position, hedge or limit was changed automatically.`
      : "Result is within appetite; nothing queued for review.",
    started,
    reviewStatus,
  );

  return { snapshot, findings, explanation, actions, alerts, trace };
}
