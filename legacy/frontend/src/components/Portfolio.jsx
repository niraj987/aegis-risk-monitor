import { useEffect, useState } from "react";
import { money, pct, sectorColor, signedPct } from "../format";
import { AllocationDonut } from "./Charts";
import { Sliders } from "./Icons";
import SectionHeader from "./SectionHeader";

const LIMIT_FIELDS = [
  { key: "var_95_limit_pct", label: "1-day VaR budget", hint: "% of NAV", step: 0.1, min: 0.05 },
  { key: "ann_vol_limit_pct", label: "Annual volatility budget", hint: "% a year", step: 0.5, min: 1 },
  { key: "max_drawdown_limit_pct", label: "Max drawdown", hint: "% from peak", step: 0.5, min: 0.5 },
  { key: "daily_move_limit_pct", label: "Single-day loss", hint: "% of NAV", step: 0.1, min: 0.1 },
  { key: "concentration_limit_pct", label: "Largest position", hint: "% of NAV", step: 1, min: 1 },
];

export default function Portfolio({ data, onSavePortfolio, onSaveLimits }) {
  const { portfolio, limits, portfolio_value: portfolioValue } = data.config;
  const assets = data.snapshot.assets;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => portfolio.map((item) => ({ ...item })));
  const [draftLimits, setDraftLimits] = useState({ ...limits });
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    setDraft(portfolio.map((item) => ({ ...item })));
  }, [portfolio]);

  useEffect(() => {
    setDraftLimits({ ...limits });
  }, [limits]);

  const total = draft.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const totalOff = Math.abs(total - 1) > 0.002;

  function setWeight(index, weight) {
    setDraft((current) =>
      current.map((item, position) => (position === index ? { ...item, weight } : item)),
    );
  }

  async function saveWeights() {
    if (total <= 0) return;
    const scale = 1 / total;
    const holdings = draft.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
      weight: Math.round(Number(item.weight) * scale * 10000) / 10000,
    }));
    setSaving("weights");
    try {
      await onSavePortfolio(holdings);
    } finally {
      setSaving(null);
    }
  }

  async function saveLimits() {
    const payload = {};
    for (const field of LIMIT_FIELDS) {
      payload[field.key] = Number(draftLimits[field.key]);
    }
    setSaving("limits");
    try {
      await onSaveLimits(payload);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="section" id="portfolio">
      <div className="container">
        <SectionHeader
          eyebrow="Portfolio"
          title="Simple, diversified, fully visible"
          description="Ten positions across sectors, valued at one million dollars of paper capital. Risk share shows where the portfolio's variance actually comes from."
          aside={<span className="pill pill-neutral">{portfolio.length} positions</span>}
        />

        <div className="portfolio-grid">
          <article className="card table-card" data-reveal>
            <header className="card-head">
              <div>
                <h3>Holdings</h3>
                <p>Adjusted daily closes from {data.snapshot.data_source}.</p>
              </div>
            </header>
            <div className="table-scroll">
              <table className="holdings">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="num">Weight</th>
                    <th className="num">Price</th>
                    <th className="num">Latest</th>
                    <th className="num">Ann. vol</th>
                    <th className="num">Risk</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.map((item) => {
                    const asset = assets.find((row) => row.symbol === item.symbol);
                    const negative = (asset?.last_return ?? 0) < 0;
                    return (
                      <tr key={item.symbol}>
                        <td>
                          <div className="asset-cell">
                            <span
                              className="asset-dot"
                              style={{ background: sectorColor(item.sector) }}
                              aria-hidden="true"
                            />
                            <div>
                              <strong>{item.symbol}</strong>
                              <span>
                                {item.name} · {item.sector}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="num">{pct(item.weight, 1)}</td>
                        <td className="num">{asset ? money(asset.price, 2) : "—"}</td>
                        <td className={`num ${negative ? "neg" : "pos"}`}>
                          {asset ? signedPct(asset.last_return) : "—"}
                        </td>
                        <td className="num">{asset ? pct(asset.ann_vol, 1) : "—"}</td>
                        <td className="num">{asset ? pct(asset.risk_share, 0) : "—"}</td>
                        <td>
                          {asset?.flag ? (
                            <span className="pill pill-warn" title={asset.note}>
                              Unusual
                            </span>
                          ) : (
                            <span className="pill pill-ok">Normal</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="card-foot">
              <span className="muted">
                Valued at {money(portfolioValue)}. A dash means the position had no shared price
                history.
              </span>
            </footer>
          </article>

          <article className="card allocation-card" data-reveal style={{ "--delay": "90ms" }}>
            <header className="card-head">
              <div>
                <h3>Allocation</h3>
                <p>By sector, after normalising to 100%.</p>
              </div>
            </header>
            <AllocationDonut sectors={data.snapshot.portfolio.sectors} />
          </article>
        </div>

        <div className="controls" data-reveal>
          <div className="controls-head">
            <div>
              <h3>
                <Sliders size={18} /> Rebalance & set limits
              </h3>
              <p>
                Weights are rescaled to 100%, then a fresh cycle runs. Every change lands in the
                audit trail — nothing is applied silently.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide controls" : "Adjust portfolio"}
            </button>
          </div>

          <div className={`editor-wrap ${open ? "is-open" : ""}`}>
            <div>
              <div className="editor-grid">
                <div className="editor-col">
                  <h4>Portfolio weights</h4>
                  {draft.map((item, index) => (
                    <label className="weight-row" key={item.symbol}>
                      <span className="weight-symbol">{item.symbol}</span>
                      <input
                        type="range"
                        min="0"
                        max="40"
                        step="0.5"
                        value={Math.round(Number(item.weight) * 1000) / 10}
                        onChange={(event) => setWeight(index, Number(event.target.value) / 100)}
                        aria-label={`${item.symbol} weight percent`}
                      />
                      <span className="weight-value">{pct(item.weight, 1)}</span>
                    </label>
                  ))}
                  <div className={`weight-total ${totalOff ? "is-off" : ""}`}>
                    Total {pct(total, 1)}
                    {totalOff ? " · will be rescaled to 100%" : " · fully invested"}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveWeights}
                    disabled={saving !== null || total <= 0}
                  >
                    {saving === "weights" ? "Running…" : "Save weights & re-run"}
                  </button>
                </div>

                <div className="editor-col">
                  <h4>Risk limits</h4>
                  {LIMIT_FIELDS.map((field) => (
                    <label className="limit-row" key={field.key}>
                      <span>
                        {field.label}
                        <em>{field.hint}</em>
                      </span>
                      <span className="limit-input">
                        <input
                          type="number"
                          min={field.min}
                          step={field.step}
                          value={draftLimits[field.key] ?? ""}
                          onChange={(event) =>
                            setDraftLimits((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          aria-label={`${field.label} in percent`}
                        />
                        <span>%</span>
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveLimits}
                    disabled={saving !== null}
                  >
                    {saving === "limits" ? "Running…" : "Save limits & re-run"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
