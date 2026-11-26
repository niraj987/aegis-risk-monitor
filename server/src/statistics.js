export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n - 1), the convention used for daily returns. */
export function sampleSd(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/** Linear-interpolated quantile of an unsorted array. */
export function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const base = Math.floor(position);
  const rest = position - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

export function covariance(x, y) {
  const length = Math.min(x.length, y.length);
  if (length < 2) return 0;
  const xs = x.slice(-length);
  const ys = y.slice(-length);
  const mx = mean(xs);
  const my = mean(ys);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += (xs[index] - mx) * (ys[index] - my);
  }
  return total / (length - 1);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
