"""The default paper portfolio and the risk limits it is monitored against.

Weights are fractions of net asset value and must sum to 1.0. Limits are
expressed in percent so they can be compared directly with dashboard values.
"""

from __future__ import annotations

from typing import Any

DEFAULT_PORTFOLIO: list[dict[str, Any]] = [
    {"symbol": "AAPL", "name": "Apple", "sector": "Technology", "weight": 0.12},
    {"symbol": "MSFT", "name": "Microsoft", "sector": "Technology", "weight": 0.12},
    {"symbol": "NVDA", "name": "NVIDIA", "sector": "Semiconductors", "weight": 0.10},
    {"symbol": "AMZN", "name": "Amazon", "sector": "Consumer", "weight": 0.10},
    {"symbol": "JPM", "name": "JPMorgan Chase", "sector": "Financials", "weight": 0.10},
    {"symbol": "XOM", "name": "Exxon Mobil", "sector": "Energy", "weight": 0.10},
    {"symbol": "JNJ", "name": "Johnson & Johnson", "sector": "Healthcare", "weight": 0.09},
    {"symbol": "KO", "name": "Coca-Cola", "sector": "Staples", "weight": 0.09},
    {"symbol": "NEE", "name": "NextEra Energy", "sector": "Utilities", "weight": 0.09},
    {"symbol": "GLD", "name": "Gold ETF", "sector": "Commodities", "weight": 0.09},
]

DEFAULT_LIMITS: dict[str, float] = {
    "var_95_limit_pct": 2.50,       # 1-day 95% VaR budget, % of NAV
    "ann_vol_limit_pct": 22.0,      # annualised portfolio volatility budget
    "max_drawdown_limit_pct": 15.0, # peak-to-trough drawdown budget
    "daily_move_limit_pct": 3.00,   # single-day loss budget
    "concentration_limit_pct": 25.0,  # largest single position
}


def normalise_weights(portfolio: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Scale weights so they sum to 1.0, keeping two decimals for readability."""
    total = sum(max(0.0, float(item.get("weight", 0.0))) for item in portfolio)
    if total <= 0:
        equal = round(1.0 / len(portfolio), 4) if portfolio else 0.0
        return [{**item, "weight": equal} for item in portfolio]

    cleaned: list[dict[str, Any]] = []
    for item in portfolio:
        weight = max(0.0, float(item.get("weight", 0.0))) / total
        cleaned.append({**item, "weight": round(weight, 4)})

    drift = round(1.0 - sum(item["weight"] for item in cleaned), 4)
    if cleaned:
        cleaned[0]["weight"] = round(cleaned[0]["weight"] + drift, 4)
    return cleaned


def sanitise_limits(limits: dict[str, Any]) -> dict[str, float]:
    """Keep only known, positive limits; fall back to the defaults otherwise."""
    result = dict(DEFAULT_LIMITS)
    for key, default in DEFAULT_LIMITS.items():
        try:
            value = float(limits.get(key, default))
        except (TypeError, ValueError):
            value = default
        if value > 0:
            result[key] = round(value, 2)
    return result
