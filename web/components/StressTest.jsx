"use client";

import { useState } from "react";
import { money, pct } from "../lib/format";
import SectionHeader from "./SectionHeader";

const PRESETS = [-20, -10, -5, 5];

export default function StressTest({ snapshot, limits }) {
  const [shock, setShock] = useState(-10);
  const nav = snapshot.metrics.portfolio_value;
  const shockFraction = shock / 100;

  const impacts = [...snapshot.assets]
    .map((asset) => ({
      ...asset,
      impact_usd: asset.weight * asset.beta * shockFraction * nav,
    }))
    .sort((a, b) => a.impact_usd - b.impact_usd);

  const estimatedPnl = impacts.reduce((sum, asset) => sum + asset.impact_usd, 0);
  const lossPct = (Math.max(0, -estimatedPnl) / nav) * 100;
  const budget = limits.daily_move_limit_pct;
  const budgetUsed = budget > 0 ? (lossPct / budget) * 100 : 0;
  const maxImpact = Math.max(...impacts.map((asset) => Math.abs(asset.impact_usd)), 1);
  const negative = estimatedPnl < 0;

  return (
    <section className="section" id="scenarios">
      <div className="container">
        <SectionHeader
          eyebrow="Scenarios"
          title="What if the market moves?"
          description="A one-day, market-wide shock applied through each position's beta. A quick sense of direction and size, not a forecast."
          aside={
            <span className="pill pill-neutral">
              Portfolio beta {Number(snapshot.metrics.portfolio_beta ?? 0).toFixed(2)}
            </span>
          }
        />

        <div className="stress-grid">
          <article className="card stress-card" data-reveal>
            <div className="stress-controls">
              <div className="stress-head">
                <h3>Market shock</h3>
                <strong className={negative ? "neg" : "pos"}>
                  {shock > 0 ? "+" : ""}
                  {shock}%
                </strong>
              </div>
              <input
                className="stress-range"
                type="range"
                min="-30"
                max="10"
                step="1"
                value={shock}
                onChange={(event) => setShock(Number(event.target.value))}
                aria-label="Market shock in percent"
              />
              <div className="stress-presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`chip ${shock === preset ? "is-active" : ""}`}
                    onClick={() => setShock(preset)}
                  >
                    {preset > 0 ? "+" : ""}
                    {preset}%
                  </button>
                ))}
              </div>
              <p className="fineprint">
                Estimated with factor betas from the latest cycle. It ignores correlations moving
                together under stress, so treat it as a floor rather than a worst case.
              </p>
            </div>

            <div className="stress-results">
              <div className="stress-pnl">
                <span>Estimated P&amp;L</span>
                <strong className={negative ? "neg" : "pos"}>{money(estimatedPnl)}</strong>
                <em>
                  {pct(estimatedPnl / nav)} of NAV · projected {money(nav + estimatedPnl)}
                </em>
              </div>
              <div className="stress-budget">
                <span>Single-day loss budget</span>
                <strong>{pct(budget / 100)}</strong>
                <em>{budgetUsed.toFixed(0)}% consumed by this scenario</em>
              </div>
              <div className="meter" aria-hidden="true">
                <span
                  style={{
                    "--value": `${Math.min(100, Math.max(0, budgetUsed))}%`,
                    background:
                      budgetUsed > 100 ? "var(--red)" : budgetUsed > 60 ? "var(--amber)" : "var(--accent)",
                  }}
                />
              </div>
            </div>
          </article>

          <article className="card impact-card" data-reveal style={{ "--delay": "80ms" }}>
            <header className="card-head">
              <div>
                <h3>Position impact</h3>
                <p>The largest moves under this scenario.</p>
              </div>
            </header>
            <ul className="impact-list">
              {impacts.slice(0, 6).map((asset) => (
                <li key={asset.symbol}>
                  <div className="impact-head">
                    <span>
                      <strong>{asset.symbol}</strong>
                      <em>beta {asset.beta.toFixed(2)}</em>
                    </span>
                    <span className={asset.impact_usd < 0 ? "neg" : "pos"}>
                      {money(asset.impact_usd)}
                    </span>
                  </div>
                  <div className="impact-track">
                    <span
                      className={asset.impact_usd < 0 ? "impact-neg" : "impact-pos"}
                      style={{ "--target": `${(Math.abs(asset.impact_usd) / maxImpact) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <footer className="card-foot">
              <span className="muted">
                Shock is applied to every position through its beta; cash is not modelled.
              </span>
            </footer>
          </article>
        </div>
      </div>
    </section>
  );
}
