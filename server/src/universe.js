/** The paper portfolio and its risk appetite. Weights sum to 1.0. */
export const DEFAULT_PORTFOLIO = [
  { symbol: "AAPL", name: "Apple", sector: "Technology", weight: 0.12 },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology", weight: 0.12 },
  { symbol: "NVDA", name: "NVIDIA", sector: "Semiconductors", weight: 0.1 },
  { symbol: "AMZN", name: "Amazon", sector: "Consumer", weight: 0.1 },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", weight: 0.1 },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", weight: 0.1 },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", weight: 0.09 },
  { symbol: "KO", name: "Coca-Cola", sector: "Staples", weight: 0.09 },
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities", weight: 0.09 },
  { symbol: "GLD", name: "Gold ETF", sector: "Commodities", weight: 0.09 },
];

export const DEFAULT_LIMITS = {
  var_95_limit_pct: 2.5,
  ann_vol_limit_pct: 22.0,
  max_drawdown_limit_pct: 15.0,
  daily_move_limit_pct: 3.0,
  concentration_limit_pct: 25.0,
};

export function normaliseWeights(portfolio) {
  const total = portfolio.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (!portfolio.length) return [];
  if (total <= 0) {
    const equal = Number((1 / portfolio.length).toFixed(4));
    return portfolio.map((item) => ({ ...item, weight: equal }));
  }

  const cleaned = portfolio.map((item) => ({
    ...item,
    weight: Number((Math.max(0, Number(item.weight) || 0) / total).toFixed(4)),
  }));

  const drift = Number((1 - cleaned.reduce((sum, item) => sum + item.weight, 0)).toFixed(4));
  if (cleaned[0]) cleaned[0].weight = Number((cleaned[0].weight + drift).toFixed(4));
  return cleaned;
}

export function sanitiseLimits(limits) {
  const result = { ...DEFAULT_LIMITS };
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = Number(limits?.[key] ?? fallback);
    if (Number.isFinite(value) && value > 0) result[key] = Number(value.toFixed(2));
  }
  return result;
}
