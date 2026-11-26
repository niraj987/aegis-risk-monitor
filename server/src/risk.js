import { analyseAnomalies, summariseAnomalies } from "./anomalies.js";
import {
  clamp,
  covariance,
  mean,
  quantile,
  round,
  sampleSd,
} from "./statistics.js";

export const TRADING_DAYS = 252;
export const SIMULATIONS = 10000;
const MAX_CURVE_POINTS = 120;

// --------------------------------------------------------------------------- //
// Distribution helpers
// --------------------------------------------------------------------------- //
export function normalPpf(probability) {
  if (probability <= 0) return -Infinity;
  if (probability >= 1) return Infinity;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --------------------------------------------------------------------------- //
// Core measures
// --------------------------------------------------------------------------- //
export function logReturns(prices) {
  const returns = [];
  for (let index = 1; index < prices.length; index += 1) {
    returns.push(Math.log(prices[index] / prices[index - 1]));
  }
  return returns;
}

export function annualisedVolatility(returns) {
  return sampleSd(returns) * Math.sqrt(TRADING_DAYS);
}

export function annualisedReturn(returns) {
  return Math.expm1(mean(returns) * TRADING_DAYS);
}

export function historicalVar(returns, confidence = 0.95) {
  if (!returns.length) return 0;
  return Math.max(0, -quantile(returns, 1 - confidence));
}

export function historicalVarHorizon(returns, confidence = 0.95, horizon = 5) {
  if (horizon <= 1) return historicalVar(returns, confidence);
  const compounded = [];
  for (let index = horizon - 1; index < returns.length; index += 1) {
    compounded.push(returns.slice(index - horizon + 1, index + 1).reduce((sum, value) => sum + value, 0));
  }
  return historicalVar(compounded, confidence);
}

export function parametricVar(returns, confidence = 0.95) {
  const sd = sampleSd(returns);
  if (!Number.isFinite(sd) || sd <= 0) return 0;
  return Math.max(0, -(mean(returns) + normalPpf(1 - confidence) * sd));
}

export function expectedShortfall(returns, confidence = 0.95) {
  if (!returns.length) return 0;
  const valueAtRisk = historicalVar(returns, confidence);
  const tail = returns.filter((value) => value <= -valueAtRisk);
  if (!tail.length) return valueAtRisk;
  return Math.max(valueAtRisk, -mean(tail));
}

export function drawdownSeries(returns) {
  const drawdowns = [];
  let wealth = 1;
  let peak = 1;
  for (const value of returns) {
    wealth *= 1 + value;
    peak = Math.max(peak, wealth);
    drawdowns.push(wealth / peak - 1);
  }
  return drawdowns;
}

export function riskContributions(weights, matrix) {
  const variance = weights.reduce(
    (sum, weight, row) =>
      sum + weight * weights.reduce((inner, other, column) => inner + other * matrix[row][column], 0),
    0,
  );
  if (variance <= 0) return weights.map(() => 0);
  return weights.map((weight, row) => {
    const marginal = weights.reduce((sum, other, column) => sum + other * matrix[row][column], 0);
    return (weight * marginal) / variance;
  });
}

export function covarianceMatrix(seriesList) {
  return seriesList.map((row) => seriesList.map((column) => covariance(row, column)));
}

function cholesky(matrix) {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row][column];
      for (let k = 0; k < column; k += 1) sum -= lower[row][k] * lower[column][k];
      if (row === column) {
        lower[row][column] = Math.sqrt(Math.max(sum, 1e-14));
      } else {
        lower[row][column] = sum / lower[column][column];
      }
    }
  }
  return lower;
}

