// ============================================================================
// LAEL INB-x — Tool Registration
// Defines the new tools that the plugin exposes to the agent.
// This file is meant to be imported and called from your existing
// plugin entry (where the other lael_* tools are registered).
// ============================================================================

import { getInbXStrategy } from './index';
import type { CanonicalSymbol, FeedId, Timeframe } from './types';

const VALID_FEEDS: FeedId[] = ['mexc', 'mt5', 'tradingview'];
const VALID_SYMBOLS: CanonicalSymbol[] = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
const VALID_TFS: Timeframe[] = ['1m', '5m', '15m', '1h', '4h'];

// ----------------------------------------------------------------------------
// lael_get_bars
// ----------------------------------------------------------------------------

export const lael_get_bars_definition = {
  name: 'lael_get_bars',
  description:
    'Get the most recent OHLC bars for a (feed, symbol, timeframe) tuple. ' +
    'Use this to inspect price action stored in the INB-x engine. Feeds: ' +
    'mexc (ground truth crypto), mt5 (Tickmill broker), tradingview (when active).',
  input_schema: {
    type: 'object' as const,
    properties: {
      feed: {
        type: 'string' as const,
        enum: VALID_FEEDS,
        description: 'Data source feed.',
      },
      symbol: {
        type: 'string' as const,
        enum: VALID_SYMBOLS,
        description: 'Canonical symbol.',
      },
      timeframe: {
        type: 'string' as const,
        enum: VALID_TFS,
        description: 'Bar timeframe.',
      },
      count: {
        type: 'number' as const,
        description: 'Number of recent closed bars to return (1–500). Default 50.',
        default: 50,
      },
      include_forming: {
        type: 'boolean' as const,
        description: 'Include the currently forming (unclosed) bar at the end. Default false.',
        default: false,
      },
    },
    required: ['feed', 'symbol', 'timeframe'],
  },
};

export async function lael_get_bars_handler(args: {
  feed: FeedId;
  symbol: CanonicalSymbol;
  timeframe: Timeframe;
  count?: number;
  include_forming?: boolean;
}): Promise<string> {
  const strategy = getInbXStrategy();
  const count = Math.max(1, Math.min(args.count ?? 50, 500));
  const bars = strategy.getBars(
    args.feed,
    args.symbol,
    args.timeframe,
    count,
    args.include_forming ?? false
  );

  if (bars.length === 0) {
    return JSON.stringify({
      feed: args.feed,
      symbol: args.symbol,
      timeframe: args.timeframe,
      count: 0,
      bars: [],
      note: 'No bars stored for this series yet. Engine may still be initializing or feed inactive.',
    });
  }

  return JSON.stringify({
    feed: args.feed,
    symbol: args.symbol,
    timeframe: args.timeframe,
    count: bars.length,
    first_open: new Date(bars[0].openTime).toISOString(),
    last_close: new Date(bars[bars.length - 1].closeTime).toISOString(),
    bars: bars.map((b) => ({
      t: b.openTime,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
      closed: b.closed,
    })),
  });
}

// ----------------------------------------------------------------------------
// lael_compare_feeds
// ----------------------------------------------------------------------------

export const lael_compare_feeds_definition = {
  name: 'lael_compare_feeds',
  description:
    'Compare the most recent bar across all available feeds for a symbol/timeframe. ' +
    'Surfaces price spread and time drift between feeds — useful for detecting ' +
    'broker manipulation, feed lag, or data quality issues.',
  input_schema: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string' as const,
        enum: VALID_SYMBOLS,
        description: 'Canonical symbol.',
      },
      timeframe: {
        type: 'string' as const,
        enum: VALID_TFS,
        description: 'Bar timeframe.',
      },
    },
    required: ['symbol', 'timeframe'],
  },
};

export async function lael_compare_feeds_handler(args: {
  symbol: CanonicalSymbol;
  timeframe: Timeframe;
}): Promise<string> {
  const strategy = getInbXStrategy();
  const cmp = strategy.compareFeeds(args.symbol, args.timeframe);

  return JSON.stringify({
    symbol: cmp.symbol,
    timeframe: cmp.timeframe,
    max_price_spread: cmp.maxSpread,
    max_time_drift_ms: cmp.maxTimeDrift,
    per_feed: Object.fromEntries(
      Object.entries(cmp.perFeed).map(([feed, bar]) => [
        feed,
        bar
          ? {
              o: bar.open,
              h: bar.high,
              l: bar.low,
              c: bar.close,
              v: bar.volume,
              close_time: new Date(bar.closeTime).toISOString(),
            }
          : null,
      ])
    ),
  });
}

// ----------------------------------------------------------------------------
// lael_engine_status
// ----------------------------------------------------------------------------

export const lael_engine_status_definition = {
  name: 'lael_engine_status',
  description:
    'Diagnostic snapshot of the INB-x engine. Shows bar counts, freshness, ' +
    'and active series across all feeds. Use this to verify the engine is healthy.',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function lael_engine_status_handler(): Promise<string> {
  const strategy = getInbXStrategy();
  const snapshot = strategy.snapshot();
  const ready = strategy.isReady();

  // Group by feed for readability
  const byFeed: Record<string, unknown[]> = {};
  for (const s of snapshot) {
    if (!byFeed[s.feed]) byFeed[s.feed] = [];
    byFeed[s.feed].push({
      symbol: s.symbol,
      timeframe: s.timeframe,
      bars: s.barCount,
      forming: s.hasCurrent,
      last_update_age_ms: s.ageMs,
    });
  }

  return JSON.stringify({
    initialized: ready,
    total_series: snapshot.length,
    by_feed: byFeed,
  });
}
