from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.market.universe import DEFAULT_LIMITS
from app.risk.engine import (
    build_snapshot,
    drawdown_curve,
    evaluate_limits,
    expected_shortfall,
    historical_var,
    monte_carlo_var,
    parametric_var,
    risk_contributions,
)

SYMBOLS = ["AAA", "BBB", "CCC"]


@pytest.fixture(scope="module")
def prices() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    sessions = pd.bdate_range(end="2026-06-30", periods=400)
    shocks = rng.normal(0.0004, 0.011, size=(len(sessions), len(SYMBOLS)))
    values = 100 * np.exp(np.cumsum(shocks, axis=0))
    return pd.DataFrame(values, index=sessions, columns=SYMBOLS)


@pytest.fixture(scope="module")
def portfolio() -> list[dict[str, object]]:
    return [
        {"symbol": "AAA", "name": "Alpha", "sector": "Technology", "weight": 0.5},
        {"symbol": "BBB", "name": "Beta", "sector": "Financials", "weight": 0.3},
        {"symbol": "CCC", "name": "Gamma", "sector": "Energy", "weight": 0.2},
    ]


def portfolio_returns(prices: pd.DataFrame) -> pd.Series:
    returns = np.log(prices / prices.shift(1)).dropna()
    return returns.mean(axis=1)


def test_var_is_positive_and_ordered(prices: pd.DataFrame) -> None:
    returns = portfolio_returns(prices)
    var95 = historical_var(returns, 0.95)
    var99 = historical_var(returns, 0.99)
    es95 = expected_shortfall(returns, 0.95)
    es99 = expected_shortfall(returns, 0.99)

    assert var95 > 0
    assert var99 > var95
    assert es95 >= var95
    assert es99 >= var99


def test_parametric_and_monte_carlo_are_in_the_same_ballpark(prices: pd.DataFrame) -> None:
    returns = portfolio_returns(prices)
    historical = historical_var(returns, 0.95)
    parametric = parametric_var(returns, 0.95)

    weights = np.array([0.5, 0.3, 0.2])
    simulated = monte_carlo_var(prices.pct_change().dropna(), weights, 0.95, simulations=5000, seed=11)

    assert 0.4 * historical < parametric < 2.0 * historical
    assert 0.4 * historical < simulated < 2.0 * historical


def test_risk_contributions_sum_to_one(prices: pd.DataFrame) -> None:
    covariance = np.log(prices / prices.shift(1)).dropna().cov().to_numpy()
    contributions = risk_contributions(np.array([0.5, 0.3, 0.2]), covariance)
    assert contributions.sum() == pytest.approx(1.0, abs=1e-9)


def test_drawdown_is_never_positive(prices: pd.DataFrame) -> None:
    drawdowns = drawdown_curve(portfolio_returns(prices))
    assert (drawdowns <= 1e-12).all()
    assert drawdowns.min() < 0


def test_snapshot_contains_metrics_assets_and_curves(prices, portfolio) -> None:
    snapshot = build_snapshot(
        prices=prices,
        portfolio=portfolio,
        portfolio_value=1_000_000,
        limits=DEFAULT_LIMITS,
        data_source="test",
        seed=3,
    )

    metrics = snapshot["metrics"]
    assert metrics["var_95_1d"] > 0
    assert metrics["var_95_usd"] == pytest.approx(metrics["var_95_1d"] * 1_000_000, rel=1e-4)
    assert metrics["es_95_1d"] >= metrics["var_95_1d"]
    assert metrics["ann_vol"] > 0
    assert metrics["observations"] == len(prices) - 1

    assert len(snapshot["assets"]) == 3
    assert sum(asset["weight"] for asset in snapshot["assets"]) == pytest.approx(1.0, abs=1e-4)
    assert snapshot["health"]["status"] in {"normal", "watch", "breach"}
    assert snapshot["curves"]["equity"]
    assert snapshot["curves"]["risk"]
    assert set(snapshot["portfolio"]["sectors"]) == {"Technology", "Financials", "Energy"}


def test_tight_limits_produce_breaches(prices, portfolio) -> None:
    snapshot = build_snapshot(
        prices=prices,
        portfolio=portfolio,
        portfolio_value=1_000_000,
        limits=DEFAULT_LIMITS,
        data_source="test",
    )
    tight = {
        "var_95_limit_pct": 0.01,
        "ann_vol_limit_pct": 1.0,
        "max_drawdown_limit_pct": 0.01,
        "daily_move_limit_pct": 0.01,
        "concentration_limit_pct": 1.0,
    }
    breaches = evaluate_limits(snapshot["metrics"], tight, snapshot["anomalies"])
    codes = {breach["code"] for breach in breaches}

    assert {"VAR_LIMIT", "VOL_LIMIT", "DRAWDOWN_LIMIT", "CONCENTRATION"} <= codes
    assert all(breach["observed"] >= 0 for breach in breaches)


def test_snapshot_requires_enough_history(portfolio) -> None:
    dates = pd.bdate_range(end="2026-06-30", periods=10)
    short = pd.DataFrame(
        {symbol: np.linspace(100, 105, 10) for symbol in SYMBOLS}, index=dates
    )
    with pytest.raises(ValueError):
        build_snapshot(
            prices=short,
            portfolio=portfolio,
            portfolio_value=100,
            limits=DEFAULT_LIMITS,
            data_source="test",
        )