export function monteCarloVar(assetReturns, weights, confidence = 0.95, simulations = SIMULATIONS, seed = 42) {
  if (!assetReturns.length) return 0;
  const size = assetReturns.length;
  const means = assetReturns.map((series) => mean(series));
  const matrix = covarianceMatrix(assetReturns);
  for (let index = 0; index < size; index += 1) matrix[index][index] += 1e-10;
  const lower = cholesky(matrix);
  const random = seededRandom(seed);
  const losses = [];

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const draws = new Array(size);
    for (let row = 0; row < size; row += 1) {
      let value = means[row];
      for (let column = 0; column <= row; column += 1) {
        value += lower[row][column] * gaussian(random);
      }
      draws[row] = value;
    }
    let portfolioReturn = 0;
    for (let index = 0; index < size; index += 1) {
      portfolioReturn += draws[index] * weights[index];
    }
    losses.push(-portfolioReturn);
  }

  return Math.max(0, quantile(losses, confidence));
}

// --------------------------------------------------------------------------- //
// Limit evaluation, health and stress
// --------------------------------------------------------------------------- //
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function evaluateLimits(metrics, limits, anomalySummary) {
  const breaches = [];
  const add = (code, severity, metric, observed, limit, message, unit = "%") =>
    breaches.push({ code, severity, metric, observed: round(observed, 3), limit: round(limit, 3), unit, message });

  const varPct = metrics.var_95_1d * 100;
  if (varPct > limits.var_95_limit_pct) {
    add(
      "VAR_LIMIT",
      varPct > limits.var_95_limit_pct * 1.2 ? "critical" : "high",
      "1-day VaR (95%)",
      varPct,
      limits.var_95_limit_pct,
      `A single bad day at 95% confidence could cost ${varPct.toFixed(2)}% of NAV, above the ${limits.var_95_limit_pct.toFixed(2)}% budget.`,
    );
  }

  const volPct = metrics.ann_vol * 100;
  if (volPct > limits.ann_vol_limit_pct) {
    add(
      "VOL_LIMIT",
      volPct > limits.ann_vol_limit_pct * 1.25 ? "high" : "medium",
      "Annualised volatility",
      volPct,
      limits.ann_vol_limit_pct,
      `Portfolio volatility is ${volPct.toFixed(1)}% a year versus a ${limits.ann_vol_limit_pct.toFixed(1)}% budget.`,
    );
  }

  const drawdownPct = Math.abs(metrics.current_drawdown) * 100;
  if (drawdownPct > limits.max_drawdown_limit_pct) {
    add(
      "DRAWDOWN_LIMIT",
      drawdownPct > limits.max_drawdown_limit_pct * 1.5 ? "critical" : "high",
      "Drawdown from peak",
      drawdownPct,
      limits.max_drawdown_limit_pct,
      `The portfolio sits ${drawdownPct.toFixed(1)}% below its peak, beyond the ${limits.max_drawdown_limit_pct.toFixed(1)}% limit.`,
    );
  }

  const movePct = Math.abs(Math.min(0, metrics.latest_return)) * 100;
  if (movePct > limits.daily_move_limit_pct) {
    add(
      "DAILY_MOVE",
      movePct > limits.daily_move_limit_pct * 1.5 ? "high" : "medium",
      "Latest session move",
      movePct,
      limits.daily_move_limit_pct,
      `The latest session lost ${movePct.toFixed(2)}%, above the ${limits.daily_move_limit_pct.toFixed(2)}% single-day budget.`,
    );
  }

  const topPct = metrics.top_weight * 100;
  if (topPct > limits.concentration_limit_pct) {
    add(
      "CONCENTRATION",
      "medium",
      "Largest position",
      topPct,
      limits.concentration_limit_pct,
      `The largest position is ${topPct.toFixed(1)}% of NAV, above the ${limits.concentration_limit_pct.toFixed(1)}% guideline.`,
    );
  }

  if (anomalySummary.symbols.length) {
    add(
      "UNUSUAL_ACTIVITY",
      "low",
      "Assets with unusual moves",
      anomalySummary.symbols.length,
      anomalySummary.symbols.length,
      `Unusual price behaviour in ${anomalySummary.symbols.slice(0, 4).join(", ")}.`,
      "count",
    );
  }

  return breaches.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

function scoreHealth(breaches) {
  const penalty = { critical: 35, high: 20, medium: 12, low: 5 };
  const score = clamp(100 - breaches.reduce((sum, item) => sum + (penalty[item.severity] ?? 8), 0), 5, 100);
  let status = "normal";
  if (breaches.some((item) => item.severity === "critical")) status = "breach";
  else if (breaches.length) status = "watch";
  return { score, status };
}

/** Linear factor-model stress test: portfolio P&L for a market-wide shock. */
export function stressScenario(snapshot, shockPct) {
  const shock = Number(shockPct) / 100;
  const nav = snapshot.metrics.portfolio_value;
  const impacts = snapshot.assets.map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
    weight: asset.weight,
    beta: asset.beta,
    impact_usd: round(asset.weight * asset.beta * shock * nav, 2),
    asset_return_pct: round(asset.beta * shock * 100, 2),
  }));
  const estimatedPnl = impacts.reduce((sum, item) => sum + item.impact_usd, 0);
  const portfolioBeta = impacts.reduce((sum, item) => sum + item.weight * item.beta, 0);
  const lossPct = Math.max(0, -estimatedPnl) / nav * 100;
  const budget = snapshot.metrics.daily_move_limit_pct ?? 3;

  return {
    market_shock_pct: Number(shockPct),
    portfolio_beta: round(portfolioBeta, 2),
    estimated_pnl: round(estimatedPnl, 2),
    estimated_return_pct: round((estimatedPnl / nav) * 100, 2),
    projected_value: round(nav + estimatedPnl, 2),
    loss_pct_of_nav: round(lossPct, 2),
    daily_budget_pct: budget,
    budget_used_pct: round((lossPct / budget) * 100, 1),
    impacts: impacts.sort((a, b) => a.impact_usd - b.impact_usd),
  };
}

