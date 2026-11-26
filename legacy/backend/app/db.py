"""SQLite persistence: runs, risk snapshots, alerts, audit trail and settings.

The module intentionally uses the standard library only so a fresh checkout can
run without any database server. Every write is committed in one transaction.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
    run_id INTEGER PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    as_of TEXT NOT NULL,
    data_source TEXT NOT NULL,
    metrics TEXT NOT NULL,
    assets TEXT NOT NULL,
    portfolio TEXT NOT NULL,
    curves TEXT NOT NULL,
    breaches TEXT NOT NULL,
    health TEXT NOT NULL,
    explanation TEXT,
    trace TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    severity TEXT NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    evidence TEXT NOT NULL,
    actions TEXT NOT NULL,
    trace TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reviewed_by TEXT,
    reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
"""


def utc_now() -> str:
    """Timezone-aware ISO timestamp used everywhere in the audit trail."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    settings = get_settings()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        conn.executescript(SCHEMA)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def _fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with connection() as conn:
        row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def _execute(sql: str, params: tuple[Any, ...] = ()) -> int:
    with connection() as conn:
        cursor = conn.execute(sql, params)
        return int(cursor.lastrowid or 0)


# --------------------------------------------------------------------------- #
# Runs and snapshots
# --------------------------------------------------------------------------- #
def create_run(trigger: str) -> int:
    return _execute(
        "INSERT INTO runs (started_at, trigger, status) VALUES (?, ?, ?)",
        (utc_now(), trigger, "running"),
    )


def finish_run(run_id: int, status: str, summary: str, duration_ms: int) -> None:
    with connection() as conn:
        conn.execute(
            "UPDATE runs SET finished_at = ?, status = ?, summary = ?, duration_ms = ? WHERE id = ?",
            (utc_now(), status, summary, duration_ms, run_id),
        )


def save_snapshot(run_id: int, snapshot: dict[str, Any], explanation: dict[str, Any], trace: list[dict[str, Any]]) -> None:
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO snapshots
                (run_id, created_at, as_of, data_source, metrics, assets, portfolio,
                 curves, breaches, health, explanation, trace)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                utc_now(),
                snapshot["as_of"],
                snapshot["data_source"],
                json.dumps(snapshot["metrics"]),
                json.dumps(snapshot["assets"]),
                json.dumps(snapshot["portfolio"]),
                json.dumps(snapshot["curves"]),
                json.dumps(snapshot["breaches"]),
                json.dumps(snapshot["health"]),
                json.dumps(explanation),
                json.dumps(trace),
            ),
        )


def _expand_snapshot(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "run_id": row["run_id"],
        "created_at": row["created_at"],
        "as_of": row["as_of"],
        "data_source": row["data_source"],
        "metrics": json.loads(row["metrics"]),
        "assets": json.loads(row["assets"]),
        "portfolio": json.loads(row["portfolio"]),
        "curves": json.loads(row["curves"]),
        "breaches": json.loads(row["breaches"]),
        "health": json.loads(row["health"]),
        "explanation": json.loads(row["explanation"]) if row["explanation"] else None,
        "trace": json.loads(row["trace"]) if row["trace"] else [],
    }


def latest_snapshot() -> dict[str, Any] | None:
    return _expand_snapshot(_fetch_one("SELECT * FROM snapshots ORDER BY created_at DESC, run_id DESC LIMIT 1"))


def snapshot_history(limit: int = 40) -> list[dict[str, Any]]:
    rows = _fetch_all(
        """
        SELECT s.created_at, s.as_of, s.metrics, s.health
        FROM snapshots s
        ORDER BY s.created_at DESC, s.run_id DESC
        LIMIT ?
        """,
        (max(1, min(limit, 365)),),
    )
    history = [
        {
            "created_at": row["created_at"],
            "as_of": row["as_of"],
            "metrics": json.loads(row["metrics"]),
            "health": json.loads(row["health"]),
        }
        for row in rows
    ]
    return list(reversed(history))


def latest_run() -> dict[str, Any] | None:
    return _fetch_one("SELECT * FROM runs ORDER BY id DESC LIMIT 1")


# --------------------------------------------------------------------------- #
# Alerts (human-in-the-loop review queue)
# --------------------------------------------------------------------------- #
def insert_alert(alert: dict[str, Any]) -> int:
    return _execute(
        """
        INSERT INTO alerts
            (run_id, created_at, severity, code, title, message, evidence, actions, trace)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            alert.get("run_id"),
            alert.get("created_at", utc_now()),
            alert["severity"],
            alert["code"],
            alert["title"],
            alert["message"],
            json.dumps(alert.get("evidence", {})),
            json.dumps(alert.get("actions", [])),
            json.dumps(alert.get("trace", [])),
        ),
    )


