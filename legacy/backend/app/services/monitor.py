"""Orchestrates one monitoring cycle: compute, persist, audit."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .. import db
from ..agent.workflow import execute_workflow
from ..config import Settings, get_settings
from . import portfolio as portfolio_service

logger = logging.getLogger("risk_monitor.cycle")


class BusyError(RuntimeError):
    """Raised when a cycle is already in flight (scheduler and manual overlap)."""


class MonitorService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._lock = asyncio.Lock()

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    async def run_cycle(self, trigger: str = "manual", actor: str = "api") -> dict[str, Any]:
        if self._lock.locked():
            raise BusyError("A monitoring cycle is already running. Try again in a moment.")

        async with self._lock:
            run_id = db.create_run(trigger)
            started = time.perf_counter()
            db.audit(actor, "run_started", f"Cycle #{run_id} triggered by {trigger}.")

            try:
                portfolio = portfolio_service.get_portfolio()
                limits = portfolio_service.get_limits()
                result = await execute_workflow(
                    portfolio=portfolio,
                    limits=limits,
                    settings=self.settings,
                    run_id=run_id,
                )

                snapshot = result["snapshot"]
                explanation = result["explanation"]
                duration_ms = int((time.perf_counter() - started) * 1000)

                db.save_snapshot(run_id, snapshot, explanation, result["trace"])
                for alert in result["alerts"]:
                    db.upsert_alert(alert)

                status = "attention" if result["alerts"] else "success"
                db.finish_run(run_id, status, explanation["headline"], duration_ms)
                db.audit(
                    actor,
                    "run_completed",
                    f"Cycle #{run_id} finished in {duration_ms} ms with "
                    f"{len(result['alerts'])} alert(s); data source {snapshot['data_source']}.",
                )

                logger.info(
                    "cycle #%s done in %sms: %s alerts, health %s",
                    run_id,
                    duration_ms,
                    len(result["alerts"]),
                    snapshot["health"]["score"],
                )

                return {
                    **result,
                    "run_id": run_id,
                    "duration_ms": duration_ms,
                    "status": status,
                }
            except Exception as exc:
                duration_ms = int((time.perf_counter() - started) * 1000)
                db.finish_run(run_id, "failed", str(exc)[:280], duration_ms)
                db.audit(actor, "run_failed", f"Cycle #{run_id} failed: {type(exc).__name__}: {exc}")
                logger.exception("cycle #%s failed", run_id)
                raise

    async def scheduled_tick(self) -> None:
        if self._lock.locked():
            logger.info("scheduled tick skipped: a cycle is already running")
            return
        try:
            await self.run_cycle(trigger="schedule", actor="scheduler")
        except Exception:
            logger.exception("scheduled monitoring cycle failed")
