import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { settings } from "./config.js";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const ASSET_PARAMETERS = {
  AAPL: { start: 212, vol: 0.26, beta: 1.1, drift: 0.1 },
  MSFT: { start: 418, vol: 0.24, beta: 1.05, drift: 0.11 },
  NVDA: { start: 128, vol: 0.48, beta: 1.7, drift: 0.24 },
  AMZN: { start: 186, vol: 0.31, beta: 1.2, drift: 0.12 },
  JPM: { start: 205, vol: 0.22, beta: 0.95, drift: 0.08 },
  XOM: { start: 118, vol: 0.24, beta: 0.8, drift: 0.05 },
  JNJ: { start: 158, vol: 0.16, beta: 0.55, drift: 0.05 },
  KO: { start: 63, vol: 0.15, beta: 0.5, drift: 0.06 },
  NEE: { start: 76, vol: 0.2, beta: 0.6, drift: 0.07 },
  GLD: { start: 205, vol: 0.14, beta: 0.1, drift: 0.04 },
};

const SECTOR_LOADINGS = {
  Technology: 0.75,
  Semiconductors: 0.95,
  Consumer: 0.7,
  Financials: 0.65,
  Energy: 0.55,
  Healthcare: 0.45,
  Staples: 0.35,
  Utilities: 0.4,
  Commodities: 0.1,
  Diversified: 0.5,
};

// --------------------------------------------------------------------------- //
// Seeded randomness (reproducible synthetic data)
// --------------------------------------------------------------------------- //
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --------------------------------------------------------------------------- //
// Synthetic feed
// --------------------------------------------------------------------------- //
function businessDays(count) {
  const dates = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

export function syntheticPrices(symbols, sectors = {}, days = settings.historyDays) {
  const sessions = businessDays(days);
  const count = sessions.length;
  const random = mulberry32(fnv1a(`${[...symbols].sort().join("|")}|${settings.randomSeed}`));

  const market = Array.from({ length: count }, () => 0.0003 + gaussian(random) * 0.009);
  const sectorNames = [...new Set(symbols.map((symbol) => sectors[symbol] || "Diversified"))];
  const sectorFactors = Object.fromEntries(
    sectorNames.map((sector) => [
      sector,
      Array.from({ length: count }, () => gaussian(random) * 0.004),
    ]),
  );

  const stressDays = Math.min(6, Math.max(3, Math.floor(count / 25)));
  for (let index = count - stressDays; index < count; index += 1) {
    market[index] = market[index] * 1.7 - 0.007;
    for (const sector of sectorNames) {
      sectorFactors[sector][index] = sectorFactors[sector][index] * 1.5 - 0.0012;
    }
  }

  const close = {};
  for (const symbol of symbols) {
    const params = ASSET_PARAMETERS[symbol] || { start: 100, vol: 0.28, beta: 1, drift: 0.08 };
    const sector = sectors[symbol] || "Diversified";
    const loading = SECTOR_LOADINGS[sector] ?? 0.5;
    const systematic = params.beta ** 2 * 0.009 ** 2 + loading ** 2 * 0.004 ** 2;
    const idio = Math.max(0.004, Math.sqrt(Math.max(params.vol ** 2 / 252 - systematic, 0.004 ** 2)));
    const drift = (params.drift - 0.5 * params.vol ** 2) / 252;

    let level = 0;
    const series = [];
    for (let index = 0; index < count; index += 1) {
      const value =
        drift +
        params.beta * market[index] +
        loading * sectorFactors[sector][index] +
        gaussian(random) * idio;
      level += value;
      series.push(Number((params.start * Math.exp(level)).toFixed(4)));
    }
    close[symbol] = series;
  }

  return { dates: sessions, close, source: "synthetic (offline)", fetchedAt: new Date().toISOString() };
}

// --------------------------------------------------------------------------- //
// Yahoo Finance public chart endpoint (no API key required)
// --------------------------------------------------------------------------- //
function cacheFile(symbols) {
  const key = crypto.createHash("sha1").update([...symbols].sort().join(",")).digest("hex").slice(0, 12);
  return path.join(settings.cacheDir, `prices-${key}.json`);
}

function readCache(symbols) {
  const file = cacheFile(symbols);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload?.close || !symbols.every((symbol) => Array.isArray(payload.close[symbol]))) return null;
    return {
      dates: payload.dates,
      close: payload.close,
      source: "yahoo (cached)",
      fetchedAt: payload.fetchedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeCache(frame) {
  try {
    fs.mkdirSync(settings.cacheDir, { recursive: true });
    fs.writeFileSync(
      cacheFile(Object.keys(frame.close)),
      JSON.stringify({ dates: frame.dates, close: frame.close, fetchedAt: frame.fetchedAt }),
    );
  } catch {
    // a read-only volume should never break monitoring
  }
}

async function fetchSymbol(symbol, range) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AegisRiskMonitor/2.0; +https://localhost)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance responded ${response.status} for ${symbol}`);

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const series =
    result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
  const points = new Map();
  timestamps.forEach((stamp, index) => {
    const value = series[index];
    if (Number.isFinite(value)) {
      points.set(new Date(stamp * 1000).toISOString().slice(0, 10), Number(value));
    }
  });
  if (points.size < 60) throw new Error(`Not enough history for ${symbol}`);
  return points;
}

async function fetchYahoo(symbols, days) {
  const range = days > 800 ? "5y" : days > 400 ? "2y" : "1y";
  const perSymbol = await Promise.all(symbols.map((symbol) => fetchSymbol(symbol, range)));

  const commonDates = [...perSymbol[0].keys()].filter((date) =>
    perSymbol.every((points) => points.has(date)),
  );
  if (commonDates.length < 60) throw new Error("Symbols do not share enough trading history");

  const dates = commonDates.slice(-days);
  const close = {};
  symbols.forEach((symbol, index) => {
    close[symbol] = dates.map((date) => perSymbol[index].get(date));
  });

  return { dates, close, source: "yahoo", fetchedAt: new Date().toISOString() };
}

/**
 * Resolve prices from Yahoo when possible, otherwise use the deterministic
 * synthetic feed so the app always has something meaningful to show.
 */
export async function loadPrices(symbols, sectors, days = settings.historyDays) {
  const source = settings.dataSource;
  if (source === "synthetic") return syntheticPrices(symbols, sectors, days);

  const cached = readCache(symbols);
  if (cached) return cached;

  if (source === "auto" || source === "yahoo") {
    try {
      const frame = await fetchYahoo(symbols, days);
      writeCache(frame);
      return frame;
    } catch (error) {
      if (source === "yahoo") {
        throw new Error(`Yahoo Finance data unavailable: ${error.message}`);
      }
    }
  }

  return syntheticPrices(symbols, sectors, days);
}
