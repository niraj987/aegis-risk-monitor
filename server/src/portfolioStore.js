import * as db from "./db.js";
import { DEFAULT_LIMITS, DEFAULT_PORTFOLIO, normaliseWeights, sanitiseLimits } from "./universe.js";

export function getPortfolio() {
  const stored = db.getSetting("portfolio");
  if (!stored) {
    db.putSetting("portfolio", DEFAULT_PORTFOLIO);
    return DEFAULT_PORTFOLIO.map((item) => ({ ...item }));
  }
  return normaliseWeights(stored);
}

export function savePortfolio(holdings) {
  const portfolio = normaliseWeights(holdings);
  db.putSetting("portfolio", portfolio);
  return portfolio;
}

export function getLimits() {
  const stored = db.getSetting("limits");
  if (!stored) {
    db.putSetting("limits", DEFAULT_LIMITS);
    return { ...DEFAULT_LIMITS };
  }
  return sanitiseLimits(stored);
}

export function saveLimits(limits) {
  const cleaned = sanitiseLimits(limits);
  db.putSetting("limits", cleaned);
  return cleaned;
}
