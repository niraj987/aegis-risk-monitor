"""FastAPI application for the portfolio risk monitor."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db
from .config import get_settings
from .schemas import AlertReview, LimitUpdate, PortfolioUpdate
from .services import portfolio as portfolio_service
from .services.monitor import BusyError, MonitorService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger("risk_monitor")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    service = MonitorService(settings)
    app.state.service = service
    app.state.scheduler = None

    if settings.scheduler_enabled:
        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(
            service.scheduled_tick,
            "interval",
            seconds=settings.monitor_interval_seconds,
            id="risk-monitor",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        scheduler.start()
        app.state.scheduler = scheduler
        logger.info("scheduler started: cycle every %ss", settings.monitor_interval_seconds)

    try:
        if db.latest_snapshot() is None:
            await service.run_cycle(trigger="startup", actor="system")
    except Exception:
        logger.exception("initial monitoring cycle failed; the API stays available")

    yield

    if app.state.scheduler is not None:
        app.state.scheduler.shutdown(wait=False)


app = FastAPI(
    title="Aegis Risk Monitor",
    version="1.0.0",
    description=(
        "Near-real-time portfolio risk monitoring: VaR, Expected Shortfall, drawdowns, "
        "anomaly detection and an explainable agent workflow with human-in-the-loop review."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)


def _scheduler_state(app: FastAPI) -> dict[str, Any]:
    scheduler: AsyncIOScheduler | None = app.state.scheduler
    next_run = None
    if scheduler is not None:
        job = scheduler.get_job("risk-monitor")
        if job is not None and job.next_run_time is not None:
            next_run = job.next_run_time.isoformat(timespec="seconds")
    return {
        "enabled": scheduler is not None,
        "interval_seconds": settings.monitor_interval_seconds,
        "next_run": next_run,
    }


def overview(app: FastAPI, history_limit: int = 40) -> dict[str, Any]:
    snapshot = db.latest_snapshot()
    if snapshot is None:
        raise HTTPException(
            status_code=503,
            detail="No risk snapshot yet. Start a cycle with POST /api/run.",
        )

    portfolio = portfolio_service.get_portfolio()
    limits = portfolio_service.get_limits()
    run = db.latest_run() or {}

    return {
        "generated_at": db.utc_now(),
        "snapshot": snapshot,
        "run": run,
        "alerts": db.list_alerts(25),
        "history": db.snapshot_history(history_limit),
        "audit": db.list_audit(12),
        "config": {
            "portfolio": portfolio,
            "limits": limits,
            "portfolio_value": settings.portfolio_value,
            "scheduler": _scheduler_state(app),
            "llm": {
                "enabled": settings.llm_enabled,
                "mode": (snapshot.get("explanation") or {}).get("mode", "rule-based"),
                "model": (snapshot.get("explanation") or {}).get("model"),
            },
            "data_source_setting": settings.data_source,
        },
        "stats": {
            "open_alerts": db.open_alert_count(),
            "positions": len(portfolio),
        },
    }


@app.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    try:
        run = db.latest_run()
        database_ok = True
    except Exception:
        logger.exception("database health check failed")
        run = None
        database_ok = False

    return {
        "status": "ok" if database_ok else "degraded",
        "service": "aegis-risk-monitor",
        "version": app.version,
        "database": database_ok,
        "llm_enabled": settings.llm_enabled,
        "scheduler": _scheduler_state(request.app),
        "last_run": run,
    }


@app.get("/api/overview")
def get_overview(
    request: Request,
    history: int = Query(default=40, ge=5, le=200),
) -> dict[str, Any]:
    return overview(request.app, history)


@app.get("/api/portfolio")
def get_portfolio() -> dict[str, Any]:
    return {"portfolio": portfolio_service.get_portfolio(), "limits": portfolio_service.get_limits()}


@app.put("/api/portfolio")
async def update_portfolio(payload: PortfolioUpdate, request: Request) -> dict[str, Any]:
    holdings = [
        {
            "symbol": item.symbol,
            "name": item.name or item.symbol,
            "sector": item.sector or "Diversified",
            "weight": item.weight,
        }
        for item in payload.holdings
    ]
    saved = portfolio_service.save_portfolio(holdings)
    db.audit(
        "api",
        "portfolio_updated",
        "New weights: "
        + ", ".join(f"{item['symbol']} {item['weight'] * 100:.1f}%" for item in saved),
    )
    try:
        await request.app.state.service.run_cycle(trigger="portfolio_change", actor="api")
    except BusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Re-run failed: {exc}") from exc
    return overview(request.app)


@app.put("/api/limits")
async def update_limits(payload: LimitUpdate, request: Request) -> dict[str, Any]:
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide at least one limit to update")

    current = portfolio_service.get_limits()
    current.update(changes)
    saved = portfolio_service.save_limits(current)
    db.audit(
        "api",
        "limits_updated",
        "Risk limits: " + ", ".join(f"{key}={value}" for key, value in changes.items()),
    )
    try:
        await request.app.state.service.run_cycle(trigger="limits_change", actor="api")
    except BusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Re-run failed: {exc}") from exc
    return overview(request.app)


@app.post("/api/run")
async def run_now(request: Request) -> dict[str, Any]:
    try:
        await request.app.state.service.run_cycle(trigger="manual", actor="api")
    except BusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Monitoring run failed: {exc}") from exc
    return overview(request.app)


@app.get("/api/alerts")
def get_alerts(limit: int = Query(default=25, ge=1, le=100)) -> dict[str, Any]:
    return {"alerts": db.list_alerts(limit)}


@app.post("/api/alerts/{alert_id}/review")
def review_alert(alert_id: int, payload: AlertReview) -> dict[str, Any]:
    alert = db.get_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    db.review_alert(alert_id, payload.status, payload.reviewer)
    db.audit(
        payload.reviewer,
        f"alert_{payload.status}",
        f"Alert #{alert_id} ({alert['code']}) marked {payload.status}.",
    )
    return {"alert": db.get_alert(alert_id)}


@app.get("/api/audit")
def get_audit(limit: int = Query(default=30, ge=1, le=200)) -> dict[str, Any]:
    return {"audit": db.list_audit(limit)}


# Serve the built dashboard from the same container when it exists. In the
# Docker setup nginx handles this, but the mount makes a single-process deploy
# (and `uvicorn app.main:app`) work out of the box.
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="dashboard")
