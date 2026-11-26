import { useState } from "react";
import { money, pct, statusLabel } from "../format";
import { useCountUp } from "../hooks";
import { AreaChart, RiskBars } from "./Charts";
import { Activity, AlertTriangle, Gauge, Layers, Shield } from "./Icons";
import SectionHeader from "./SectionHeader";

function MetricCard({ icon, label, hint, value, format, sub, meter, delay = 0 }) {
  const animated = useCountUp(value);
  const display = Number.isFinite(Number(value)) ? format(animated) : "—";

  return (
    <article className="card metric-card" data-reveal style={{ "--delay": `${delay}ms` }}>
      <div className="metric-head">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
        <span className="info-dot" title={hint} aria-label={hint}>
          ?
        </span>
      </div>
      <p className="metric-value">{display}</p>
      <p className="metric-sub">{sub}</p>
      {meter ? (
        <div className="meter-block">
          <div className="meter" aria-hidden="true">
            <span
              style={{
                "--value": `${Math.min(100, Math.max(0, meter.pct))}%`,
                background: meter.color,
              }}
            />
          </div>
          <span className="meter-label">{meter.label}</span>
        </div>
      ) : null}
    </article>
  );
}

function meterTone(ratio) {
  if (ratio > 1) return "var(--red)";
  if (ratio > 0.8) return "var(--amber)";
  return "var(--accent)";
}

export default function RiskSection({ snapshot, limits }) {
  const [view, setView] = useState("var");
  const metrics = snapshot.metrics;
  const health = snapshot.health;
  const riskSeries = snapshot.curves.risk ?? [];
  const valueKey = view === "var" ? "var_95" : "es_95";
  const limit = view === "var" ? limits.var_95_limit_pct / 100 : null;

  const varRatio = metrics.var_95_1d / (limits.var_95_limit_pct / 100);
  const volRatio = metrics.ann_vol / (limits.ann_vol_limit_pct / 100);
  const drawdownRatio =
    Math.abs(metrics.current_drawdown) / (limits.max_drawdown_limit_pct / 100);

  const cards = [
    {
      icon: <Gauge size={17} />,
      label: "1-day VaR · 95%",
      hint: "The loss exceeded on one day in twenty, based on the last three years of returns.",
      value: metrics.var_95_1d,
      format: (value) => pct(value),
      sub: `${money(metrics.var_95_usd)} of ${money(metrics.portfolio_value)} NAV · 5-day ${pct(
        metrics.var_95_5d,
      )}`,
      meter: {
        pct: varRatio * 100,
        color: meterTone(varRatio),
        label: `${pct(limits.var_95_limit_pct / 100)} budget used`,
      },
    },
    {
      icon: <Activity size={17} />,
      label: "Expected shortfall",
      hint: "The average loss on the bad days that sit beyond VaR. It answers: if the limit breaks, how bad is it?",
      value: metrics.es_95_1d,
      format: (value) => pct(value),
      sub: `${money(metrics.es_95_usd)} average tail loss · 99% ${pct(metrics.es_99_1d)}`,
    },
    {
      icon: <Layers size={17} />,
      label: "Annual volatility",
      hint: "How much the portfolio value tends to swing in a year, from daily returns annualised.",
      value: metrics.ann_vol,
      format: (value) => pct(value, 1),
      sub: `${pct(metrics.ann_return, 1)} annualised return over the window`,
      meter: {
        pct: volRatio * 100,
        color: meterTone(volRatio),
        label: `${pct(limits.ann_vol_limit_pct / 100)} budget used`,
      },
    },
    {
      icon: <AlertTriangle size={17} />,
      label: "Drawdown from peak",
      hint: "How far the portfolio has fallen from its highest point. It measures pain already taken, not a forecast.",
      value: Math.abs(metrics.current_drawdown),
      format: (value) => pct(value),
      sub: `Worst peak-to-trough in the window: ${pct(Math.abs(metrics.max_drawdown))}`,
      meter: {
        pct: drawdownRatio * 100,
        color: meterTone(drawdownRatio),
        label: `${pct(limits.max_drawdown_limit_pct / 100)} limit`,
      },
    },
    {
      icon: <Shield size={17} />,
      label: "Risk health",
      hint: "A simple 0–100 score that subtracts points for each breached rule. It is a summary, not a verdict.",
      value: health.score,
      format: (value) => `${Math.round(value)}`,
      sub: `${statusLabel(health.status)} · ${snapshot.breaches.length} rule${
        snapshot.breaches.length === 1 ? "" : "s"
      } breached`,
      meter: {
        pct: health.score,
        color: health.score >= 80 ? "var(--accent)" : health.score >= 60 ? "var(--amber)" : "var(--red)",
        label: "of 100",
      },
    },
  ];

  return (
    <section className="section" id="risk">
      <div className="container">
        <SectionHeader
          eyebrow="Live risk"
          title="The numbers behind the alert"
          description="Measured every cycle from three years of daily returns. Hover any chart to inspect a value."
          aside={
            <span className={`health-badge health-${health.status}`}>
              {statusLabel(health.status)} · {health.score}/100
            </span>
          }
        />

        <div className="metric-grid">
          {cards.map((card, index) => (
            <MetricCard key={card.label} {...card} delay={index * 60} />
          ))}
        </div>

        <div className="chart-grid">
          <article className="card chart-card" data-reveal>
            <header className="card-head chart-head">
              <div>
                <h3>Risk trend</h3>
                <p>Rolling 60-session estimate, refreshed with every cycle.</p>
              </div>
              <div className="segmented" role="tablist" aria-label="Risk measure">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "var"}
                  className={view === "var" ? "is-active" : ""}
                  onClick={() => setView("var")}
                >
                  VaR 95%
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "es"}
                  className={view === "es" ? "is-active" : ""}
                  onClick={() => setView("es")}
                >
                  Expected shortfall
                </button>
              </div>
            </header>

            <div className="chart-figure">
              <AreaChart
                data={riskSeries}
                valueKey={valueKey}
                limit={limit}
                color={view === "var" ? "#0f6f5c" : "#3d6b8f"}
                label={view === "var" ? "Value at risk trend" : "Expected shortfall trend"}
                format={(value) => pct(value)}
              />
            </div>

            <footer className="card-foot">
              <span>
                <i
                  className="legend-dot"
                  style={{ background: view === "var" ? "#0f6f5c" : "#3d6b8f" }}
                />
                {view === "var" ? "VaR 95%" : "Expected shortfall"}
              </span>
              {limit ? (
                <span>
                  <i className="legend-dash" /> limit {pct(limit)}
                </span>
              ) : null}
              <span className="muted">{metrics.observations} sessions of history</span>
            </footer>
          </article>

          <article className="card contribution-card" data-reveal style={{ "--delay": "90ms" }}>
            <header className="card-head">
              <div>
                <h3>Where the risk sits</h3>
                <p>Each position's share of portfolio variance.</p>
              </div>
            </header>
            <RiskBars assets={snapshot.assets} />
            <footer className="card-foot">
              <span className="muted">
                Largest contributor: {snapshot.assets[0]?.symbol} ·{" "}
                {pct(snapshot.assets[0]?.risk_share ?? 0, 0)} of total risk
              </span>
            </footer>
          </article>
        </div>
      </div>
    </section>
  );
}
