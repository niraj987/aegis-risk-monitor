"""Unusual-movement detection combining statistical and model-based signals.

Two independent lenses keep the output explainable:
* a z-score against the trailing 60-session distribution (easy to explain);
* an Isolation Forest on return/volatility features (catches shape changes a
  single z-score misses).

An asset is flagged when any lens fires.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

ZSCORE_THRESHOLD = 2.0
VOLUME_OF_RISK_THRESHOLD = 1.8  # recent 10-day vol / trailing 60-day vol
ISOLATION_THRESHOLD = -0.02


def _isolation_score(series: pd.Series) -> float:
    """Decision score of the latest observation; negative means unusual."""
    features = pd.DataFrame(
        {"return": series, "vol_5d": series.rolling(5).std(ddof=1)}
    ).dropna()
    if len(features) < 80:
        return 0.0
    model = IsolationForest(
        n_estimators=150, contamination=0.05, random_state=42, n_jobs=1
    )
    model.fit(features.to_numpy())
    return float(model.decision_function(features.to_numpy()[-1:])[0])


def analyse_anomalies(returns: pd.DataFrame, window: int = 60) -> pd.DataFrame:
    """Return per-asset z-score, vol ratio, isolation score and a flag."""
    result = pd.DataFrame(index=returns.columns)
    if returns.empty or len(returns) < 20:
        result["zscore"] = 0.0
        result["vol_ratio"] = 1.0
        result["isolation"] = 0.0
        result["flag"] = False
        result["note"] = ""
        return result

    latest = returns.iloc[-1]
    baseline = returns.tail(window)

    mean = baseline.mean()
    std = baseline.std(ddof=1).replace(0, np.nan)
    zscore = ((latest - mean) / std).replace([np.inf, -np.inf], np.nan).fillna(0.0)

    recent_vol = returns.tail(10).std(ddof=1)
    base_vol = returns.tail(window).std(ddof=1).replace(0, np.nan)
    vol_ratio = (recent_vol / base_vol).replace([np.inf, -np.inf], np.nan).fillna(1.0)

    isolation = {symbol: _isolation_score(returns[symbol]) for symbol in returns.columns}

    for symbol in returns.columns:
        z = float(zscore[symbol])
        ratio = float(vol_ratio[symbol])
        iso = isolation[symbol]
        moved = abs(z) >= ZSCORE_THRESHOLD
        vol_spike = ratio >= VOLUME_OF_RISK_THRESHOLD
        iso_flag = iso <= ISOLATION_THRESHOLD

        notes: list[str] = []
        if moved:
            direction = "drop" if z < 0 else "jump"
            notes.append(f"Large {direction} ({z:+.1f}σ vs the last {window} sessions)")
        if vol_spike:
            notes.append(f"Volatility running {ratio:.1f}× its normal level")
        if iso_flag and not (moved or vol_spike):
            notes.append("Return pattern looks statistically unusual")

        result.loc[symbol, "zscore"] = round(z, 2)
        result.loc[symbol, "vol_ratio"] = round(ratio, 2)
        result.loc[symbol, "isolation"] = round(iso, 3)
        result.loc[symbol, "flag"] = bool(moved or vol_spike or iso_flag)
        result.loc[symbol, "note"] = "; ".join(notes)

    return result


def summarise_anomalies(anomalies: pd.DataFrame) -> dict[str, object]:
    """Compact evidence block used by alerts and the agent trace."""
    flagged = anomalies[anomalies["flag"]] if "flag" in anomalies else anomalies.iloc[0:0]
    names = [str(symbol) for symbol in flagged.index]
    return {
        "count": len(names),
        "symbols": names,
        "strongest": (
            str(flagged["zscore"].abs().idxmax()) if not flagged.empty else None
        ),
        "details": [
            {
                "symbol": str(symbol),
                "zscore": float(flagged.loc[symbol, "zscore"]),
                "vol_ratio": float(flagged.loc[symbol, "vol_ratio"]),
                "note": str(flagged.loc[symbol, "note"]),
            }
            for symbol in names[:5]
        ],
    }
