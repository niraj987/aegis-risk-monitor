"""Command-line entry points.

    python -m app.cli run     # one monitoring cycle, then exit
    python -m app.cli seed    # create the paper portfolio and run once
    python -m app.cli serve   # start the API (used by Docker)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

from .config import get_settings
from .services import portfolio as portfolio_service
from .services.monitor import BusyError, MonitorService


def _summary(result: dict[str, Any]) -> dict[str, Any]:
    snapshot = result["snapshot"]
    metrics = snapshot["metrics"]
    return {
        "run_id": result["run_id"],
        "status": result["status"],
        "as_of": snapshot["as_of"],
        "data_source": snapshot["data_source"],
        "health": snapshot["health"],
        "var_95_1d_pct": round(metrics["var_95_1d"] * 100, 3),
        "es_95_1d_pct": round(metrics["es_95_1d"] * 100, 3),
        "ann_vol_pct": round(metrics["ann_vol"] * 100, 3),
        "drawdown_pct": round(metrics["current_drawdown"] * 100, 3),
        "alerts": [
            {"severity": alert["severity"], "code": alert["code"], "title": alert["title"]}
            for alert in result["alerts"]
        ],
        "headline": result["explanation"]["headline"],
        "explanation_mode": result["explanation"]["mode"],
        "duration_ms": result["duration_ms"],
        "audit": "Saved to the audit trail; no action was executed automatically.",
    }


async def _run_once(trigger: str) -> dict[str, Any]:
    service = MonitorService(get_settings())
    try:
        return await service.run_cycle(trigger=trigger, actor="cli")
    except BusyError as exc:  # pragma: no cover - only with a shared database
        print(f"skipped: {exc}", file=sys.stderr)
        raise SystemExit(3)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="aegis", description="Portfolio risk monitor")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="run one monitoring cycle and exit")
    run_parser.add_argument("--trigger", default="cli")
    run_parser.add_argument("--json", action="store_true", help="print machine-readable output")

    subparsers.add_parser("seed", help="initialise the paper portfolio and run once")
    subparsers.add_parser("serve", help="serve the API")

    args = parser.parse_args(argv)

    if args.command == "serve":
        import uvicorn

        uvicorn.run(
            "app.main:app",
            host=os.getenv("HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", "8000")),
            log_level=os.getenv("LOG_LEVEL", "info").lower(),
        )
        return 0

    if args.command == "seed":
        portfolio = portfolio_service.get_portfolio()
        limits = portfolio_service.get_limits()
        print(f"portfolio: {len(portfolio)} positions; limits: {limits}")

    result = asyncio.run(_run_once(args.trigger if args.command == "run" else "seed"))
    summary = _summary(result)

    if getattr(args, "json", False):
        print(json.dumps(summary, indent=2))
    else:
        print(f"Run #{summary['run_id']} · {summary['status']} · {summary['as_of']}")
        print(f"  data source      {summary['data_source']}")
        print(f"  1-day VaR 95%    {summary['var_95_1d_pct']:.2f}% of NAV")
        print(f"  Expected shortfall {summary['es_95_1d_pct']:.2f}%")
        print(f"  Annualised vol   {summary['ann_vol_pct']:.1f}%")
        print(f"  Drawdown         {summary['drawdown_pct']:.2f}%")
        print(f"  Health score     {summary['health']['score']}/100 ({summary['health']['status']})")
        if summary["alerts"]:
            print("  Alerts queued for human review:")
            for alert in summary["alerts"]:
                print(f"    - [{alert['severity']}] {alert['title']}")
        else:
            print("  Alerts queued    none (inside appetite)")
        print(f"  Agent summary    {summary['headline']} ({summary['explanation_mode']})")
        print(f"  Completed in     {summary['duration_ms']} ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