def upsert_alert(alert: dict[str, Any]) -> int:
    """Keep one open alert per rule so repeated cycles do not spam the queue."""
    payload = (
        alert.get("run_id"),
        alert.get("created_at", utc_now()),
        alert["severity"],
        alert["title"],
        alert["message"],
        json.dumps(alert.get("evidence", {})),
        json.dumps(alert.get("actions", [])),
        json.dumps(alert.get("trace", [])),
        alert["code"],
    )
    with connection() as conn:
        existing = conn.execute(
            "SELECT id FROM alerts WHERE code = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
            (alert["code"],),
        ).fetchone()
        if existing is not None:
            conn.execute(
                """
                UPDATE alerts
                SET run_id = ?, created_at = ?, severity = ?, title = ?, message = ?,
                    evidence = ?, actions = ?, trace = ?
                WHERE code = ? AND id = ?
                """,
                payload + (existing["id"],),
            )
            return int(existing["id"])

        cursor = conn.execute(
            """
            INSERT INTO alerts
                (run_id, created_at, severity, code, title, message, evidence, actions, trace)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                alert.get("run_id"),
                alert.get("created_at", utc_now()),
                alert["severity"],
                alert["code"],
                alert["title"],
                alert["message"],
                json.dumps(alert.get("evidence", {})),
                json.dumps(alert.get("actions", [])),
                json.dumps(alert.get("trace", [])),
            ),
        )
        return int(cursor.lastrowid or 0)


def list_alerts(limit: int = 25) -> list[dict[str, Any]]:
    rows = _fetch_all(
        "SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?",
        (max(1, min(limit, 200)),),
    )
    alerts: list[dict[str, Any]] = []
    for row in rows:
        alerts.append(
            {
                "id": row["id"],
                "run_id": row["run_id"],
                "created_at": row["created_at"],
                "severity": row["severity"],
                "code": row["code"],
                "title": row["title"],
                "message": row["message"],
                "evidence": json.loads(row["evidence"]),
                "actions": json.loads(row["actions"]),
                "trace": json.loads(row["trace"]),
                "status": row["status"],
                "reviewed_by": row["reviewed_by"],
                "reviewed_at": row["reviewed_at"],
            }
        )
    return alerts


def get_alert(alert_id: int) -> dict[str, Any] | None:
    row = _fetch_one("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    if not row:
        return None
    row["evidence"] = json.loads(row["evidence"])
    row["actions"] = json.loads(row["actions"])
    row["trace"] = json.loads(row["trace"])
    return row


def review_alert(alert_id: int, status: str, reviewer: str) -> None:
    with connection() as conn:
        conn.execute(
            "UPDATE alerts SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
            (status, reviewer, utc_now(), alert_id),
        )


def open_alert_count() -> int:
    row = _fetch_one("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'")
    return int(row["n"]) if row else 0


# --------------------------------------------------------------------------- #
# Audit trail and settings
# --------------------------------------------------------------------------- #
def audit(actor: str, action: str, detail: str) -> None:
    _execute(
        "INSERT INTO audit_log (created_at, actor, action, detail) VALUES (?, ?, ?, ?)",
        (utc_now(), actor, action, detail),
    )


def list_audit(limit: int = 30) -> list[dict[str, Any]]:
    return _fetch_all(
        "SELECT id, created_at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?",
        (max(1, min(limit, 200)),),
    )


def get_setting(key: str) -> Any | None:
    row = _fetch_one("SELECT value FROM settings WHERE key = ?", (key,))
    return json.loads(row["value"]) if row else None


def put_setting(key: str, value: Any) -> None:
    with connection() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )
