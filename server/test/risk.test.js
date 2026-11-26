import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseAnomalies } from "../src/anomalies.js";
import { syntheticPrices } from "../src/market.js";
import {
  buildSnapshot,
  drawdownSeries,
  expectedShortfall,
  historicalVar,
  monteCarloVar,
  normalPpf,
  parametricVar,
  riskContributions,
  stressScenario,
} from "../src/risk.js";
import { covarianceMatrix, logReturns } from "../src/risk.js";
import { DEFAULT_LIMITS } from "../src/universe.js";

const SYMBOLS = ["AAA", "BBB", "CCC"];
const PORTFOLIO = [
  { symbol: "AAA", name: "Alpha", sector: "Technology", weight: 0.5 },
  { symbol: "BBB", name: "Beta", sector: "Financials", weight: 0.3 },
  { symbol: "CCC", name: "Gamma", sector: "Energy", weight: 0.2 },
];

const frame = syntheticPrices(SYMBOLS, { AAA: "Technology", BBB: "Financials", CCC: "Energy" }, 400);
const assetReturns = SYMBOLS.map((symbol) => logReturns(frame.close[symbol]));
const weights = [0.5, 0.3, 0.2];
const portfolioReturns = assetReturns[0].map((_, index) =>
  assetReturns.reduce((sum, series, asset) => sum + weights[asset] * series[index], 0),
);

test("normal quantile matches the 95% reference value", () => {
  assert.ok(Math.abs(normalPpf(0.05) + 1.6448536) < 1e-4);
  assert.ok(Math.abs(normalPpf(0.025) + 1.959964) < 1e-4);
});

test("VaR is positive and ordered by confidence", () => {
  const var95 = historicalVar(portfolioReturns, 0.95);
  const var99 = historicalVar(portfolioReturns, 0.99);
  assert.ok(var95 > 0);
  assert.ok(var99 > var95);
  assert.ok(expectedShortfall(portfolioReturns, 0.95) >= var95);
  assert.ok(expectedShortfall(portfolioReturns, 0.99) >= var99);
});

test("parametric and Monte Carlo VaR agree in order of magnitude with history", () => {
  const historical = historicalVar(portfolioReturns, 0.95);
  const parametric = parametricVar(portfolioReturns, 0.95);
  const simulated = monteCarloVar(assetReturns, weights, 0.95, 5000, 11);

  assert.ok(parametric > historical * 0.4 && parametric < historical * 2);
  assert.ok(simulated > historical * 0.4 && simulated < historical * 2);
});

test("risk contributions sum to one", () => {
  const contributions = riskContributions(weights, covarianceMatrix(assetReturns));
  const total = contributions.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("drawdowns are never positive", () => {
  const drawdowns = drawdownSeries(portfolioReturns);
  assert.ok(drawdowns.every((value) => value <= 1e-12));
  assert.ok(Math.min(...drawdowns) < 0);
});

test("anomaly detection returns a score and flag for every asset", () => {
  const analysis = analyseAnomalies(
    Object.fromEntries(SYMBOLS.map((symbol, index) => [symbol, assetReturns[index]])),
  );
  for (const symbol of SYMBOLS) {
    assert.equal(typeof analysis[symbol].zscore, "number");
    assert.equal(typeof analysis[symbol].flag, "boolean");
    assert.ok(analysis[symbol].anomaly_score >= 0);
  }
});

test("snapshot exposes metrics, betas, curves and limits", () => {
  const snapshot = buildSnapshot({
    frame,
    portfolio: PORTFOLIO,
    portfolioValue: 1_000_000,
    limits: DEFAULT_LIMITS,
    seed: 3,
  });

  assert.ok(snapshot.metrics.var_95_1d > 0);
  assert.ok(snapshot.metrics.es_95_1d >= snapshot.metrics.var_95_1d);
  assert.ok(Math.abs(snapshot.metrics.var_95_usd - snapshot.metrics.var_95_1d * 1_000_000) < 1);
  assert.equal(snapshot.assets.length, 3);
  assert.ok(snapshot.assets.every((asset) => Number.isFinite(asset.beta)));
  assert.ok(Math.abs(snapshot.assets.reduce((sum, asset) => sum + asset.weight, 0) - 1) < 1e-3);
  assert.ok(snapshot.curves.risk.length > 10);
  assert.ok(["normal", "watch", "breach"].includes(snapshot.health.status));
});

test("tight limits produce ranked breaches", () => {
  const snapshot = buildSnapshot({
    frame,
    portfolio: PORTFOLIO,
    portfolioValue: 1_000_000,
    limits: { ...DEFAULT_LIMITS, var_95_limit_pct: 0.01, ann_vol_limit_pct: 0.5, max_drawdown_limit_pct: 0.01, concentration_limit_pct: 1 },
  });
  const codes = snapshot.breaches.map((breach) => breach.code);
  assert.ok(codes.includes("VAR_LIMIT"));
  assert.ok(codes.includes("VOL_LIMIT"));
  assert.ok(codes.includes("CONCENTRATION"));
  assert.equal(snapshot.health.status, "breach");
});

test("stress scenario is symmetric and conserves NAV", () => {
  const snapshot = buildSnapshot({
    frame,
    portfolio: PORTFOLIO,
    portfolioValue: 1_000_000,
    limits: DEFAULT_LIMITS,
  });
  const down = stressScenario(snapshot, -10);
  const up = stressScenario(snapshot, 10);

  assert.ok(down.estimated_pnl < 0);
  assert.ok(up.estimated_pnl > 0);
  assert.ok(Math.abs(down.estimated_pnl + up.estimated_pnl) < 1);
  assert.ok(Math.abs(down.projected_value - down.estimated_pnl - 1_000_000) < 1);
  assert.ok(down.impacts.length === 3);
  assert.ok(down.loss_pct_of_nav > 0);
});
