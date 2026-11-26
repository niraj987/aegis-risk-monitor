import { mean, sampleSd } from "./statistics.js";

const ZSCORE_THRESHOLD = 2;
const VOL_RATIO_THRESHOLD = 1.8;
const MAHALANOBIS_THRESHOLD = 3;

function rollingSd(values, window) {
  return window > 1 ? sampleSd(values.slice(-window)) : 0;
}

/**
 * Three lenses on the same asset: a z-score against its 60-session baseline,
 * a recent-vs-baseline volatility ratio, and the Mahalanobis distance of the
 * latest (return, volatility) pair from its own 120-session distribution.
 */
export function analyseAnomalies(returnsBySymbol) {
  const result = {};

  for (const [symbol, returns] of Object.entries(returnsBySymbol)) {
    const latest = returns.at(-1) ?? 0;
    const baseline = returns.slice(-60);
    const mu = mean(baseline);
    const sd = sampleSd(baseline);
    const zscore = sd > 0 ? (latest - mu) / sd : 0;

    const recentVol = rollingSd(returns, 10);
    const baseVol = rollingSd(returns, 60);
    const volRatio = baseVol > 0 ? recentVol / baseVol : 1;

    const distance = mahalanobisDistance(returns);
    const moved = Math.abs(zscore) >= ZSCORE_THRESHOLD;
    const volSpike = volRatio >= VOL_RATIO_THRESHOLD;
    const unusualShape = distance >= MAHALANOBIS_THRESHOLD;

    const notes = [];
    if (moved) {
      notes.push(`Large ${zscore < 0 ? "drop" : "jump"} (${zscore >= 0 ? "+" : ""}${zscore.toFixed(1)}σ)`);
    }
    if (volSpike) notes.push(`Volatility ${volRatio.toFixed(1)}× its normal level`);
    if (unusualShape && !notes.length) notes.push("Return pattern is statistically unusual");

    result[symbol] = {
      zscore: Number(zscore.toFixed(2)),
      vol_ratio: Number(volRatio.toFixed(2)),
      anomaly_score: Number(distance.toFixed(2)),
      flag: moved || volSpike || unusualShape,
      note: notes.join("; "),
    };
  }

  return result;
}

function mahalanobisDistance(returns) {
  const features = [];
  for (let index = 4; index < returns.length; index += 1) {
    const window = returns.slice(index - 4, index + 1);
    features.push([returns[index], sampleSd(window)]);
  }
  const recent = features.slice(-120);
  if (recent.length < 30) return 0;

  const meanX = mean(recent.map((row) => row[0]));
  const meanY = mean(recent.map((row) => row[1]));
  let varX = 0;
  let varY = 0;
  let cov = 0;
  for (const [x, y] of recent) {
    varX += (x - meanX) ** 2;
    varY += (y - meanY) ** 2;
    cov += (x - meanX) * (y - meanY);
  }
  const denominator = recent.length - 1;
  varX /= denominator;
  varY /= denominator;
  cov /= denominator;

  const determinant = varX * varY - cov ** 2;
  if (determinant <= 1e-16) return 0;

  const [x, y] = recent.at(-1);
  const dx = x - meanX;
  const dy = y - meanY;
  const distanceSquared =
    (varY * dx * dx - 2 * cov * dx * dy + varX * dy * dy) / determinant;
  return Math.sqrt(Math.max(0, distanceSquared));
}

export function summariseAnomalies(analysis) {
  const flagged = Object.entries(analysis)
    .filter(([, value]) => value.flag)
    .map(([symbol]) => symbol);

  return {
    count: flagged.length,
    symbols: flagged,
    strongest: flagged.length
      ? flagged.reduce((best, symbol) =>
          Math.abs(analysis[symbol].anomaly_score) > Math.abs(analysis[best].anomaly_score)
            ? symbol
            : best,
        )
      : null,
    details: flagged.slice(0, 5).map((symbol) => ({
      symbol,
      zscore: analysis[symbol].zscore,
      vol_ratio: analysis[symbol].vol_ratio,
      note: analysis[symbol].note,
    })),
  };
}
