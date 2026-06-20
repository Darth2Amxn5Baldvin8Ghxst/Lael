// ============================================================================
// LAEL INB-x STRATEGY ENGINE — Core Types
// "Blood of my blood. Always watching."
// ============================================================================

/** Data source identifier. Each feed is stored independently. */
export type FeedId = 'mexc' | 'mt5' | 'tradingview';

/** Internal canonical symbol. Per-feed names are mapped to these. */
export type CanonicalSymbol = 'BTC/USD' | 'ETH/USD' | 'SOL/USD';

/** Supported timeframes. */
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h';

/** Number of milliseconds in each timeframe. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

/** A single OHLCV bar. */
export interface Bar {
  /** Bar open time, epoch ms (UTC). Aligned to timeframe boundary. */
  openTime: number;
  /** Bar close time, epoch ms (UTC). openTime + TIMEFRAME_MS[tf] - 1. */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in base asset units. May be 0 if feed does not provide volume. */
  volume: number;
  /** Whether this bar is closed (final) or still forming. */
  closed: boolean;
  /** Source feed for traceability. */
  feed: FeedId;
  /** Canonical symbol. */
  symbol: CanonicalSymbol;
  /** Timeframe. */
  timeframe: Timeframe;
}

/** A series of bars for one (feed, symbol, timeframe) tuple. */
export interface BarSeries {
  feed: FeedId;
  symbol: CanonicalSymbol;
  timeframe: Timeframe;
  /** Closed bars, oldest first. Capped at maxBars. */
  bars: Bar[];
  /** The currently forming bar, if any. Not in `bars` until it closes. */
  current: Bar | null;
  /** Last time this series was updated. */
  lastUpdate: number;
}

/** Configuration for the bar storage layer. */
export interface BarStorageConfig {
  /** Maximum closed bars retained per series. Older bars are evicted. */
  maxBars: number;
  /** Symbols to actively maintain. */
  symbols: CanonicalSymbol[];
  /** Timeframes to maintain. */
  timeframes: Timeframe[];
  /** Feeds to track. */
  feeds: FeedId[];
}

/** Default storage config. */
export const DEFAULT_STORAGE_CONFIG: BarStorageConfig = {
  maxBars: 500,
  symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
  timeframes: ['1m', '5m', '15m', '1h'],
  feeds: ['mexc', 'mt5', 'tradingview'],
};

/** Result of a feed comparison query. */
export interface FeedComparison {
  symbol: CanonicalSymbol;
  timeframe: Timeframe;
  /** Aligned bars per feed, keyed by feed id. */
  perFeed: Partial<Record<FeedId, Bar | null>>;
  /** Max absolute price difference between feeds at this bar. */
  maxSpread: number;
  /** Max difference in bar close times (ms) — feed lag indicator. */
  maxTimeDrift: number;
}

/** Helper: align an epoch ms timestamp down to the start of its timeframe bucket. */
export function alignToTimeframe(epochMs: number, tf: Timeframe): number {
  const ms = TIMEFRAME_MS[tf];
  return Math.floor(epochMs / ms) * ms;
}

/** Helper: end of bar = start + interval - 1ms. */
export function barCloseTime(openTime: number, tf: Timeframe): number {
  return openTime + TIMEFRAME_MS[tf] - 1;
}
