"use client";

import { statusLabel } from "../lib/format";
import { Play, Shield } from "./Icons";

const NAV = [
  { href: "#risk", label: "Live risk" },
  { href: "#portfolio", label: "Portfolio" },
  { href: "#scenarios", label: "Scenarios" },
  { href: "#alerts", label: "Alerts" },
  { href: "#agent", label: "Agent" },
  { href: "#how", label: "How it works" },
];

export default function Header({ data, onRun, running, active = "risk" }) {
  const status = data?.snapshot?.health?.status;
  const openAlerts = data?.stats?.open_alerts ?? 0;

  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="#top" aria-label="Aegis Risk Monitor — back to top">
          <span className="brand-mark">
            <Shield size={21} />
          </span>
          <span className="brand-text">
            <strong>Aegis</strong>
            <span>Risk Monitor</span>
          </span>
        </a>

        <nav className="site-nav" aria-label="Page sections">
          {NAV.map((item) => {
            const id = item.href.slice(1);
            return (
              <a
                key={item.href}
                href={item.href}
                className={active === id ? "is-active" : ""}
                aria-current={active === id ? "true" : undefined}
              >
                {item.label}
                {item.href === "#alerts" && openAlerts > 0 ? (
                  <span className="nav-badge">{openAlerts}</span>
                ) : null}
              </a>
            );
          })}
        </nav>

        <div className="header-actions">
          <span className={`status-chip status-${status ?? "idle"}`}>
            <span className="status-dot" aria-hidden="true" />
            {data ? statusLabel(status) : "Connecting"}
          </span>
          <button className="btn btn-primary" onClick={onRun} disabled={running} type="button">
            {running ? <span className="spinner" aria-hidden="true" /> : <Play size={15} />}
            {running ? "Analysing…" : "Run analysis"}
          </button>
        </div>
      </div>
    </header>
  );
}
