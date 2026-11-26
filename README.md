# Aegis — Portfolio Risk Monitor

Near-real-time portfolio risk monitoring with an explainable, human-in-the-loop workflow.
One Node runtime: an **Express** risk API, a **Next.js** dashboard, and a SQLite audit trail.

 

## What it does

- **Measures risk every cycle** — 1-day and 5-day VaR (95/99), Expected Shortfall, annualised
  volatility, drawdown, per-asset betas and risk contributions from three years of daily returns.
- **Explains what changed** in plain English through a five-node agent workflow, with an optional
  model-written narrative when an API key is present.
- **Queues anomalies for a person** — alerts are deduplicated by rule, severity-ranked, and must be
  acknowledged, escalated or dismissed by a reviewer. Nothing trades or changes a limit on its own.
- **Lets you explore** — editable weights and limits, an interactive market-shock scenario, trend
  windows, alert filters, JSON snapshot export and a persistent audit log.
- **Degrades gracefully** — when Yahoo Finance is unavailable it falls back to a deterministic
  synthetic feed so the pipeline, tests and demo never stall.

## Screenshots

 

## Stack

| Layer     | Choice                                                              |
| --------- | ------------------------------------------------------------------- |
| Dashboard | Next.js 15 App Router, React 19, hand-built SVG charts, CSS motion   |
| API       | Express 5 on Node 24, ES modules                                    |
| Risk math | Plain JavaScript (historical, parametric, Monte Carlo, drawdown)     |
| Storage   | `node:sqlite` (`DatabaseSync`) — no native build step                |
| Runtime   | Node **22.5+** (Node 24 recommended)                                |
| Packaging | Docker + Docker Compose (one image per service)                     |

## Quick start

```bash
git clone https://github.com/niraj987/aegis-risk-monitor.git
cd aegis-risk-monitor

npm run setup     # installs server/ and web/ dependencies
npm run dev       # Express on :4000 and Next.js on :3000
```

Open <http://127.0.0.1:3000>. The API is at <http://127.0.0.1:4000/api/health>.

`npm run dev` starts both processes with prefixed logs and shuts them down together.
The first cycle runs at startup, then every 15 minutes (configurable).

### Useful commands

| Command              | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `npm run dev`        | Both services in watch mode                              |
| `npm run build`      | Production build of the dashboard                        |
| `npm test`           | Risk-engine and API tests (17, `node:test`)              |
| `npm run run:cycle`  | One monitoring cycle in the terminal, then exit          |
| `npm run start:api`  | API only, production mode                                |
| `npm run start:web`  | Dashboard only, after `npm run build`                    |
| `npm run docker:up`  | Build and run both containers                            |

## Configuration

Copy `.env.example` to `.env` in the project root; both services read it.

| Variable                  | Default                  | Purpose                                            |
| ------------------------- | ------------------------ | -------------------------------------------------- |
| `PORT`                    | `4000`                   | Express port                                       |
| `API_URL`                 | `http://127.0.0.1:4000`  | Next.js rewrite target for `/api/*`                |
| `DATA_SOURCE`             | `auto`                   | `auto`, `yahoo` or `synthetic`                     |
| `HISTORY_DAYS`            | `756`                    | Sessions of daily history (120–1500)               |
| `PORTFOLIO_VALUE`         | `1000000`                | Paper NAV in USD                                   |
| `MONITOR_INTERVAL_SECONDS`| `900`                    | Scheduler interval                                 |
| `SCHEDULER_ENABLED`       | `true`                   | `false` for CLI-only use                           |
| `DATA_DIR`                | `server/data`            | SQLite database and price cache                    |
| `ALLOWED_ORIGINS`         | localhost:3000           | CORS allow-list for direct API calls               |
| `OPENAI_API_KEY`          | empty                    | Optional narration; leave empty for deterministic  |
| `OPENAI_BASE_URL`         | `https://api.openai.com/v1` | OpenAI-compatible endpoint                      |
| `OPENAI_MODEL`            | `gpt-4o-mini`            | Narration model                                    |

## API

| Method | Route                     | Purpose                                    |
| ------ | ------------------------- | ------------------------------------------ |
| GET    | `/api/health`             | Liveness plus database status              |
| GET    | `/api/overview`           | Latest snapshot, alerts, audit, config     |
| GET    | `/api/portfolio`          | Holdings and weights                       |
| PUT    | `/api/portfolio`          | Save weights, then re-run                  |
| GET    | `/api/limits`             | Risk limits                                |
| PUT    | `/api/limits`             | Save limits, then re-run                   |
| POST   | `/api/run`                | Run a full cycle now                       |
| GET    | `/api/alerts`             | Review queue                               |
| POST   | `/api/alerts/:id/review`  | Acknowledge / escalate / dismiss           |
| GET    | `/api/audit`              | Audit trail                                |
| GET    | `/api/stress?shock=-10`   | Linear scenario estimate                   |

## How the numbers are produced

1. **Market data** — daily closes for the portfolio universe from the Yahoo chart API, cached for
   six hours. `DATA_SOURCE=synthetic` uses a seeded geometric random walk instead.
2. **Statistics** — log returns, covariance matrix, portfolio variance, per-asset beta.
3. **Risk engine** — historical VaR/ES from the empirical distribution, variance-covariance VaR,
   10,000 correlated Monte Carlo paths, drawdown series and risk contributions.
4. **Agent workflow** — market data → risk metrics → anomalies → limits → explanation, each step
   writing to the audit log. Limits produce deduplicated alerts with evidence.
5. **Human review** — the dashboard shows the queue; reviewer decisions are recorded next to the
   snapshot that triggered them.

This is a monitoring and education tool, not investment advice or an execution system.

## Docker

```bash
docker compose up --build      # dashboard on http://127.0.0.1:3000, API on :4000
docker compose run --rm cycle  # one monitoring run against the same volume
docker compose down
```

- `aegis-risk-api` — Express service, SQLite in the named volume `aegis_risk_data`.
- `aegis-risk-web` — Next.js standalone output; `/api/*` is proxied server-side to `api:4000`.
- Health checks gate startup: the dashboard waits for a healthy API.

## Layout

```
server/            Express API, risk engine, agent workflow, SQLite repo, tests
web/               Next.js App Router dashboard, components, styles
scripts/dev.mjs    Combined dev runner
legacy/            Earlier FastAPI + Vite implementation, kept for reference
document.txt       Original project brief
```

The dashboard is deliberately readable: warm paper palette, serif headlines, one accent colour,
and motion that only clarifies (reveals, chart draw-in, countdown, scenario bars).
