import { clockTime, relativeTime, shortDate, statusLabel } from "../lib/format";
import { Sparkles } from "./Icons";
import SectionHeader from "./SectionHeader";

function AuditTrail({ entries }) {
  if (!entries?.length) return null;
  return (
    <article className="card audit-card" data-reveal>
      <header className="card-head">
        <div>
          <h3>Audit trail</h3>
          <p>Who did what, in order. Stored with the snapshot.</p>
        </div>
      </header>
      <ul className="audit-list">
        {entries.slice(0, 8).map((entry) => (
          <li key={entry.id}>
            <span className="audit-dot" aria-hidden="true" />
            <div>
              <strong>{entry.action.replaceAll("_", " ")}</strong>
              <span>
                {entry.detail} · {entry.actor}
              </span>
            </div>
            <time dateTime={entry.created_at} title={entry.created_at}>
              {relativeTime(entry.created_at)}
            </time>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function AgentPanel({ snapshot, audit, llm }) {
  const explanation = snapshot.explanation ?? {
    headline: "No explanation recorded",
    narrative: "Run a monitoring cycle to generate an explanation.",
    actions: [],
    mode: "rule-based",
  };
  const trace = snapshot.trace ?? [];
  const modeLabel =
    explanation.mode === "llm" ? explanation.model || "Language model" : "Rule-based";

  return (
    <section className="section" id="agent">
      <div className="container">
        <SectionHeader
          eyebrow="Agent workflow"
          title="An explanation you can audit"
          description="Monitor, investigate, explain, recommend, then wait. Every node leaves a timestamped step, so the reasoning can be reviewed rather than trusted."
          aside={
            <span className={`mode-badge mode-${explanation.mode}`}>
              <Sparkles size={14} /> {modeLabel}
            </span>
          }
        />

        <div className="agent-grid">
          <article className="card agent-note" data-reveal>
            <div className="agent-note-head">
              <span className={`pill ${llm?.enabled ? "pill-ok" : "pill-neutral"}`}>
                {llm?.enabled ? "LLM connected" : "Deterministic note"}
              </span>
              <span className="muted">{shortDate(explanation.generated_at || snapshot.as_of)}</span>
            </div>
            <h3 className="agent-headline">{explanation.headline}</h3>
            <p className="agent-narrative">{explanation.narrative}</p>

            <h4>Suggested next steps</h4>
            <ol className="action-list">
              {explanation.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ol>

            <p className="fineprint">
              {explanation.note ??
                (llm?.enabled
                  ? "Narrative written from the same evidence used by the limit checks, with a human review step afterwards."
                  : "No LLM key configured, so this note is generated deterministically from the metrics. Add OPENAI_API_KEY to switch to model-written narration.")}
            </p>
          </article>

          <article className="card trace-card" data-reveal style={{ "--delay": "90ms" }}>
            <header className="card-head">
              <div>
                <h3>Reasoning trace</h3>
                <p>{trace.length} nodes recorded for this cycle.</p>
              </div>
            </header>
            <ol className="trace">
              {trace.map((step, index) => (
                <li key={`${step.node}-${index}`} className={`trace-step trace-${step.status}`}>
                  <span className="trace-marker">{index + 1}</span>
                  <div className="trace-content">
                    <div className="trace-title">
                      <strong>{step.label}</strong>
                      <span className="trace-time">{step.duration_ms} ms</span>
                    </div>
                    <p>{step.detail}</p>
                    <div className="trace-meta">
                      {step.tool ? <span className="trace-tool">{step.tool}</span> : null}
                      <span className={`trace-status trace-status-${step.status}`}>
                        {statusLabel(step.status) === step.status
                          ? step.status.replaceAll("_", " ")
                          : statusLabel(step.status)}
                      </span>
                      <span className="muted">{clockTime(step.at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </div>

        <AuditTrail entries={audit} />
      </div>
    </section>
  );
}
