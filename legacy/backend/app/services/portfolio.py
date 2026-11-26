"""Portfolio and limit configuration, persisted alongside the audit trail."""

from __future__ import annotations

from typing import Any

from .. import db
from ..market.universe import DEFAULT_LIMITS, DEFAULT_PORTFOLIO, normalise_weights, sanitise_limits


def get_portfolio() -> list[dict[str, Any]]:
    stored = db.get_setting("portfolio")
    if not stored:
        db.put_setting("portfolio", DEFAULT_PORTFOLIO)
        return [dict(item) for item in DEFAULT_PORTFOLIO]
    return normalise_weights(stored)


def save_portfolio(holdings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    portfolio = normalise_weights(holdings)
    db.put_setting("portfolio", portfolio)
    return portfolio


def get_limits() -> dict[str, float]:
    stored = db.get_setting("limits")
    if not stored:
        db.put_setting("limits", DEFAULT_LIMITS)
        return dict(DEFAULT_LIMITS)
    return sanitise_limits(stored)


def save_limits(limits: dict[str, Any]) -> dict[str, float]:
    cleaned = sanitise_limits(limits)
    db.put_setting("limits", cleaned)
    return cleaned
