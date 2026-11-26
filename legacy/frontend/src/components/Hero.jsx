import { pct, shortDate, money } from "../format";
import { Sparkline } from "./Charts";
import { ArrowUpRight, Bell, Sparkles } from "./Icons";

export default function Hero({ data }) {
  const snapshot = data?.snapshot;
  const metrics = snapshot?.metrics;
  const openAlerts = data?.stats?.open_alerts ?? 0;
  const riskSeries = (snapshot?.curves?.risk ?? []).slice(-26).map((point) => point.var_95);

  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div className="hero-copy" data-reveal>
          <span className="eyebrow">
            <Sparkles size={14} />
            Near-real-time · human-in-the-loop
          </span>
          <h1>
            Know the risk
            <br />
            before it reaches the limit.
          </h1>
          <p className="hero-lead">
            Aegis measures portfolio risk, explains what changed in plain English, and queues
            anything unusual for a person to approve. No hidden maths, no automatic trades.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary" href="#risk">
              Explore live risk <ArrowUpRight size={16} />
            </a>
            <a className="btn btn-ghost" href="#how">
              How it works
            </a>
          </div>
          <dl className="hero-facts">
            <div>
              <dt>Positions</dt>
              <dd>{data?.config?.portfolio?.length ?? "—"}</dd>
            </div>
            <div>
              <dt>Data as of</dt>
              <dd>{snapshot ? shortDate(snapshot.as_of) : "—"}</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>Human approval</dd>
            </div>
          </dl>
        </div>

        <div className="hero-visual" data-reveal style={{ "--delay": "120ms" }}>
          <div className="hero-image-wrap">
            <img
              src="/hero-risk.png"
              alt="Illustration of a laptop showing a shaded risk chart, next to a risk alert badge"
              width="1392"
              height="752"
              fetchPriority="high"
            />
          </div>

          <div className="float-card float-var">
            <span className="float-label">1-day VaR · 95%</span>
            <strong>{metrics ? pct(metrics.var_95_1d) : "—"}</strong>
            <span className="float-sub">
              {metrics ? `${money(metrics.var_95_usd)} at risk` : "Loading the last cycle"}
            </span>
            <Sparkline values={riskSeries} />
          </div>

          <div className={`float-card float-alert ${openAlerts > 0 ? "has-alert" : ""}`}>
            <span className="float-icon">
              <Bell size={16} />
            </span>
            <div>
              <strong>
                {openAlerts > 0 ? `${openAlerts} waiting for review` : "No open alerts"}
              </strong>
              <span>Every decision stays with a human.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
