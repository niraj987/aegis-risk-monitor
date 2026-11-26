from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# Configure the app before importing it: isolated database, offline data feed.
TEMP_DIR = tempfile.mkdtemp(prefix="aegis-test-")
os.environ["DATABASE_PATH"] = str(Path(TEMP_DIR) / "test.sqlite3")
os.environ["RISK_DATA_DIR"] = TEMP_DIR
os.environ["DATA_SOURCE"] = "synthetic"
os.environ["SCHEDULER_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_is_reachable(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] is True


def test_overview_has_a_snapshot(client: TestClient) -> None:
    response = client.get("/api/overview")
    assert response.status_code == 200
    body = response.json()

    snapshot = body["snapshot"]
    assert snapshot["metrics"]["var_95_1d"] > 0
    assert snapshot["metrics"]["es_95_1d"] >= snapshot["metrics"]["var_95_1d"]
    assert snapshot["data_source"].startswith("synthetic")
    assert len(snapshot["assets"]) == len(body["config"]["portfolio"])
    assert body["config"]["scheduler"]["enabled"] is False
    assert isinstance(body["alerts"], list)
    assert body["run"]["status"] in {"success", "attention"}


def test_manual_run_appends_history(client: TestClient) -> None:
    before = len(client.get("/api/overview?history=200").json()["history"])
    response = client.post("/api/run")
    assert response.status_code == 200
    after = len(client.get("/api/overview?history=200").json()["history"])
    assert after == before + 1


def test_tight_limit_creates_and_reviews_alert(client: TestClient) -> None:
    response = client.put("/api/limits", json={"var_95_limit_pct": 0.05})
    assert response.status_code == 200
    alerts = response.json()["alerts"]
    assert alerts, "a 0.05% VaR budget must breach"
    assert alerts[0]["status"] == "open"

    alert_id = alerts[0]["id"]
    reviewed = client.post(
        f"/api/alerts/{alert_id}/review",
        json={"status": "acknowledged", "reviewer": "Test Reviewer"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["alert"]["status"] == "acknowledged"

    audit = client.get("/api/audit").json()["audit"]
    assert any(entry["action"] == "alert_acknowledged" for entry in audit)


def test_repeated_runs_do_not_duplicate_open_alerts(client: TestClient) -> None:
    first = client.post("/api/run").json()
    second = client.post("/api/run").json()

    open_first = [item["code"] for item in first["alerts"] if item["status"] == "open"]
    open_second = [item["code"] for item in second["alerts"] if item["status"] == "open"]

    assert sorted(open_first) == sorted(open_second)
    assert len(open_second) == len(set(open_second)), "one open alert per rule"


def test_portfolio_weights_are_normalised(client: TestClient) -> None:
    response = client.put(
        "/api/portfolio",
        json={
            "holdings": [
                {"symbol": "AAPL", "name": "Apple", "sector": "Technology", "weight": 0.6},
                {"symbol": "GLD", "name": "Gold ETF", "sector": "Commodities", "weight": 0.2},
            ]
        },
    )
    assert response.status_code == 200
    portfolio = response.json()["config"]["portfolio"]
    assert sum(item["weight"] for item in portfolio) == pytest.approx(1.0, abs=1e-6)


def test_invalid_symbol_is_rejected(client: TestClient) -> None:
    response = client.put(
        "/api/portfolio",
        json={"holdings": [{"symbol": "BAD SYMBOL", "weight": 0.5}, {"symbol": "AAA", "weight": 0.5}]},
    )
    assert response.status_code == 422
