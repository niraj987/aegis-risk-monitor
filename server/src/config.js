import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");
const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");

// Load a project-level .env when present. Existing environment variables win.
try {
  process.loadEnvFile?.(path.join(PROJECT_ROOT, ".env"));
} catch {
  /* no .env file is a perfectly valid setup */
}

function asInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) ? value : fallback;
}

function asNumber(raw, fallback) {
  const value = Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(value) ? value : fallback;
}

function asBool(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function readSettings() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(SERVER_ROOT, "data"));
  const origins = String(
    process.env.ALLOWED_ORIGINS ||
      "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    dataDir,
    dbPath: path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "risk_monitor.sqlite3")),
    cacheDir: path.join(dataDir, "cache"),
    dataSource: String(process.env.DATA_SOURCE || "auto").toLowerCase(),
    historyDays: Math.min(1500, Math.max(120, asInt(process.env.HISTORY_DAYS, 756))),
    portfolioValue: asNumber(process.env.PORTFOLIO_VALUE, 1_000_000),
    monitorIntervalSeconds: Math.max(15, asInt(process.env.MONITOR_INTERVAL_SECONDS, 900)),
    schedulerEnabled: asBool(process.env.SCHEDULER_ENABLED, true),
    randomSeed: asInt(process.env.RANDOM_SEED, 42),
    llmApiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    llmBaseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    llmModel: String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
    llmTimeoutMs: asNumber(process.env.LLM_TIMEOUT_SECONDS, 25) * 1000,
    allowedOrigins: origins,
    // PORT=0 (an inherited value in some shells) means "any free port"; fall back
    // to the documented port instead of silently binding something random.
    port: asInt(process.env.PORT, 4000) > 0 ? asInt(process.env.PORT, 4000) : 4000,
    version: "2.0.0",
  };
}

export const settings = readSettings();

export function llmEnabled() {
  return Boolean(settings.llmApiKey);
}
