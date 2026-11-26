"""Market data provider.

Preference order:
1. ``DATA_SOURCE=yfinance``  - live daily bars through yfinance (cached 6 hours).
2. ``DATA_SOURCE=auto``      - yfinance when the network allows, otherwise the
                               deterministic synthetic feed below.
3. ``DATA_SOURCE=synthetic`` - always offline, reproducible demo data.

The synthetic feed is a three-factor model (market + sector + idiosyncratic)
with a mild stress window at the end. That keeps the dashboard meaningful and
repeatable in CI, containers and offline demos.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import get_settings

CACHE_TTL_SECONDS = 6 * 60 * 60

# A handful of plausible starting prices and volatility assumptions. These are
# demo parameters, not calibrated market forecasts.
ASSET_PARAMETERS: dict[str, dict[str, float]] = {
    "AAPL": {"start": 212.0, "vol": 0.26, "beta": 1.10, "drift": 0.10},
    "MSFT": {"start": 418.0, "vol": 0.24, "beta": 1.05, "drift": 0.11},
    "NVDA": {"start": 128.0, "vol": 0.48, "beta": 1.70, "drift": 0.24},
    "AMZN": {"start": 186.0, "vol": 0.31, "beta": 1.20, "drift": 0.12},
    "JPM": {"start": 205.0, "vol": 0.22, "beta": 0.95, "drift": 0.08},
    "XOM": {"start": 118.0, "vol": 0.24, "beta": 0.80, "drift": 0.05},
    "JNJ": {"start": 158.0, "vol": 0.16, "beta": 0.55, "drift": 0.05},
    "KO": {"start": 63.0, "vol": 0.15, "beta": 0.50, "drift": 0.06},
    "NEE": {"start": 76.0, "vol": 0.20, "beta": 0.60, "drift": 0.07},
    "GLD": {"start": 205.0, "vol": 0.14, "beta": 0.10, "drift": 0.04},
}

SECTOR_LOADINGS = {
    "Technology": 0.75,
    "Semiconductors": 0.95,
    "Consumer": 0.70,
    "Financials": 0.65,
    "Energy": 0.55,
    "Healthcare": 0.45,
    "Staples": 0.35,
    "Utilities": 0.40,
    "Commodities": 0.10,
}


@dataclass
class PriceData:
    prices: pd.DataFrame
    source: str
    fetched_at: str


def _seed_for(symbols: list[str]) -> int:
    settings = get_settings()
    payload = "|".join(sorted(symbols)) + f"|{settings.random_seed}"
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _cache_path(symbols: list[str]) -> Path:
    key = hashlib.sha1(",".join(sorted(symbols)).encode("utf-8")).hexdigest()[:12]
    return get_settings().cache_dir / f"prices_{key}.csv"


def _read_cache(symbols: list[str]) -> pd.DataFrame | None:
    path = _cache_path(symbols)
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > CACHE_TTL_SECONDS:
        return None
    try:
        frame = pd.read_csv(path, index_col=0, parse_dates=True)
    except (OSError, ValueError):
        return None
    return frame if set(symbols).issubset(frame.columns) else None


def _write_cache(symbols: list[str], frame: pd.DataFrame) -> None:
    try:
        frame.to_csv(_cache_path(symbols))
    except OSError:  # a read-only volume should not break monitoring
        pass


def _from_yfinance(symbols: list[str], days: int) -> pd.DataFrame:
    import yfinance as yf  # imported lazily so offline runs never pay for it

    raw = yf.download(
        tickers=symbols,
        period=f"{min(days + 40, 1600)}d",
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=True,
    )
    if raw is None or raw.empty:
        raise RuntimeError("yfinance returned no rows")

    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"]
    elif "Close" in raw.columns:
        close = raw[["Close"]].copy()
        close.columns = [symbols[0]]
    else:
        raise RuntimeError("yfinance response has no Close prices")

    close = close.reindex(columns=symbols).ffill().dropna(how="all")
    close = close.tail(days)
    missing = [symbol for symbol in symbols if symbol not in close or close[symbol].dropna().empty]
    if missing:
        raise RuntimeError(f"missing market data for {missing}")
    return close.dropna()


def _synthetic_prices(symbols: list[str], days: int, sectors: dict[str, str] | None = None) -> pd.DataFrame:
    """Three-factor simulation with a short stress window at the end."""
    rng = np.random.default_rng(_seed_for(symbols))
    sessions = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=days)
    n = len(sessions)

    market_vol = 0.0090
    market = rng.normal(0.00030, market_vol, n)
    sectors = sectors or {}
    sector_factors = {
        sector: rng.normal(0.0, 0.0040, n)
        for sector in {sectors.get(symbol, "Broad") for symbol in symbols}
    }

    # Recent stress: a weaker tape with wider swings, so monitoring has signal.
    stress_days = min(6, max(3, n // 25))
    market[-stress_days:] = market[-stress_days:] * 1.7 - 0.007
    for factor in sector_factors.values():
        factor[-stress_days:] = factor[-stress_days:] * 1.5 - 0.0012

    columns: dict[str, np.ndarray] = {}
    for symbol in symbols:
        params = ASSET_PARAMETERS.get(
            symbol, {"start": 100.0, "vol": 0.28, "beta": 1.0, "drift": 0.08}
        )
        sector = sectors.get(symbol, "Broad")
        beta = params["beta"]
        sector_loading = SECTOR_LOADINGS.get(sector, 0.5)

        systematic = beta**2 * market_vol**2 + sector_loading**2 * 0.0040**2
        idio_vol = max(0.004, np.sqrt(max(params["vol"] ** 2 / 252 - systematic, 0.004**2)))
        daily_drift = (params["drift"] - 0.5 * params["vol"] ** 2) / 252

        returns = (
            daily_drift
            + beta * market
            + sector_loading * sector_factors[sector]
            + rng.normal(0.0, idio_vol, n)
        )
        columns[symbol] = params["start"] * np.exp(np.cumsum(returns))

    return pd.DataFrame(columns, index=sessions)


def load_prices(
    symbols: list[str],
    days: int | None = None,
    sectors: dict[str, str] | None = None,
) -> PriceData:
    """Return a price frame indexed by session date, one column per symbol."""
    settings = get_settings()
    days = days or settings.history_days
    source = settings.data_source
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if source == "synthetic":
        return PriceData(_synthetic_prices(symbols, days, sectors), "synthetic", fetched_at)

    cached = _read_cache(symbols)
    if cached is not None:
        return PriceData(cached.tail(days), "yfinance (cached)", fetched_at)

    if source in {"auto", "yfinance"}:
        try:
            frame = _from_yfinance(symbols, days)
            _write_cache(symbols, frame)
            return PriceData(frame, "yfinance", fetched_at)
        except Exception as exc:  # network, rate limit, delisted ticker...
            if source == "yfinance":
                raise RuntimeError(f"yfinance data unavailable: {exc}") from exc

    return PriceData(_synthetic_prices(symbols, days, sectors), "synthetic (offline)", fetched_at)
