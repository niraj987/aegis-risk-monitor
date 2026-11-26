import { useState } from "react";
import { relativeTime, shortDate } from "../format";
import { AlertTriangle, Check, ChevronDown } from "./Icons";
import SectionHeader from "./SectionHeader";

const SEVERITY = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function EmptyState() {
  return (
    <div className="card empty-state" data-reveal>
      <span className="empty-icon">
        <Check size={22} />
      </span>
      <h3>Nothing to review</h3>
      <p>
        The last cycle stayed inside every risk limit. The next check will add a fresh snapshot and
        reasoning trace to the audit log.
      </p>
    </div>
  );
}

export default function Alerts({ alerts, onReview }) {
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const openCount = alerts.filter((alert) => alert.status === "open").length;

  async function review(id, status) {
    setBusyId(id);
    try {
      await onReview(id, status);
      setOpenId(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="section" id="alerts">
      <div className="container">
        <SectionHeader
          eyebrow="Review queue"
          title="Alerts that wait for a person"
          description="The agent measures and explains. It never trades, hedges or changes a limit on its own."
          aside={<span className="queue-count">{openCount} open</span>}
        />

        {alerts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="alert-list">
            {alerts.map((alert, index) => {
              const open = openId === alert.id;
              const evidence = alert.evidence ?? {};
              return (
                <article
                  key={alert.id}
                  className={`alert severity-${alert.severity} ${open ? "is-open" : ""}`}
                  data-reveal
                  style={{ "--delay": `${Math.min(index, 5) * 50}ms` }}
                >
                  <button
                    type="button"
                    className="alert-head"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : alert.id)}
                  >
                    <span className="severity-icon">
                      <AlertTriangle size={17} />
                    </span>
                    <span className="alert-main">
                      <span className="alert-title">{alert.title}</span>
                      <span className="alert-meta">
                        {relativeTime(alert.created_at)} ·{" "}
                        {alert.code.replaceAll("_", " ").toLowerCase()}
                      </span>
                    </span>
                    <span className={`pill pill-${alert.severity}`}>
                      {SEVERITY[alert.severity] ?? alert.severity}
                    </span>
                    <span className={`pill ${alert.status === "open" ? "pill-open" : "pill-done"}`}>
                      {alert.status}
                    </span>
                    <ChevronDown className={`chevron ${open ? "is-up" : ""}`} />
                  </button>

                  {open ? (
                    <div className="alert-body">
                      <p className="alert-message">{alert.message}</p>

                      <div className="evidence">
                        <div>
                          <span>Observed</span>
                          <strong>
                            {evidence.observed_label ??
                              `${Number(evidence.observed_pct ?? 0).toFixed(2)}%`}
                          </strong>
                        </div>
                        <div>
                          <span>Limit</span>
                          <strong>
                            {evidence.limit_label ??
                              `${Number(evidence.limit_pct ?? 0).toFixed(2)}%`}
                          </strong>
                        </div>
                        <div>
                          <span>Health score</span>
                          <strong>{evidence.health_score ?? "—"}/100</strong>
                        </div>
                        <div>
                          <span>As of</span>
                          <strong>{shortDate(evidence.as_of)}</strong>
                        </div>
                      </div>

                      <h4>Suggested next steps</h4>
                      <ol className="action-list">
                        {alert.actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ol>

                      <p className="fineprint">
                        Measured with {evidence.data_source ?? "the latest feed"}. No order is placed
                        automatically; a reviewer must acknowledge or escalate.
                      </p>

                      {alert.status === "open" ? (
                        <div className="alert-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busyId === alert.id}
                            onClick={() => review(alert.id, "acknowledged")}
                          >
                            {busyId === alert.id ? "Saving…" : "Acknowledge"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === alert.id}
                            onClick={() => review(alert.id, "escalated")}
                          >
                            Escalate
                          </button>
                          <button
                            type="button"
                            className="btn btn-text btn-sm"
                            disabled={busyId === alert.id}
                            onClick={() => review(alert.id, "dismissed")}
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <p className="reviewed">
                          Reviewed {relativeTime(alert.reviewed_at)} by {alert.reviewed_by}. This
                          decision is in the audit trail.
                        </p>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
