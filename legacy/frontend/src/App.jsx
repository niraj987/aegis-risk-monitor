import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { duration, relativeTime } from "./format";
import { usePolling, useReveal, useTicker, useToast } from "./hooks";
import AgentPanel from "./components/AgentPanel";
import Alerts from "./components/Alerts";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import { AlertTriangle, Check, Clock, Refresh } from "./components/Icons";
import Portfolio from "./components/Portfolio";
import RiskSection from "./components/RiskSection";

function StatusBar({ data }) {
  const snapshot = data.snapshot;
  const run = data.run;
  return (
    <div className="status-strip">
      <div className="container status-strip-inner">
        <span>
          <Clock size={14} /> Last cycle {relativeTime(run?.finished_at ?? snapshot.created_at)}
          {run?.duration_ms ? ` · ${run.duration_ms} ms` : ""}
        </span>
        <span className="dot-sep">·</span>
        <span>
          {data.config.llm.enabled ? "Model-written narration" : "Deterministic narration"}
        </span>
        <span className="dot-sep">·</span>
        <span>
          {data.config.scheduler.enabled
            ? `Auto-check every ${duration(data.config.scheduler.interval_seconds)}`
            : "Manual checks only"}
        </span>
        <span className="status-right">{snapshot.data_source}</span>
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
          <strong>Could not reach the risk service</strong>
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

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const { toast, notify } = useToast();

  useTicker(30000);

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

  return (
    <div className="app">
      <a className="skip-link" href="#risk">
        Skip to live risk
      </a>
      <Header data={data} onRun={handleRun} running={running} />
      <main>
        <Hero data={data} />
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {loading && !data ? (
          <Skeleton />
        ) : data ? (
          <>
            <StatusBar data={data} />
            <RiskSection snapshot={data.snapshot} limits={data.config.limits} />
            <Portfolio
              data={data}
              onSavePortfolio={handlePortfolio}
              onSaveLimits={handleLimits}
            />
            <Alerts alerts={data.alerts} onReview={handleReview} />
            <AgentPanel
              snapshot={data.snapshot}
              audit={data.audit}
              llm={data.config.llm}
            />
            <HowItWorks />
          </>
        ) : null}
      </main>
      <Footer data={data} />
      {toast ? <Toast toast={toast} /> : null}
    </div>
  );
}
