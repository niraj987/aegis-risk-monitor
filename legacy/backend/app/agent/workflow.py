"""The agent workflow.

A small, explicit state machine instead of a heavyweight framework:

    monitor -> investigate -> explain -> recommend -> human review

Routing is conditional: when no limit is breached, the workflow records a
clean pass and queues nothing. Every node appends a step to the trace, which is
stored with the snapshot and shown in the dashboard, so the reasoning is
auditable rather than hidden.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from ..config import Settings
from ..market.provider import load_prices
from ..risk.engine import build_snapshot
from .explain import rule_based_explanation

ALERT_TITLES = {
    "VAR_LIMIT": "Value-at-Risk above budget",
    "VOL_LIMIT": "Volatility running above budget",
    "DRAWDOWN_LIMIT": "Drawdown limit breached",
    "DAILY_MOVE": "Sharp single-session loss",
    "CONCENTRATION": "Position concentration above guideline",
    "UNUSUAL_ACTIVITY": "Unusual price behaviour detected",
}

SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _step(
    trace: list[dict[str, Any]],
    node: str,
    label: str,
    detail: str,
    started: float,
    status: str = "done",
    tool: str | None = None,
) -> None:
    trace.append(
        {
            "node": node,
            "label": label,
            "status": status,
            "detail": detail,
            "tool": tool,
            "at": _now(),
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }
    )


def monitor_node(
    portfolio: list[dict[str, Any]],
    limits: dict[str, float],
    settings: Settings,
) -> tuple[dict[str, Any], str]:
    """Fetch prices and compute the full risk snapshot."""
    symbols = [item["symbol"] for item in portfolio]
    sectors = {item["symbol"]: item.get("sector", "Diversified") for item in portfolio}
    prices = load_prices(symbols, days=settings.history_days, sectors=sectors)
    snapshot = build_snapshot(
        prices=prices.prices,
        portfolio=portfolio,
        portfolio_value=settings.portfolio_value,
        limits=limits,
        data_source=prices.source,
        seed=settings.random_seed,
    )
    snapshot["fetched_at"] = prices.fetched_at
    detail = (
        f"Loaded {snapshot['metrics']['observations']} sessions to {snapshot['as_of']} "
        f"from {prices.source}. 1-day 95% VaR is {snapshot['metrics']['var_95_1d'] * 100:.2f}% of NAV."
    )
    return snapshot, detail


def investigate_node(snapshot: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Turn the snapshot into a compact evidence bundle."""
    metrics = snapshot["metrics"]
    assets = snapshot["assets"]
    anomalies = snapshot["anomalies"]
    contributors = [
        {
            "symbol": asset["symbol"],
            "name": asset["name"],
            "risk_share": asset["risk_share"],
            "weight": asset["weight"],
        }
        for asset in assets[:3]
    ]
    findings = {
        "breach_count": len(snapshot["breaches"]),
        "severity": (
            min(snapshot["breaches"], key=lambda item: SEVERITY_RANK.get(item["severity"], 9))["severity"]
            if snapshot["breaches"]
            else "none"
        ),
        "top_contributors": contributors,
        "anomaly_count": anomalies["count"],
        "anomaly_symbols": anomalies["symbols"],
        "latest_return": metrics["latest_return"],
        "worst_day": metrics["worst_day"],
    }
    if snapshot["breaches"]:
        detail = (
            f"Checked the evidence against {len(snapshot['breaches'])} limit "
            f"rule{'s' if len(snapshot['breaches']) != 1 else ''}. "
            f"The largest risk contributor is {contributors[0]['symbol']} "
            f"({contributors[0]['risk_share'] * 100:.0f}% of total risk); "
            f"{anomalies['count']} position{'s' if anomalies['count'] != 1 else ''} "
            f"{'show' if anomalies['count'] != 1 else 'shows'} unusual behaviour."
        )
    else:
        detail = (
            "Checked every limit rule: no breaches. "
            f"{anomalies['count']} position(s) show unusual behaviour that remains within appetite."
        )
    return findings, detail


