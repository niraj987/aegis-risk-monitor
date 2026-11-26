import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { settings } from "./config.js";

const SCHEMA = `
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
`;

let database = null;

export function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function initDb() {
  if (database) return database;
  fs.mkdirSync(path.dirname(settings.dbPath), { recursive: true });
  database = new DatabaseSync(settings.dbPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(SCHEMA);
  return database;
}

export function closeDb() {
  if (database) {
    database.close();
    database = null;
  }
}

const parse = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// --------------------------------------------------------------------------- //
// Runs and snapshots
// --------------------------------------------------------------------------- //
export function createRun(trigger) {
  const result = initDb()
    .prepare("INSERT INTO runs (started_at, trigger, status) VALUES (?, ?, ?)")
    .run(utcNow(), trigger, "running");
  return Number(result.lastInsertRowid);
}

export function finishRun(runId, status, summary, durationMs) {
  initDb()
    .prepare("UPDATE runs SET finished_at = ?, status = ?, summary = ?, duration_ms = ? WHERE id = ?")
    .run(utcNow(), status, summary, durationMs, runId);
}

export function saveSnapshot(runId, snapshot, explanation, trace) {
  initDb()
    .prepare(
      `INSERT INTO snapshots
        (run_id, created_at, as_of, data_source, metrics, assets, portfolio,
         curves, breaches, health, explanation, trace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      utcNow(),
      snapshot.as_of,
      snapshot.data_source,
      JSON.stringify(snapshot.metrics),
      JSON.stringify(snapshot.assets),
      JSON.stringify(snapshot.portfolio),
      JSON.stringify(snapshot.curves),
      JSON.stringify(snapshot.breaches),
      JSON.stringify(snapshot.health),
      JSON.stringify(explanation),
      JSON.stringify(trace),
    );
}

function expandSnapshot(row) {
  if (!row) return null;
  return {
    run_id: Number(row.run_id),
    created_at: row.created_at,
    as_of: row.as_of,
    data_source: row.data_source,
    metrics: parse(row.metrics, {}),
    assets: parse(row.assets, []),
    portfolio: parse(row.portfolio, {}),
    curves: parse(row.curves, {}),
    breaches: parse(row.breaches, []),
    health: parse(row.health, {}),
    explanation: parse(row.explanation),
    trace: parse(row.trace, []),
  };
}

export function latestSnapshot() {
  return expandSnapshot(
    initDb().prepare("SELECT * FROM snapshots ORDER BY created_at DESC, run_id DESC LIMIT 1").get(),
  );
}

export function snapshotHistory(limit = 40) {
  const rows = initDb()
    .prepare(
      `SELECT created_at, as_of, metrics, health FROM snapshots
       ORDER BY created_at DESC, run_id DESC LIMIT ?`,
    )
    .all(Math.min(365, Math.max(1, limit)));

  return rows
    .map((row) => ({
      created_at: row.created_at,
      as_of: row.as_of,
      metrics: parse(row.metrics, {}),
      health: parse(row.health, {}),
    }))
    .reverse();
}

export function latestRun() {
  const row = initDb().prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get();
  if (!row) return {};
  return { ...row, id: Number(row.id) };
}

// --------------------------------------------------------------------------- //
// Alerts — one open alert per rule
// --------------------------------------------------------------------------- //
export function upsertAlert(alert) {
  const databaseHandle = initDb();
  const createdAt = alert.created_at || utcNow();
  const existing = databaseHandle
    .prepare("SELECT id FROM alerts WHERE code = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(alert.code);

  if (existing) {
    databaseHandle
      .prepare(
        `UPDATE alerts SET run_id = ?, created_at = ?, severity = ?, title = ?, message = ?,
         evidence = ?, actions = ?, trace = ? WHERE id = ?`,
      )
      .run(
        alert.run_id,
        createdAt,
        alert.severity,
        alert.title,
        alert.message,
        JSON.stringify(alert.evidence || {}),
        JSON.stringify(alert.actions || []),
        JSON.stringify(alert.trace || []),
        existing.id,
      );
    return Number(existing.id);
  }

  const result = databaseHandle
    .prepare(
      `INSERT INTO alerts
        (run_id, created_at, severity, code, title, message, evidence, actions, trace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      alert.run_id,
      createdAt,
      alert.severity,
      alert.code,
      alert.title,
      alert.message,
      JSON.stringify(alert.evidence || {}),
      JSON.stringify(alert.actions || []),
      JSON.stringify(alert.trace || []),
    );
  return Number(result.lastInsertRowid);
}

export function listAlerts(limit = 25) {
  return initDb()
    .prepare("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(Math.min(200, Math.max(1, limit)))
    .map((row) => ({
      ...row,
      id: Number(row.id),
      run_id: row.run_id === null ? null : Number(row.run_id),
      evidence: parse(row.evidence, {}),
      actions: parse(row.actions, []),
      trace: parse(row.trace, []),
    }));
}

export function getAlert(alertId) {
  const row = initDb().prepare("SELECT * FROM alerts WHERE id = ?").get(alertId);
  if (!row) return null;
  return {
    ...row,
    evidence: parse(row.evidence, {}),
    actions: parse(row.actions, []),
    trace: parse(row.trace, []),
  };
}

export function reviewAlert(alertId, status, reviewer) {
  initDb()
    .prepare("UPDATE alerts SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
    .run(status, reviewer, utcNow(), alertId);
}

export function openAlertCount() {
  const row = initDb().prepare("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'").get();
  return Number(row.n);
}

// --------------------------------------------------------------------------- //
// Audit trail and settings
// --------------------------------------------------------------------------- //
export function audit(actor, action, detail) {
  initDb()
    .prepare("INSERT INTO audit_log (created_at, actor, action, detail) VALUES (?, ?, ?, ?)")
    .run(utcNow(), actor, action, detail);
}

export function listAudit(limit = 30) {
  return initDb()
    .prepare("SELECT id, created_at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(Math.min(200, Math.max(1, limit)));
}

export function getSetting(key) {
  const row = initDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? parse(row.value) : null;
}

export function putSetting(key, value) {
  initDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(value));
}
