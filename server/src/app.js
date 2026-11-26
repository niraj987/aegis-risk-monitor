import express from "express";
import { llmEnabled, settings } from "./config.js";
import * as db from "./db.js";
import { getLimits, getPortfolio, saveLimits, savePortfolio } from "./portfolioStore.js";
import { stressScenario } from "./risk.js";

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const LIMIT_KEYS = [
  "var_95_limit_pct",
  "ann_vol_limit_pct",
  "max_drawdown_limit_pct",
  "daily_move_limit_pct",
  "concentration_limit_pct",
];

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

export function createApp({ monitor, scheduler }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));

  // CORS for direct API access from the Next.js dev server on another origin.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && settings.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  });

  function buildOverview(historyLimit = 40) {
    const snapshot = db.latestSnapshot();
    if (!snapshot) {
      throw httpError(503, "No risk snapshot yet. Start a cycle with POST /api/run.");
    }

    return {
      generated_at: db.utcNow(),
      snapshot,
      run: db.latestRun(),
      alerts: db.listAlerts(25),
      history: db.snapshotHistory(historyLimit),
      audit: db.listAudit(12),
      config: {
        portfolio: getPortfolio(),
        limits: getLimits(),
        portfolio_value: settings.portfolioValue,
        scheduler: scheduler.status(),
        llm: {
          enabled: llmEnabled(),
          mode: snapshot.explanation?.mode || "rule-based",
          model: snapshot.explanation?.model || null,
        },
        data_source_setting: settings.dataSource,
        version: settings.version,
      },
      stats: {
        open_alerts: db.openAlertCount(),
        positions: getPortfolio().length,
      },
    };
  }

  async function rerun(trigger) {
    await monitor.runCycle(trigger, "api");
    return buildOverview();
  }

  app.get("/", (req, res) => {
    res.json({
      service: "aegis-risk-api",
      version: settings.version,
      docs: "/api/health",
      ui: "Next.js dashboard runs separately on http://localhost:3000",
    });
  });

  app.get("/api/health", (req, res) => {
    try {
      res.json({
        status: "ok",
        service: "aegis-risk-api",
        version: settings.version,
        database: true,
        llm_enabled: llmEnabled(),
        scheduler: scheduler.status(),
        last_run: db.latestRun(),
      });
    } catch (error) {
      res.status(503).json({ status: "degraded", database: false, detail: error.message });
    }
  });

  app.get("/api/overview", (req, res) => {
    const history = Math.min(200, Math.max(5, Number.parseInt(req.query.history ?? "40", 10) || 40));
    res.json(buildOverview(history));
  });

  app.get("/api/portfolio", (req, res) => {
    res.json({ portfolio: getPortfolio(), limits: getLimits() });
  });

  app.put("/api/portfolio", async (req, res) => {
    const holdings = req.body?.holdings;
    if (!Array.isArray(holdings) || holdings.length < 2 || holdings.length > 30) {
      throw httpError(422, "Provide between 2 and 30 holdings.");
    }

    const seen = new Set();
    const cleaned = holdings.map((item) => {
      const symbol = String(item?.symbol || "").trim().toUpperCase();
      if (!SYMBOL_RE.test(symbol)) throw httpError(422, `Invalid ticker: ${item?.symbol}`);
      if (seen.has(symbol)) throw httpError(422, `Duplicate ticker: ${symbol}`);
      seen.add(symbol);

      const weight = Number(item?.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw httpError(422, `Weight for ${symbol} must be between 0 and 1.`);
      }
      return {
        symbol,
        name: String(item?.name || symbol).slice(0, 60),
        sector: String(item?.sector || "Diversified").slice(0, 40),
        weight,
      };
    });

    if (cleaned.reduce((sum, item) => sum + item.weight, 0) <= 0) {
      throw httpError(422, "At least one holding must have a positive weight.");
    }

    const saved = savePortfolio(cleaned);
    db.audit(
      "api",
      "portfolio_updated",
      `New weights: ${saved.map((item) => `${item.symbol} ${(item.weight * 100).toFixed(1)}%`).join(", ")}`,
    );
    res.json(await rerun("portfolio_change"));
  });

  app.put("/api/limits", async (req, res) => {
    const updates = {};
    for (const key of LIMIT_KEYS) {
      if (req.body?.[key] === undefined) continue;
      const value = Number(req.body[key]);
      if (!Number.isFinite(value) || value <= 0 || value > 200) {
        throw httpError(422, `${key} must be a positive number.`);
      }
      updates[key] = value;
    }
    if (!Object.keys(updates).length) throw httpError(422, "Provide at least one limit to update.");

    saveLimits({ ...getLimits(), ...updates });
    db.audit("api", "limits_updated", `Risk limits: ${Object.entries(updates).map(([key, value]) => `${key}=${value}`).join(", ")}`);
    res.json(await rerun("limits_change"));
  });

  app.post("/api/run", async (req, res) => {
    res.json(await rerun("manual"));
  });

  app.get("/api/alerts", (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit ?? "25", 10) || 25));
    res.json({ alerts: db.listAlerts(limit) });
  });

  app.post("/api/alerts/:id/review", (req, res) => {
    const alertId = Number.parseInt(req.params.id, 10);
    const status = String(req.body?.status || "acknowledged");
    if (!["acknowledged", "escalated", "dismissed"].includes(status)) {
      throw httpError(422, "status must be acknowledged, escalated or dismissed.");
    }
    const reviewer = String(req.body?.reviewer || "Portfolio Manager").slice(0, 80);
    const alert = db.getAlert(alertId);
    if (!alert) throw httpError(404, "Alert not found");

    db.reviewAlert(alertId, status, reviewer);
    db.audit(reviewer, `alert_${status}`, `Alert #${alertId} (${alert.code}) marked ${status}.`);
    res.json({ alert: db.getAlert(alertId) });
  });

  app.get("/api/audit", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit ?? "30", 10) || 30));
    res.json({ audit: db.listAudit(limit) });
  });

  app.get("/api/stress", (req, res) => {
    const snapshot = db.latestSnapshot();
    if (!snapshot) throw httpError(503, "No risk snapshot yet. Start a cycle first.");
    const shock = Math.min(20, Math.max(-60, Number(req.query.shock ?? -10) || -10));
    res.json(stressScenario(snapshot, shock));
  });

  app.use((req, res) => {
    res.status(404).json({ detail: `No route for ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || (error.name === "BusyError" ? 409 : 500);
    if (statusCode >= 500) console.error(error);
    res.status(statusCode).json({
      detail: statusCode >= 500 ? `Request failed: ${error.message}` : error.message,
    });
  });

  return app;
}
