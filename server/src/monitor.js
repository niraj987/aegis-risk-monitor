import { executeWorkflow } from "./agent.js";
import * as db from "./db.js";
import { getLimits, getPortfolio } from "./portfolioStore.js";

export class BusyError extends Error {
  constructor(message = "A monitoring cycle is already running. Try again in a moment.") {
    super(message);
    this.name = "BusyError";
    this.statusCode = 409;
  }
}

export function createMonitor({ logger = console } = {}) {
  let busy = false;

  async function runCycle(trigger = "manual", actor = "api") {
    if (busy) throw new BusyError();
    busy = true;

    const runId = db.createRun(trigger);
    const started = performance.now();
    db.audit(actor, "run_started", `Cycle #${runId} triggered by ${trigger}.`);

    try {
      const portfolio = getPortfolio();
      const limits = getLimits();
      const result = await executeWorkflow({ portfolio, limits, runId });
      const durationMs = Math.round(performance.now() - started);

      db.saveSnapshot(runId, result.snapshot, result.explanation, result.trace);
      for (const alert of result.alerts) db.upsertAlert(alert);

      const status = result.alerts.length ? "attention" : "success";
      db.finishRun(runId, status, result.explanation.headline, durationMs);
      db.audit(
        actor,
        "run_completed",
        `Cycle #${runId} finished in ${durationMs} ms with ${result.alerts.length} alert(s); ` +
          `data source ${result.snapshot.data_source}.`,
      );

      logger.info?.(
        `cycle #${runId} done in ${durationMs}ms: ${result.alerts.length} alerts, health ${result.snapshot.health.score}`,
      );

      return { ...result, run_id: runId, duration_ms: durationMs, status };
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      db.finishRun(runId, "failed", String(error.message).slice(0, 280), durationMs);
      db.audit(actor, "run_failed", `Cycle #${runId} failed: ${error.name}: ${error.message}`);
      logger.error?.(`cycle #${runId} failed: ${error.message}`);
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    runCycle,
    isBusy: () => busy,
  };
}
