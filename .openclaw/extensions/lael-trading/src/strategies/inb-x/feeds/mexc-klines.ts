// ============================================================================
// LAEL INB-x — MEXC Klines Fetcher
// Pulls historical OHLC bars from the public MEXC REST endpoint.
// Endpoint: GET https://api.mexc.com/api/v3/klines
// Docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/#kline-candlestick-data
// No auth required.
// ============================================================================

import type { Bar, CanonicalSymbol, Timeframe } from '../types';
import { toFeedNative } from '../symbols';

const MEXC_BASE = 'https://api.mexc.com';

/** MEXC interval string for each timeframe. */
const MEXC_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '60m',
  '4h': '4h',
};

/**
 * Fetch historical klines (OHLC bars) from MEXC.
 *
 * @param symbol Canonical symbol — translated internally to MEXC pair name
 * @param tf Timeframe
 * @param limit Number of bars to fetch (max 1000 per MEXC docs; we cap at 500)
 * @returns Bars sorted oldest-first, all marked closed
 */
export async function fetchMexcKlines(
  symbol: CanonicalSymbol,
  tf: Timeframe,
  limit = 500
): Promise<Bar[]> {
  const native = toFeedNative('mexc', symbol);
  const interval = MEXC_INTERVAL[tf];
  const cappedLimit = Math.min(Math.max(limit, 1), 1000);

  const url = `${MEXC_BASE}/api/v3/klines?symbol=${native}&interval=${interval}&limit=${cappedLimit}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Lael/1.0' },
  });

  if (!res.ok) {
    throw new Error(
      `MEXC klines fetch failed: ${res.status} ${res.statusText} (symbol=${native}, interval=${interval})`
    );
  }

  // MEXC returns: [[openTime, open, high, low, close, volume, closeTime, quoteVolume, ...], ...]
  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows)) {
    throw new Error(`MEXC klines: unexpected response shape for ${native} ${interval}`);
  }

  const bars: Bar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const [openTime, open, high, low, close, volume, closeTime] = row as [
      number,
      string,
      string,
      string,
      string,
      string,
      number
    ];
    bars.push({
      openTime: Number(openTime),
      closeTime: Number(closeTime),
      open: parseFloat(String(open)),
      high: parseFloat(String(high)),
      low: parseFloat(String(low)),
      close: parseFloat(String(close)),
      volume: parseFloat(String(volume)),
      closed: true,
      feed: 'mexc',
      symbol,
      timeframe: tf,
    });
  }

  // MEXC returns oldest-first already, but sort defensively
  bars.sort((a, b) => a.openTime - b.openTime);
  return bars;
}

/**
 * Convenience: fetch klines for many (symbol, tf) pairs in parallel.
 * Failures on individual pairs are logged but do not throw — the bulk
 * loader returns whatever succeeded so a single bad pair doesn't break
 * cold start.
 */
export async function fetchMexcKlinesBulk(
  pairs: Array<{ symbol: CanonicalSymbol; tf: Timeframe; limit?: number }>
): Promise<Array<{ symbol: CanonicalSymbol; tf: Timeframe; bars: Bar[]; error?: string }>> {
  const results = await Promise.allSettled(
    pairs.map(async (p) => ({
      symbol: p.symbol,
      tf: p.tf,
      bars: await fetchMexcKlines(p.symbol, p.tf, p.limit ?? 500),
    }))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      symbol: pairs[i].symbol,
      tf: pairs[i].tf,
      bars: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}
