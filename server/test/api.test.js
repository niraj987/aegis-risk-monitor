import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-api-"));
process.env.DATA_DIR = dataDir;
process.env.DATA_SOURCE = "synthetic";
process.env.SCHEDULER_ENABLED = "false";

const { createApp } = await import("../src/app.js");
const { createMonitor } = await import("../src/monitor.js");
const db = await import("../src/db.js");

const monitor = createMonitor({ logger: { info() {}, error() {} } });
const app = createApp({
  monitor,
  scheduler: {
    status: () => ({ enabled: false, interval_seconds: 0, next_run: null }),
    stop: () => {},
  },
});

let server;
let base;

before(async () => {
  await monitor.runCycle("test", "test");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const json = async (url, options) => {
  const response = await fetch(`${base}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json();
  return { status: response.status, body };
};

test("health reports a working database", async () => {
  const { status, body } = await json("/api/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.database, true);
});

test("overview returns a complete snapshot", async () => {
  const { status, body } = await json("/api/overview");
  assert.equal(status, 200);
  assert.ok(body.snapshot.metrics.var_95_1d > 0);
  assert.equal(body.snapshot.data_source.startsWith("synthetic"), true);
  assert.equal(body.snapshot.assets.length, body.config.portfolio.length);
  assert.equal(body.config.scheduler.enabled, false);
  assert.ok(Array.isArray(body.alerts));
});

test("manual runs append to the history", async () => {
  const beforeRun = await json("/api/overview?history=200");
  const run = await json("/api/run", { method: "POST", body: "{}" });
  assert.equal(run.status, 200);
  const afterRun = await json("/api/overview?history=200");
  assert.equal(afterRun.body.history.length, beforeRun.body.history.length + 1);
});

test("tight limits create one open alert per rule", async () => {
  const first = await json("/api/limits", {
    method: "PUT",
    body: JSON.stringify({ var_95_limit_pct: 0.05 }),
  });
  assert.equal(first.status, 200);
  const open = first.body.alerts.filter((alert) => alert.status === "open");
  assert.ok(open.some((alert) => alert.code === "VAR_LIMIT"));

  const second = await json("/api/run", { method: "POST", body: "{}" });
  const openAfter = second.body.alerts.filter((alert) => alert.status === "open");
  const codes = openAfter.map((alert) => alert.code);
  assert.equal(new Set(codes).size, codes.length, "one open alert per rule");
});

test("an alert can be acknowledged and lands in the audit trail", async () => {
  const { body } = await json("/api/alerts");
  const alert = body.alerts[0];
  assert.ok(alert);

  const reviewed = await json(`/api/alerts/${alert.id}/review`, {
    method: "POST",
    body: JSON.stringify({ status: "acknowledged", reviewer: "Test Reviewer" }),
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.alert.status, "acknowledged");

  const audit = await json("/api/audit");
  assert.ok(audit.body.audit.some((entry) => entry.action === "alert_acknowledged"));
});

test("portfolio weights are normalised", async () => {
  const { status, body } = await json("/api/portfolio", {
    method: "PUT",
    body: JSON.stringify({
      holdings: [
        { symbol: "AAPL", name: "Apple", sector: "Technology", weight: 0.6 },
        { symbol: "GLD", name: "Gold ETF", sector: "Commodities", weight: 0.2 },
      ],
    }),
  });
  assert.equal(status, 200);
  const total = body.config.portfolio.reduce((sum, item) => sum + item.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
});

test("stress endpoint returns a projected loss", async () => {
  const { status, body } = await json("/api/stress?shock=-10");
  assert.equal(status, 200);
  assert.ok(body.estimated_pnl < 0);
  assert.ok(body.projected_value < body.estimated_pnl + 1_000_000 + 1);
  assert.ok(body.impacts.length >= 2);
});

test("invalid tickers and unknown routes are rejected", async () => {
  const invalid = await json("/api/portfolio", {
    method: "PUT",
    body: JSON.stringify({
      holdings: [
        { symbol: "BAD SYMBOL", weight: 0.5 },
        { symbol: "AAA", weight: 0.5 },
      ],
    }),
  });
  assert.equal(invalid.status, 422);

  const missing = await json("/api/nope");
  assert.equal(missing.status, 404);
});
