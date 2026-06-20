// ============================================================================
// LAEL INB-x — Multi-Feed Bar Storage
// Stores OHLC bars per (feed, symbol, timeframe). Singleton pinned to
// globalThis so it survives OpenClaw's multi-pass plugin loader.
// ============================================================================

import type {
  Bar,
  BarSeries,
  BarStorageConfig,
  CanonicalSymbol,
  FeedComparison,
  FeedId,
  Timeframe,
} from './types';
import { DEFAULT_STORAGE_CONFIG, alignToTimeframe, barCloseTime, TIMEFRAME_MS } from './types';

const SINGLETON_KEY = '__lael_bar_storage__';

/**
 * Multi-feed bar storage.
 *
 * Layout: bars[feed][symbol][timeframe] -> BarSeries
 *
 * Closed bars are appended to series.bars (oldest first, capped at maxBars).
 * The currently forming bar lives in series.current and is rolled into
 * series.bars when the timeframe boundary is crossed.
 */
export class BarStorage {
  private store: Map<FeedId, Map<CanonicalSymbol, Map<Timeframe, BarSeries>>>;
  public readonly config: BarStorageConfig;

  constructor(config: BarStorageConfig = DEFAULT_STORAGE_CONFIG) {
    this.config = config;
    this.store = new Map();
    for (const feed of config.feeds) {
      const symMap = new Map<CanonicalSymbol, Map<Timeframe, BarSeries>>();
      for (const sym of config.symbols) {
        const tfMap = new Map<Timeframe, BarSeries>();
        for (const tf of config.timeframes) {
          tfMap.set(tf, {
            feed,
            symbol: sym,
            timeframe: tf,
            bars: [],
            current: null,
            lastUpdate: 0,
          });
        }
        symMap.set(sym, tfMap);
      }
      this.store.set(feed, symMap);
    }
  }

  /** Get the series object for a (feed, symbol, tf) tuple. Returns null if not configured. */
  getSeries(feed: FeedId, symbol: CanonicalSymbol, tf: Timeframe): BarSeries | null {
    return this.store.get(feed)?.get(symbol)?.get(tf) ?? null;
  }

  /**
   * Get the most recent N closed bars for a series, optionally including
   * the currently forming bar at the end.
   */
  getBars(
    feed: FeedId,
    symbol: CanonicalSymbol,
    tf: Timeframe,
    count: number,
    includeForming = false
  ): Bar[] {
    const series = this.getSeries(feed, symbol, tf);
    if (!series) return [];
    const closed = series.bars.slice(-count);
    if (includeForming && series.current) {
      return [...closed, series.current];
    }
    return closed;
  }

  /**
   * Bulk-load historical bars (e.g. from a klines REST endpoint at startup).
   * Replaces the existing closed-bar buffer entirely. Use only for cold start.
   */
  loadHistorical(
    feed: FeedId,
    symbol: CanonicalSymbol,
    tf: Timeframe,
    bars: Bar[]
  ): void {
    const series = this.getSeries(feed, symbol, tf);
    if (!series) return;
    // Sort ascending and cap at maxBars
    const sorted = [...bars].sort((a, b) => a.openTime - b.openTime);
    series.bars = sorted.slice(-this.config.maxBars);
    series.lastUpdate = Date.now();
  }

  /**
   * Append a single closed bar to the series. Idempotent: if a bar with the
   * same openTime already exists at the tail, it is replaced (e.g. corrected
   * volume from a delayed feed).
   */
  appendClosedBar(bar: Bar): void {
    const series = this.getSeries(bar.feed, bar.symbol, bar.timeframe);
    if (!series) return;
    const tail = series.bars[series.bars.length - 1];
    if (tail && tail.openTime === bar.openTime) {
      // Replace last bar (correction)
      series.bars[series.bars.length - 1] = { ...bar, closed: true };
    } else {
      series.bars.push({ ...bar, closed: true });
    }
    // Cap
    if (series.bars.length > this.config.maxBars) {
      series.bars = series.bars.slice(-this.config.maxBars);
    }
    // Clear current if it matches
    if (series.current && series.current.openTime === bar.openTime) {
      series.current = null;
    }
    series.lastUpdate = Date.now();
  }

  /**
   * Update the currently forming bar with a new tick (price, optional volume).
   * Automatically rolls the bar over when the timeframe boundary is crossed.
   *
   * This is what tick-based feeds (MEXC REST poller) call on every poll.
   */
  applyTick(
    feed: FeedId,
    symbol: CanonicalSymbol,
    tf: Timeframe,
    timestamp: number,
    price: number,
    volume = 0
  ): void {
    const series = this.getSeries(feed, symbol, tf);
    if (!series) return;

    const openTime = alignToTimeframe(timestamp, tf);
    const closeTime = barCloseTime(openTime, tf);

    if (!series.current || series.current.openTime !== openTime) {
      // Roll over: the previous current bar is now closed
      if (series.current) {
        this.appendClosedBar(series.current);
      }
      // Start a new forming bar
      series.current = {
        openTime,
        closeTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
        closed: false,
        feed,
        symbol,
        timeframe: tf,
      };
    } else {
      // Update existing forming bar
      const c = series.current;
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
      c.volume += volume;
    }
    series.lastUpdate = Date.now();
  }

  /**
   * Cross-feed comparison: align the most recent bar across all available
   * feeds for a given symbol/timeframe. Useful for slippage detection.
   */
  compareFeeds(symbol: CanonicalSymbol, tf: Timeframe): FeedComparison {
    const perFeed: Partial<Record<FeedId, Bar | null>> = {};
    let maxSpread = 0;
    let maxTimeDrift = 0;
    const closes: number[] = [];
    const closeTimes: number[] = [];

    for (const feed of this.config.feeds) {
      const series = this.getSeries(feed, symbol, tf);
      const last = series?.bars[series.bars.length - 1] ?? null;
      perFeed[feed] = last;
      if (last) {
        closes.push(last.close);
        closeTimes.push(last.closeTime);
      }
    }

    if (closes.length >= 2) {
      maxSpread = Math.max(...closes) - Math.min(...closes);
      maxTimeDrift = Math.max(...closeTimes) - Math.min(...closeTimes);
    }

    return { symbol, timeframe: tf, perFeed, maxSpread, maxTimeDrift };
  }

  /** Diagnostic snapshot — counts and freshness per series. */
  snapshot(): Array<{
    feed: FeedId;
    symbol: CanonicalSymbol;
    timeframe: Timeframe;
    barCount: number;
    hasCurrent: boolean;
    lastUpdate: number;
    ageMs: number;
  }> {
    const now = Date.now();
    const out: ReturnType<BarStorage['snapshot']> = [];
    for (const [feed, symMap] of this.store) {
      for (const [symbol, tfMap] of symMap) {
        for (const [tf, series] of tfMap) {
          out.push({
            feed,
            symbol,
            timeframe: tf,
            barCount: series.bars.length,
            hasCurrent: series.current !== null,
            lastUpdate: series.lastUpdate,
            ageMs: series.lastUpdate ? now - series.lastUpdate : -1,
          });
        }
      }
    }
    return out;
  }
}

/**
 * Get the singleton instance, pinned to globalThis to survive plugin reloads.
 * Safe to call multiple times — always returns the same instance.
 */
export function getBarStorage(config?: BarStorageConfig): BarStorage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g[SINGLETON_KEY]) {
    g[SINGLETON_KEY] = new BarStorage(config);
  }
  return g[SINGLETON_KEY] as BarStorage;
}
