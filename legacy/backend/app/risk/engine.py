"""Quantitative risk engine.

All VaR and Expected Shortfall numbers are returned as positive *loss*
fractions of portfolio value (0.021 = a 2.1% one-day loss). Nothing here makes
trading decisions; the output is evidence for the alerting layer.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from .anomalies import analyse_anomalies, summarise_anomalies

TRADING_DAYS = 252
SIMULATIONS = 10_000
MAX_CURVE_POINTS = 120


# --------------------------------------------------------------------------- #
# Building blocks
# --------------------------------------------------------------------------- #
def log_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """Daily log returns, dropping the first empty row."""
    returns = np.log(prices / prices.shift(1))
    return returns.replace([np.inf, -np.inf], np.nan).dropna(how="all")


def portfolio_return_series(asset_returns: pd.DataFrame, weights: np.ndarray) -> pd.Series:
    """Weighted portfolio return per session (weights must sum to 1)."""
    values = asset_returns.to_numpy(dtype=float) @ weights
    return pd.Series(values, index=asset_returns.index, name="portfolio")


def annualised_volatility(returns: pd.Series) -> float:
    return float(returns.std(ddof=1) * math.sqrt(TRADING_DAYS))


def annualised_return(returns: pd.Series) -> float:
    return float(np.expm1(returns.mean() * TRADING_DAYS))


def historical_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """Historical simulation VaR (positive loss fraction)."""
    values = returns.dropna().to_numpy(dtype=float)
    if values.size == 0:
        return 0.0
    quantile = float(np.quantile(values, 1 - confidence))
    return max(0.0, -quantile)


def historical_var_horizon(returns: pd.Series, confidence: float = 0.95, horizon: int = 5) -> float:
    """Overlapping-horizon historical VaR, e.g. a 5-day hold."""
    if horizon <= 1:
        return historical_var(returns, confidence)
    compounded = returns.rolling(horizon).sum().dropna()
    return historical_var(compounded, confidence)


def parametric_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """Variance-covariance VaR assuming normally distributed returns."""
    values = returns.dropna()
    if values.empty:
        return 0.0
    mu = float(values.mean())
    sigma = float(values.std(ddof=1))
    if not math.isfinite(sigma) or sigma <= 0:
        return 0.0
    z = float(stats.norm.ppf(1 - confidence))
    return max(0.0, -(mu + z * sigma))


def monte_carlo_var(
    asset_returns: pd.DataFrame,
    weights: np.ndarray,
    confidence: float = 0.95,
    simulations: int = SIMULATIONS,
    seed: int = 42,
) -> float:
    """Simulate correlated asset returns from their sample mean and covariance."""
    if asset_returns.empty:
        return 0.0
    mu = asset_returns.mean().to_numpy(dtype=float)
    cov = np.nan_to_num(asset_returns.cov().to_numpy(dtype=float), nan=0.0)
    cov = (cov + cov.T) / 2

    # Project onto the positive semi-definite cone so the simulation is stable.
    eigenvalues, eigenvectors = np.linalg.eigh(cov)
    eigenvalues = np.clip(eigenvalues, 1e-12, None)
    cov = eigenvectors @ np.diag(eigenvalues) @ eigenvectors.T

    rng = np.random.default_rng(seed)
    draws = rng.multivariate_normal(mu, cov, size=simulations)
    simulated = draws @ weights
    return max(0.0, float(-np.quantile(simulated, 1 - confidence)))


def expected_shortfall(returns: pd.Series, confidence: float = 0.95) -> float:
    """Average loss in the worst (1 - confidence) tail."""
    values = returns.dropna()
    if values.empty:
        return 0.0
    var = historical_var(values, confidence)
    tail = values[values <= -var]
    if tail.empty:
        return var
    return max(var, float(-tail.mean()))


def drawdown_curve(returns: pd.Series) -> pd.Series:
    """Fractional drawdown from the running peak."""
    wealth = (1 + returns).cumprod()
    peak = wealth.cummax()
    return wealth / peak - 1


def risk_contributions(weights: np.ndarray, covariance: np.ndarray) -> np.ndarray:
    """Share of total portfolio variance contributed by each position."""
    covariance = np.nan_to_num(covariance, nan=0.0)
    variance = float(weights @ covariance @ weights)
    if variance <= 0:
        return np.zeros_like(weights)
    marginal = covariance @ weights
    return (weights * marginal) / variance


# --------------------------------------------------------------------------- #
# Limit evaluation
# --------------------------------------------------------------------------- #
def evaluate_limits(
    metrics: dict[str, Any],
    limits: dict[str, float],
    anomalies: dict[str, Any],
) -> list[dict[str, Any]]:
    """Compare current metrics with the human-set risk appetite."""
    breaches: list[dict[str, Any]] = []

    def add(
        code: str,
        severity: str,
        metric: str,
        observed: float,
        limit: float,
        message: str,
    ) -> None:
        breaches.append(
            {
                "code": code,
                "severity": severity,
                "metric": metric,
                "observed": round(observed, 3),
                "limit": round(limit, 3),
                "unit": "%",
                "message": message,
            }
        )

    var_pct = metrics["var_95_1d"] * 100
    limit = limits["var_95_limit_pct"]
    if var_pct > limit:
        add(
            "VAR_LIMIT",
            "critical" if var_pct > limit * 1.2 else "high",
            "1-day VaR (95%)",
            var_pct,
            limit,
            f"A single bad day at 95% confidence could cost {var_pct:.2f}% of NAV, "
            f"above the {limit:.2f}% budget.",
        )

    vol_pct = metrics["ann_vol"] * 100
    limit = limits["ann_vol_limit_pct"]
    if vol_pct > limit:
        add(
            "VOL_LIMIT",
            "high" if vol_pct > limit * 1.25 else "medium",
            "Annualised volatility",
            vol_pct,
            limit,
            f"Portfolio volatility is {vol_pct:.1f}% a year versus a {limit:.1f}% budget.",
        )

    drawdown_pct = abs(metrics["current_drawdown"]) * 100
    limit = limits["max_drawdown_limit_pct"]
    if drawdown_pct > limit:
        add(
            "DRAWDOWN_LIMIT",
            "critical" if drawdown_pct > limit * 1.5 else "high",
            "Drawdown from peak",
            drawdown_pct,
            limit,
            f"The portfolio sits {drawdown_pct:.1f}% below its peak, beyond the "
            f"{limit:.1f}% drawdown limit.",
        )

    latest_move_pct = abs(min(0.0, metrics["latest_return"])) * 100
    limit = limits["daily_move_limit_pct"]
    if latest_move_pct > limit:
        add(
            "DAILY_MOVE",
            "high" if latest_move_pct > limit * 1.5 else "medium",
            "Latest session move",
            latest_move_pct,
            limit,
            f"The latest session lost {latest_move_pct:.2f}%, above the "
            f"{limit:.2f}% single-day budget.",
        )

    top_pct = metrics["top_weight"] * 100
    limit = limits["concentration_limit_pct"]
    if top_pct > limit:
        add(
            "CONCENTRATION",
            "medium",
            "Largest position",
            top_pct,
            limit,
            f"The largest position is {top_pct:.1f}% of NAV, above the "
            f"{limit:.1f}% single-name guideline.",
        )

    flagged = anomalies.get("symbols", [])
    if flagged:
        add(
            "UNUSUAL_ACTIVITY",
            "low",
            "Assets with unusual moves",
            float(len(flagged)),
            float(len(flagged)),
            "Unusual price behaviour in " + ", ".join(flagged[:4]) + ".",
        )
        breaches[-1]["unit"] = "count"

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    breaches.sort(key=lambda item: order.get(item["severity"], 9))
    return breaches


def _health(breaches: list[dict[str, Any]]) -> dict[str, Any]:
    penalty = {"critical": 35, "high": 20, "medium": 12, "low": 5}
    score = 100 - sum(penalty.get(item["severity"], 8) for item in breaches)
    score = max(5, min(100, score))
    if any(item["severity"] == "critical" for item in breaches):
        status = "breach"
    elif any(item["severity"] in {"high", "medium"} for item in breaches):
        status = "watch"
    elif breaches:
        status = "watch"
    else:
        status = "normal"
    return {"score": score, "status": status}


def _curve_payload(dates: pd.Index, values: np.ndarray, scale: float = 1.0, digits: int = 3) -> list[dict[str, Any]]:
    if len(dates) > MAX_CURVE_POINTS:
        step = max(1, len(dates) // MAX_CURVE_POINTS)
        dates = dates[::step]
        values = values[::step]
    return [
        {"date": pd.Timestamp(date).strftime("%Y-%m-%d"), "value": round(float(value) * scale, digits)}
        for date, value in zip(dates, values)
    ]


# --------------------------------------------------------------------------- #
# Snapshot assembly
# --------------------------------------------------------------------------- #
def build_snapshot(
    *,
    prices: pd.DataFrame,
    portfolio: list[dict[str, Any]],
    portfolio_value: float,
    limits: dict[str, float],
    data_source: str,
    seed: int = 42,
) -> dict[str, Any]:
    """Compute metrics, per-asset diagnostics, curves and limit breaches."""
    holdings = [item for item in portfolio if item["symbol"] in prices.columns]
    if len(holdings) < 2:
        raise ValueError("Portfolio needs at least two symbols with price history")

    symbols = [item["symbol"] for item in holdings]
    frame = prices[symbols].dropna(how="any")
    if len(frame) < 60:
        raise ValueError("At least 60 shared price observations are required")

    returns = log_returns(frame)
    asset_returns = returns[symbols]
    weights = np.array([max(0.0, float(item.get("weight", 0.0))) for item in holdings], dtype=float)
    weights = weights / weights.sum()

    portfolio_returns = portfolio_return_series(asset_returns, weights)
    covariance = asset_returns.cov().to_numpy(dtype=float)
    contributions = risk_contributions(weights, covariance)

    var95 = historical_var(portfolio_returns, 0.95)
    var99 = historical_var(portfolio_returns, 0.99)
    es95 = expected_shortfall(portfolio_returns, 0.95)
    es99 = expected_shortfall(portfolio_returns, 0.99)
    drawdowns = drawdown_curve(portfolio_returns)
    latest_return = float(portfolio_returns.iloc[-1])

    metrics: dict[str, Any] = {
        "observations": int(len(portfolio_returns)),
        "portfolio_value": float(portfolio_value),
        "latest_return": round(latest_return, 6),
        "ann_return": round(annualised_return(portfolio_returns), 6),
        "ann_vol": round(annualised_volatility(portfolio_returns), 6),
        "var_95_1d": round(var95, 6),
        "var_99_1d": round(var99, 6),
        "var_95_5d": round(historical_var_horizon(portfolio_returns, 0.95, 5), 6),
        "es_95_1d": round(es95, 6),
        "es_99_1d": round(es99, 6),
        "parametric_var_95": round(parametric_var(portfolio_returns, 0.95), 6),
        "monte_carlo_var_95": round(
            monte_carlo_var(asset_returns, weights, 0.95, seed=seed), 6
        ),
        "var_95_usd": round(var95 * portfolio_value, 2),
        "es_95_usd": round(es95 * portfolio_value, 2),
        "var_95_5d_usd": round(historical_var_horizon(portfolio_returns, 0.95, 5) * portfolio_value, 2),
        "current_drawdown": round(float(drawdowns.iloc[-1]), 6),
        "max_drawdown": round(float(drawdowns.min()), 6),
        "worst_day": round(float(portfolio_returns.min()), 6),
        "best_day": round(float(portfolio_returns.max()), 6),
        "hhi": round(float(np.sum(weights**2)), 4),
        "top_weight": round(float(weights.max()), 4),
    }

    anomaly_frame = analyse_anomalies(asset_returns)
    anomaly_summary = summarise_anomalies(anomaly_frame)

    assets: list[dict[str, Any]] = []
    for index, item in enumerate(holdings):
        symbol = item["symbol"]
        series = asset_returns[symbol]
        row = anomaly_frame.loc[symbol]
        assets.append(
            {
                "symbol": symbol,
                "name": item.get("name", symbol),
                "sector": item.get("sector", "Diversified"),
                "weight": round(float(weights[index]), 4),
                "price": round(float(frame[symbol].iloc[-1]), 2),
                "last_return": round(float(series.iloc[-1]), 6),
                "ann_vol": round(annualised_volatility(series), 6),
                "risk_share": round(float(contributions[index]), 4),
                "var_contribution": round(float(contributions[index]) * var95, 6),
                "zscore": round(float(row["zscore"]), 2),
                "vol_ratio": round(float(row["vol_ratio"]), 2),
                "anomaly_score": round(float(row["isolation"]), 3),
                "flag": bool(row["flag"]),
                "note": str(row["note"]),
            }
        )
    assets.sort(key=lambda asset: asset["risk_share"], reverse=True)

    breaches = evaluate_limits(metrics, limits, anomaly_summary)
    health = _health(breaches)

    wealth = (1 + portfolio_returns).cumprod() * 100
    rolling_var = portfolio_returns.rolling(60).apply(
        lambda window: -np.quantile(window, 0.05), raw=True
    )
    rolling_es = portfolio_returns.rolling(60).apply(
        lambda window: -window[window <= np.quantile(window, 0.05)].mean(), raw=True
    )
    risk_dates = portfolio_returns.index[-MAX_CURVE_POINTS:]

    sector_weights: dict[str, float] = {}
    for item in holdings:
        sector = item.get("sector", "Diversified")
        sector_weights[sector] = round(
            sector_weights.get(sector, 0.0) + float(item.get("weight", 0.0)), 4
        )

    return {
        "as_of": pd.Timestamp(frame.index[-1]).strftime("%Y-%m-%d"),
        "data_source": data_source,
        "metrics": metrics,
        "assets": assets,
        "breaches": breaches,
        "health": health,
        "portfolio": {
            "value": float(portfolio_value),
            "weights": {item["symbol"]: round(float(weights[i]), 4) for i, item in enumerate(holdings)},
            "sectors": sector_weights,
        },
        "anomalies": anomaly_summary,
        "curves": {
            "equity": _curve_payload(wealth.index, wealth.to_numpy(), digits=2),
            "drawdown": _curve_payload(
                drawdowns.index, drawdowns.to_numpy(), scale=100, digits=2
            ),
            "risk": [
                {
                    "date": pd.Timestamp(date).strftime("%Y-%m-%d"),
                    "var_95": round(float(var), 6),
                    "es_95": round(float(es), 6),
                }
                for date, var, es in zip(
                    risk_dates,
                    rolling_var.reindex(risk_dates).fillna(0.0),
                    rolling_es.reindex(risk_dates).fillna(0.0),
                )
            ],
        },
    }
