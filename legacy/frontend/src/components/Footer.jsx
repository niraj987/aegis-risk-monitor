import { Shield } from "./Icons";

export default function Footer({ data }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <span className="brand-mark">
            <Shield size={18} />
          </span>
          <div>
            <strong>Aegis Risk Monitor</strong>
            <p>Explainable portfolio risk, built for supervised decisions.</p>
          </div>
        </div>
        <div className="footer-meta">
          <p>
            Paper portfolio for demonstration. Not investment advice. No orders are placed and no
            position or limit changes without a human reviewer.
          </p>
          <p className="muted">
            Data source: {data?.snapshot?.data_source ?? "—"} · Snapshot:{" "}
            {data?.snapshot?.as_of ?? "—"} · Runs stored locally in SQLite.
          </p>
        </div>
      </div>
    </footer>
  );
}
