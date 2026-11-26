import { createApp } from "./app.js";
import { settings } from "./config.js";
import * as db from "./db.js";
import { createMonitor } from "./monitor.js";

function startScheduler(monitor) {
  const intervalMs = settings.monitorIntervalSeconds * 1000;
  let nextRunAt = Date.now() + intervalMs;

  const timer = setInterval(async () => {
    nextRunAt = Date.now() + intervalMs;
    if (monitor.isBusy()) return;
    try {
      await monitor.runCycle("schedule", "scheduler");
    } catch (error) {
      console.error(`scheduled cycle failed: ${error.message}`);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
    status: () => ({
      enabled: true,
      interval_seconds: settings.monitorIntervalSeconds,
      next_run: new Date(nextRunAt).toISOString(),
    }),
  };
}

function disabledScheduler() {
  return {
    stop: () => {},
    status: () => ({
      enabled: false,
      interval_seconds: settings.monitorIntervalSeconds,
      next_run: null,
    }),
  };
}

function summarise(result) {
  const snapshot = result.snapshot;
  const metrics = snapshot.metrics;
  return {
    run_id: result.run_id,
    status: result.status,
    as_of: snapshot.as_of,
    data_source: snapshot.data_source,
    health: snapshot.health,
    var_95_1d_pct: Number((metrics.var_95_1d * 100).toFixed(3)),
    es_95_1d_pct: Number((metrics.es_95_1d * 100).toFixed(3)),
    ann_vol_pct: Number((metrics.ann_vol * 100).toFixed(3)),
    drawdown_pct: Number((metrics.current_drawdown * 100).toFixed(3)),
    alerts: result.alerts.map((alert) => ({
      severity: alert.severity,
      code: alert.code,
      title: alert.title,
    })),
    headline: result.explanation.headline,
    explanation_mode: result.explanation.mode,
    duration_ms: result.duration_ms,
    audit: "Saved to the audit trail; no action was executed automatically.",
  };
}

function printSummary(summary) {
  console.log(`Run #${summary.run_id} · ${summary.status} · ${summary.as_of}`);
  console.log(`  data source         ${summary.data_source}`);
  console.log(`  1-day VaR 95%       ${summary.var_95_1d_pct.toFixed(2)}% of NAV`);
  console.log(`  Expected shortfall  ${summary.es_95_1d_pct.toFixed(2)}%`);
  console.log(`  Annualised vol      ${summary.ann_vol_pct.toFixed(1)}%`);
  console.log(`  Drawdown            ${summary.drawdown_pct.toFixed(2)}%`);
  console.log(`  Health score        ${summary.health.score}/100 (${summary.health.status})`);
  if (summary.alerts.length) {
    console.log("  Alerts queued for human review:");
    for (const alert of summary.alerts) console.log(`    - [${alert.severity}] ${alert.title}`);
  } else {
    console.log("  Alerts queued       none (inside appetite)");
  }
  console.log(`  Agent summary       ${summary.headline} (${summary.explanation_mode})`);
  console.log(`  Completed in        ${summary.duration_ms} ms`);
}

async function serve() {
  const monitor = createMonitor();
  const scheduler = settings.schedulerEnabled ? startScheduler(monitor) : disabledScheduler();

  try {
    if (!db.latestSnapshot()) await monitor.runCycle("startup", "system");
  } catch (error) {
    console.error(`initial monitoring cycle failed: ${error.message}`);
  }

  const app = createApp({ monitor, scheduler });
  const server = app.listen(settings.port, "0.0.0.0", () => {
    console.log(`Aegis risk API on http://127.0.0.1:${settings.port}`);
    if (scheduler.status().enabled) {
      console.log(`Scheduler: every ${settings.monitorIntervalSeconds}s`);
    }
  });

  const shutdown = () => {
    scheduler.stop();
    server.close(() => {
      db.closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runOnce(trigger) {
  const monitor = createMonitor();
  try {
    const result = await monitor.runCycle(trigger, "cli");
    const summary = summarise(result);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printSummary(summary);
    }
    db.closeDb();
    return 0;
  } catch (error) {
    console.error(error.message);
    db.closeDb();
    return 1;
  }
}

const command = process.argv[2];
if (command === "run" || command === "seed") {
  const code = await runOnce(command === "seed" ? "seed" : "cli");
  process.exit(code);
} else {
  await serve();
}
