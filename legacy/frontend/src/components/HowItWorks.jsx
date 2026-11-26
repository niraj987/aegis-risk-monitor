import { Activity, Database, Gauge, Users } from "./Icons";
import SectionHeader from "./SectionHeader";

const STEPS = [
  {
    icon: <Database size={19} />,
    title: "Load the market data",
    text: "Daily adjusted closes for the paper portfolio. If the live feed is unreachable, a deterministic synthetic feed keeps the demo working offline.",
  },
  {
    icon: <Gauge size={19} />,
    title: "Measure the risk",
    text: "Historical, parametric and Monte Carlo VaR, Expected Shortfall, annualised volatility, drawdown and risk contributions.",
  },
  {
    icon: <Activity size={19} />,
    title: "Investigate what moved",
    text: "Z-scores and an Isolation Forest flag unusual price and volatility behaviour, then the evidence bundle is assembled.",
  },
  {
    icon: <Users size={19} />,
    title: "Explain, then ask a human",
    text: "The narrative comes from an LLM when configured, or a deterministic template otherwise. Alerts wait in a review queue.",
  },
];

const PIPELINE = ["Market data", "Risk engine", "Agent workflow", "Human review", "Audit trail"];

const GLOSSARY = [
  {
    term: "Value at Risk (VaR)",
    definition:
      "The loss exceeded on one day in twenty (95%) or one day in a hundred (99%), estimated from recent history. It is a threshold, not a forecast.",
  },
  {
    term: "Expected Shortfall (ES)",
    definition:
      "The average loss on the bad days beyond VaR. It answers: if the limit breaks, how bad is it likely to get?",
  },
  {
    term: "Drawdown",
    definition:
      "How far the portfolio has fallen from its highest point. It measures pain already taken, not what comes next.",
  },
  {
    term: "Risk contribution",
    definition:
      "A position's share of total portfolio variance. A small holding in a volatile name can carry more risk than its weight suggests.",
  },
];

export default function HowItWorks() {
  return (
    <section className="section how-section" id="how">
      <div className="container">
        <SectionHeader
          eyebrow="How it works"
          title="Four steps, one clear decision"
          description="The design is deliberately boring where it matters: deterministic maths, explicit limits, and a person at the end of every escalation."
        />

        <div className="step-grid">
          {STEPS.map((step, index) => (
            <article
              key={step.title}
              className="card step-card"
              data-reveal
              style={{ "--delay": `${index * 70}ms` }}
            >
              <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="step-icon">{step.icon}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>

        <div className="pipeline-card" data-reveal>
          <span className="pipeline-label">Pipeline</span>
          <div className="pipeline">
            {PIPELINE.map((step, index) => (
              <div className="pipeline-step" key={step}>
                <span className="pipe-node">{step}</span>
                {index < PIPELINE.length - 1 ? (
                  <span className="pipe-arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <p className="pipeline-note">
            Every step is stored in SQLite with its inputs, output and timestamp. The dashboard reads
            that trail directly.
          </p>
        </div>

        <div className="glossary" data-reveal>
          <h3 className="glossary-title">Plain-language glossary</h3>
          <div className="glossary-grid">
            {GLOSSARY.map((item) => (
              <div className="glossary-item" key={item.term}>
                <h4>{item.term}</h4>
                <p>{item.definition}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