// --------------------------------------------------------------------------- //
// Snapshot assembly
// --------------------------------------------------------------------------- //
function downsample(dates, values, scale = 1, digits = 3) {
  const step = Math.max(1, Math.ceil(dates.length / MAX_CURVE_POINTS));
  const points = [];
  for (let index = dates.length - 1; index >= 0; index -= step) {
    points.unshift({ date: dates[index], value: round(values[index] * scale, digits) });
  }
  return points;
}

export function buildSnapshot({ frame, portfolio, portfolioValue, limits, seed = 42 }) {
  const holdings = portfolio.filter((item) => Array.isArray(frame.close[item.symbol]));
  if (holdings.length < 2) throw new Error("Portfolio needs at least two symbols with price history");

  const length = frame.dates.length;
  const returnDates = frame.dates.slice(1);
  if (length < 61) throw new Error("At least 60 shared price observations are required");

  const assetReturns = holdings.map((item) => logReturns(frame.close[item.symbol]));
  const totalWeight = holdings.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  const weights = holdings.map((item) => Math.max(0, Number(item.weight) || 0) / totalWeight);

  const portfolioReturns = assetReturns[0].map((_, session) =>
    assetReturns.reduce((sum, series, index) => sum + weights[index] * series[session], 0),
  );

  // Note: the local matrix must not shadow the imported covariance() helper.
  const covarianceValues = covarianceMatrix(assetReturns);
  const contributions = riskContributions(weights, covarianceValues);
  const drawdowns = drawdownSeries(portfolioReturns);
  const latestReturn = portfolioReturns.at(-1) ?? 0;

  const var95 = historicalVar(portfolioReturns, 0.95);
  const var99 = historicalVar(portfolioReturns, 0.99);
  const es95 = expectedShortfall(portfolioReturns, 0.95);
  const es99 = expectedShortfall(portfolioReturns, 0.99);
  const var95FiveDay = historicalVarHorizon(portfolioReturns, 0.95, 5);

  const marketProxy = assetReturns[0].map((_, session) =>
    assetReturns.reduce((sum, series) => sum + series[session], 0) / assetReturns.length,
  );
  const marketVariance = covariance(marketProxy, marketProxy);

  const metrics = {
    observations: portfolioReturns.length,
    portfolio_value: Number(portfolioValue),
    latest_return: round(latestReturn),
    ann_return: round(annualisedReturn(portfolioReturns)),
    ann_vol: round(annualisedVolatility(portfolioReturns)),
    var_95_1d: round(var95),
    var_99_1d: round(var99),
    var_95_5d: round(var95FiveDay),
    es_95_1d: round(es95),
    es_99_1d: round(es99),
    parametric_var_95: round(parametricVar(portfolioReturns, 0.95)),
    monte_carlo_var_95: round(monteCarloVar(assetReturns, weights, 0.95, SIMULATIONS, seed)),
    var_95_usd: round(var95 * portfolioValue, 2),
    es_95_usd: round(es95 * portfolioValue, 2),
    var_95_5d_usd: round(var95FiveDay * portfolioValue, 2),
    current_drawdown: round(drawdowns.at(-1) ?? 0),
    max_drawdown: round(Math.min(...drawdowns)),
    worst_day: round(Math.min(...portfolioReturns)),
    best_day: round(Math.max(...portfolioReturns)),
    hhi: round(weights.reduce((sum, weight) => sum + weight ** 2, 0), 4),
    top_weight: round(Math.max(...weights), 4),
    daily_move_limit_pct: limits.daily_move_limit_pct,
    portfolio_beta: 0,
  };
  // Per-asset betas are computed below; the portfolio beta is their weighted sum.

  const anomalies = analyseAnomalies(
    Object.fromEntries(holdings.map((item, index) => [item.symbol, assetReturns[index]])),
  );
  const anomalySummary = summariseAnomalies(anomalies);

  const assets = holdings.map((item, index) => {
    const beta = marketVariance > 0 ? covariance(assetReturns[index], marketProxy) / marketVariance : 0;
    const row = anomalies[item.symbol];
    return {
      symbol: item.symbol,
      name: item.name || item.symbol,
      sector: item.sector || "Diversified",
      weight: round(weights[index], 4),
      price: round(frame.close[item.symbol].at(-1), 2),
      last_return: round(assetReturns[index].at(-1) ?? 0),
      ann_vol: round(annualisedVolatility(assetReturns[index])),
      risk_share: round(contributions[index], 4),
      var_contribution: round(contributions[index] * var95),
      beta: round(beta, 2),
      zscore: row.zscore,
      vol_ratio: row.vol_ratio,
      anomaly_score: row.anomaly_score,
      flag: row.flag,
      note: row.note,
    };
  });
  assets.sort((a, b) => b.risk_share - a.risk_share);
  metrics.portfolio_beta = round(
    assets.reduce((sum, asset) => sum + asset.weight * asset.beta, 0),
    2,
  );

  const breaches = evaluateLimits(metrics, limits, anomalySummary);
  const health = scoreHealth(breaches);

  const equity = [];
  let wealth = 100;
  for (const value of portfolioReturns) {
    wealth *= 1 + value;
    equity.push(wealth);
  }

  const riskCurve = [];
  for (let index = 59; index < portfolioReturns.length; index += 1) {
    const window = portfolioReturns.slice(index - 59, index + 1);
    riskCurve.push({
      date: returnDates[index],
      var_95: round(historicalVar(window, 0.95)),
      es_95: round(expectedShortfall(window, 0.95)),
    });
  }

  const sectors = {};
  for (const item of holdings) {
    const sector = item.sector || "Diversified";
    sectors[sector] = round((sectors[sector] || 0) + (Number(item.weight) || 0), 4);
  }

  return {
    as_of: frame.dates.at(-1),
    data_source: frame.source,
    fetched_at: frame.fetchedAt,
    metrics,
    assets,
    breaches,
    health,
    portfolio: {
      value: Number(portfolioValue),
      weights: Object.fromEntries(assets.map((asset) => [asset.symbol, asset.weight])),
      sectors,
    },
    anomalies: anomalySummary,
    curves: {
      equity: downsample(returnDates, equity, 1, 2),
      drawdown: downsample(returnDates, drawdowns, 100, 2),
      risk: riskCurve.slice(-MAX_CURVE_POINTS),
    },
  };
}
