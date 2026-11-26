"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import {
  useActiveSection,
  useCountdown,
  usePolling,
  useReveal,
  useTicker,
  useToast,
} from "../lib/hooks";
import AgentPanel from "./AgentPanel";
import Alerts from "./Alerts";
import Footer from "./Footer";
import Header from "./Header";
import Hero from "./Hero";
import HowItWorks from "./HowItWorks";
import { AlertTriangle, Check, Clock, Download, Refresh } from "./Icons";
import Portfolio from "./Portfolio";
import RiskSection from "./RiskSection";
import ScrollProgress from "./ScrollProgress";
import StressTest from "./StressTest";

const SECTION_IDS = ["risk", "portfolio", "scenarios", "alerts", "agent", "how"];

function StatusStrip({ data, onExport }) {
  const scheduler = data.config.scheduler;
  const countdown = useCountdown(scheduler.next_run);
  const elapsedPercent =
    countdown && scheduler.interval_seconds
      ? Math.min(
          100,
          Math.max(0, 100 - (countdown.remainingMs / (scheduler.interval_seconds * 1000)) * 100),
        )
      : 0;

  return (
    <div className="status-strip">
      <div className="container status-strip-inner">
        <span>
          <Clock size={14} /> Last cycle {relativeTime(data.run?.finished_at ?? data.snapshot.created_at)}
          {data.run?.duration_ms ? ` · ${data.run.duration_ms} ms` : ""}
        </span>
        <span className="dot-sep">·</span>
        <span>
          {data.config.llm.enabled ? "Model-written narration" : "Deterministic narration"}
        </span>
        <span className="dot-sep">·</span>
        {scheduler.enabled ? (
          <span className="countdown" title="Automatic monitoring interval">
            <span
              className="countdown-ring"
              style={{ "--progress": `${elapsedPercent}%` }}
              aria-hidden="true"
            />
            Next check in {countdown?.label ?? "--:--"}
          </span>
        ) : (
          <span>Manual checks only</span>
        )}
        <span className="status-right">
          <span className="data-source">{data.snapshot.data_source}</span>
          <button type="button" className="btn btn-ghost btn-sm status-export" onClick={onExport}>
            <Download size={14} /> Export snapshot
          </button>
        </span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="container skeleton-section" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the latest risk snapshot</span>
      <div className="metric-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="card skeleton-card" key={index}>
            <div className="shimmer w40" />
            <div className="shimmer tall" />
            <div className="shimmer w90" />
          </div>
        ))}
      </div>
      <div className="card skeleton-chart">
        <div className="shimmer w30" />
        <div className="shimmer tall" />
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="container">
      <div className="error-banner" role="alert">
        <AlertTriangle size={18} />
        <div>
          <strong>Could not reach the risk API</strong>
          <p>{message}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          <Refresh size={14} /> Retry
        </button>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div className={`toast ${toast.tone === "error" ? "toast-error" : ""}`} role="status">
      <span className="toast-icon">
        {toast.tone === "error" ? <AlertTriangle size={16} /> : <Check size={16} />}
      </span>
      {toast.message}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const { toast, notify } = useToast();

  useTicker(30000);
  // Re-observe sections once the data (and therefore the sections) exist.
  const active = useActiveSection(data ? SECTION_IDS : []);

  const load = useCallback(async () => {
    try {
      const payload = await api.overview();
      setData(payload);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(load, 60000);
  useReveal(data?.generated_at ?? "loading");

  async function handleRun() {
    if (running) return;
    setRunning(true);
    try {
      const payload = await api.run();
      setData(payload);
      setError("");
      notify("Fresh cycle finished. A new snapshot is in the audit trail.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setRunning(false);
    }
  }

  async function handlePortfolio(holdings) {
    try {
      const payload = await api.updatePortfolio(holdings);
      setData(payload);
      notify("Weights saved and the portfolio re-run completed.");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleLimits(limits) {
    try {
      const payload = await api.updateLimits(limits);
      setData(payload);
      notify("Limits saved and the cycle re-run completed.");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleReview(id, status) {
    try {
      await api.reviewAlert(id, status);
      await load();
      notify(`Alert ${status}. The decision is now in the audit trail.`);
    } catch (err) {
      notify(err.message, "error");
    }
  }

  function handleExport() {
    if (!data) return;
    const payload = {
      exported_at: new Date().toISOString(),
      version: data.config.version,
      snapshot: data.snapshot,
      alerts: data.alerts,
      portfolio: data.config.portfolio,
      limits: data.config.limits,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aegis-risk-${data.snapshot.as_of}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Snapshot exported as JSON for your records.");
  }

  return (
    <div className="app">
      <ScrollProgress />
      <a className="skip-link" href="#risk">
        Skip to live risk
      </a>
      <Header data={data} onRun={handleRun} running={running} active={active || "risk"} />
      <main>
        <Hero data={data} />
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {loading && !data ? (
          <Skeleton />
        ) : data ? (
          <>
            <StatusStrip data={data} onExport={handleExport} />
            <RiskSection snapshot={data.snapshot} limits={data.config.limits} />
            <Portfolio
              data={data}
              onSavePortfolio={handlePortfolio}
              onSaveLimits={handleLimits}
            />
            <StressTest snapshot={data.snapshot} limits={data.config.limits} />
            <Alerts alerts={data.alerts} onReview={handleReview} />
            <AgentPanel snapshot={data.snapshot} audit={data.audit} llm={data.config.llm} />
            <HowItWorks />
          </>
        ) : null}
      </main>
      <Footer data={data} />
      {toast ? <Toast toast={toast} /> : null}
    </div>
  );
}