def recommend_node(explanation: dict[str, Any], findings: dict[str, Any]) -> tuple[list[str], str]:
    actions = explanation.get("actions") or []
    detail = (
        f"Prepared {len(actions)} suggested next step(s). "
        "Nothing is executed automatically; the queue waits for a human reviewer."
    )
    return actions, detail


def build_alerts(
    *,
    run_id: int,
    snapshot: dict[str, Any],
    actions: list[str],
    trace: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """One alert per breached rule, newest evidence attached."""
    assets = snapshot["assets"]
    top = [
        {"symbol": asset["symbol"], "risk_share": asset["risk_share"], "weight": asset["weight"]}
        for asset in assets[:3]
    ]
    alerts: list[dict[str, Any]] = []
    for breach in snapshot["breaches"]:
        is_count = breach.get("unit") == "count"
        evidence = {
            "metric": breach["metric"],
            "observed_pct": breach["observed"],
            "limit_pct": breach["limit"],
            "observed_label": (
                f"{int(breach['observed'])} position{'s' if breach['observed'] != 1 else ''}"
                if is_count
                else f"{breach['observed']:.2f}%"
            ),
            "limit_label": "No fixed limit" if is_count else f"{breach['limit']:.2f}%",
            "as_of": snapshot["as_of"],
            "data_source": snapshot["data_source"],
            "health_score": snapshot["health"]["score"],
            "top_risk_contributors": top,
        }
        if breach["code"] == "UNUSUAL_ACTIVITY":
            evidence["flagged"] = snapshot["anomalies"]["details"]
        alerts.append(
            {
                "run_id": run_id,
                "severity": breach["severity"],
                "code": breach["code"],
                "title": ALERT_TITLES.get(breach["code"], breach["metric"]),
                "message": breach["message"],
                "evidence": evidence,
                "actions": actions,
                "trace": trace,
            }
        )
    alerts.sort(key=lambda item: SEVERITY_RANK.get(item["severity"], 9))
    return alerts


async def execute_workflow(
    *,
    portfolio: list[dict[str, Any]],
    limits: dict[str, float],
    settings: Settings,
    run_id: int,
) -> dict[str, Any]:
    """Run the five nodes and return everything the service needs to persist."""
    from .explain import explain

    trace: list[dict[str, Any]] = []

    started = time.perf_counter()
    snapshot, detail = await asyncio.to_thread(monitor_node, portfolio, limits, settings)
    _step(trace, "monitor", "Monitor", detail, started, tool="market data + risk engine")

    started = time.perf_counter()
    findings, detail = investigate_node(snapshot)
    _step(trace, "investigate", "Investigate", detail, started, tool="anomaly detector")

    started = time.perf_counter()
    if snapshot["breaches"]:
        explanation = await explain(snapshot, findings, limits, settings)
        breach_word = "breach" if findings["breach_count"] == 1 else "breaches"
        detail = (
            f"Explained the {findings['breach_count']} {breach_word} in plain English "
            f"using the {explanation['mode']} narrative."
        )
    else:
        explanation = rule_based_explanation(snapshot, findings, limits)
        detail = "No breach, so a short status note was recorded instead of an alert explanation."
    _step(
        trace,
        "explain",
        "Explain",
        detail,
        started,
        tool=explanation.get("model") or "deterministic template",
    )

    started = time.perf_counter()
    actions, detail = recommend_node(explanation, findings)
    _step(trace, "recommend", "Recommend", detail, started)

    started = time.perf_counter()
    alerts = build_alerts(run_id=run_id, snapshot=snapshot, actions=actions, trace=trace)
    if alerts:
        detail = (
            f"Queued {len(alerts)} alert(s) for human review. "
            "No position, hedge or limit was changed automatically."
        )
        status = "awaiting_review"
    else:
        detail = "Result is within appetite; nothing queued for review."
        status = "clear"
    _step(trace, "human_review", "Human review", detail, started, status=status)

    return {
        "snapshot": snapshot,
        "findings": findings,
        "explanation": explanation,
        "actions": actions,
        "alerts": alerts,
        "trace": trace,
    }
