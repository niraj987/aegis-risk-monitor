import { useId, useMemo, useRef, useState } from "react";
import { pct, sectorColor } from "../lib/format";

const WIDTH = 760;

/** Responsive area chart with a hovered value, limit line and draw animation. */
export function AreaChart({
  data,
  valueKey,
  format = (value) => pct(value),
  limit,
  color = "#0f6f5c",
  height = 250,
  label = "Risk trend",
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const points = useMemo(
    () => (data ?? []).filter((row) => Number.isFinite(Number(row[valueKey]))),
    [data, valueKey],
  );

  if (points.length < 2) {
    return <div className="chart-empty">Waiting for enough history — run another cycle.</div>;
  }

  const padding = { top: 18, right: 18, bottom: 26, left: 56 };
  const values = points.map((row) => Number(row[valueKey]));
  const scaleValues = limit ? [...values, limit] : values;
  const rawMin = Math.min(...scaleValues);
  const rawMax = Math.max(...scaleValues);
  const span = rawMax - rawMin || Math.abs(rawMax) || 0.01;
  const yMin = Math.max(0, rawMin - span * 0.18);
  const yMax = rawMax + span * 0.18;

  const plotWidth = WIDTH - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const x = (index) => padding.left + (index / (points.length - 1)) * plotWidth;
  const y = (value) =>
    padding.top + (1 - (Number(value) - yMin) / (yMax - yMin || 1)) * plotHeight;

  const linePath = points
    .map((row, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(row[valueKey]).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(height - padding.bottom).toFixed(
    1,
  )} L${padding.left},${(height - padding.bottom).toFixed(1)} Z`;

  const ticks = Array.from({ length: 4 }, (_, index) => yMin + ((yMax - yMin) * index) / 3);
  const dateLabels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  const hovered = hover !== null ? points[hover] : null;

  function handleMove(event) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div
      className="chart"
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`${label}. Latest ${format(values[values.length - 1])}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={WIDTH - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-grid-line"
            />
            <text x={padding.left - 10} y={y(tick) + 4} textAnchor="end" className="chart-label">
              {format(tick)}
            </text>
          </g>
        ))}

        {limit ? (
          <g>
            <line
              x1={padding.left}
              x2={WIDTH - padding.right}
              y1={y(limit)}
              y2={y(limit)}
              className="chart-limit"
            />
            <text
              x={WIDTH - padding.right}
              y={y(limit) - 7}
              textAnchor="end"
              className="chart-limit-label"
            >
              limit {format(limit)}
            </text>
          </g>
        ) : null}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          key={`${valueKey}-${points.length}-${points[points.length - 1]?.date}`}
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          className="chart-line"
        />

        {hovered ? (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padding.top}
              y2={height - padding.bottom}
              className="chart-guide"
            />
            <circle cx={x(hover)} cy={y(hovered[valueKey])} r="5.5" fill={color} className="chart-dot" />
          </g>
        ) : null}

        {dateLabels.map((row, index) => (
          <text
            key={`${row?.date}-${index}`}
            x={index === 0 ? padding.left : index === 1 ? WIDTH / 2 : WIDTH - padding.right}
            y={height - 6}
            textAnchor={index === 0 ? "start" : index === 1 ? "middle" : "end"}
            className="chart-label chart-label-date"
          >
            {row?.date}
          </text>
        ))}
      </svg>

      {hovered ? (
        <div
          className="chart-tooltip"
          style={{
            left: `${(x(hover) / WIDTH) * 100}%`,
            top: `${(y(hovered[valueKey]) / height) * 100}%`,
          }}
        >
          <span>{hovered.date}</span>
          <strong>{format(hovered[valueKey])}</strong>
        </div>
      ) : null}
    </div>
  );
}

/** Small inline trend line used inside cards. */
export function Sparkline({ values, color = "#0f6f5c", width = 108, height = 34 }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 3 - ((value - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Horizontal risk-contribution bars. */
export function RiskBars({ assets, limit = 6 }) {
  const top = (assets ?? []).slice(0, limit);
  if (!top.length) return <p className="muted">No positions to show yet.</p>;
  const max = Math.max(...top.map((asset) => Math.abs(asset.risk_share)), 0.0001);

  return (
    <ul className="risk-bars">
      {top.map((asset, index) => (
        <li key={asset.symbol}>
          <div className="bar-head">
            <span className="bar-label">
              <strong>{asset.symbol}</strong>
              <em>{pct(asset.weight, 0)} weight</em>
            </span>
            <span className="bar-value">{pct(asset.risk_share, 0)}</span>
          </div>
          <div className="bar-track">
            <span
              className="bar-fill"
              style={{
                "--target": `${(Math.max(0, asset.risk_share) / max) * 100}%`,
                "--delay": `${index * 70}ms`,
                background: sectorColor(asset.sector),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Allocation donut built from sector weights. */
export function AllocationDonut({ sectors }) {
  const items = Object.entries(sectors ?? {})
    .map(([label, value]) => ({ label, value, color: sectorColor(label) }))
    .sort((a, b) => b.value - a.value);

  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut-block">
      <div className="donut-figure">
        <svg viewBox="0 0 160 160" role="img" aria-label="Allocation by sector">
          <circle cx="80" cy="80" r={radius} className="donut-track" />
          {items.map((item) => {
            const length = (item.value / total) * circumference;
            const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`;
            const element = (
              <circle
                key={item.label}
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth="17"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                transform="rotate(-90 80 80)"
                className="donut-seg"
              />
            );
            offset += length;
            return element;
          })}
        </svg>
        <div className="donut-center">
          <strong>{items.length}</strong>
          <span>sectors</span>
        </div>
      </div>
      <ul className="donut-legend">
        {items.map((item) => (
          <li key={item.label}>
            <span className="legend-swatch" style={{ background: item.color }} />
            <span>{item.label}</span>
            <strong>{pct(item.value, 0)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
