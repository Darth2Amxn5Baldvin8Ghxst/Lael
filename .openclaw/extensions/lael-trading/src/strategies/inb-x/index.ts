// ============================================================================
// LAEL INB-x STRATEGY ENGINE — Main Entry Point
// "Blood of my blood. I will never abandon you, Sir."
//
// This is the singleton orchestrator. It owns the bar storage, performs
// cold-start historical loads, and exposes the public API that the plugin
// tools call into.
// ============================================================================

import type { Bar, CanonicalSymbol, FeedComparison, FeedId, Timeframe } from './types';
import { DEFAULT_STORAGE_CONFIG } from './types';
import { BarStorage, getBarStorage } from './bar-storage';
import { fetchMexcKlinesBulk } from './feeds/mexc-klines';

const SINGLETON_KEY = '__lael_inbx_strategy__';

export interface InbXOptions {
  /** If true, fetch MEXC historical bars on init. Default true. */
  loadMexcOnInit?: boolean;
  /** Bars per series to fetch on cold start. Default 500. */
  historicalLimit?: number;
}

/**
 * Top-level INB-x strategy engine. Holds the bar storage and provides
 * read-side helpers for tools and downstream modules.
 */
export class InbXStrategy {
  public readonly storage: BarStorage;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.storage = getBarStorage(DEFAULT_STORAGE_CONFIG);
  }

  /**
   * Cold-start initialization. Idempotent — multiple callers share the
   * same in-flight promise.
   */
  async init(opts: InbXOptions = {}): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit(opts).then(() => {
      this.initialized = true;
    });
    return this.initPromise;
  }

  private async doInit(opts: InbXOptions): Promise<void> {
    const loadMexc = opts.loadMexcOnInit ?? true;
    const limit = opts.historicalLimit ?? 500;

    if (loadMexc) {
      const pairs: Array<{ symbol: CanonicalSymbol; tf: Timeframe; limit: number }> = [];
      for (const symbol of this.storage.config.symbols) {
        for (const tf of this.storage.config.timeframes) {
          pairs.push({ symbol, tf, limit });
        }
      }

      const results = await fetchMexcKlinesBulk(pairs);
      let successCount = 0;
      let failCount = 0;

      for (const r of results) {
        if (r.error) {
          failCount++;
          console.warn(`[InbX] MEXC cold-start failed for ${r.symbol} ${r.tf}: ${r.error}`);
          continue;
        }
        this.storage.loadHistorical('mexc', r.symbol, r.tf, r.bars);
        successCount++;
      }

      console.log(
        `[InbX] MEXC cold-start: ${successCount} series loaded, ${failCount} failed`
      );
    }
  }

  /** Public API: get last N bars from a specific feed. */
  getBars(
    feed: FeedId,
    symbol: CanonicalSymbol,
    tf: Timeframe,
    count = 100,
    includeForming = false
  ): Bar[] {
    return this.storage.getBars(feed, symbol, tf, count, includeForming);
  }

  /** Public API: cross-feed comparison for slippage/discrepancy analysis. */
  compareFeeds(symbol: CanonicalSymbol, tf: Timeframe): FeedComparison {
    return this.storage.compareFeeds(symbol, tf);
  }

  /** Public API: diagnostic snapshot of all series. */
  snapshot() {
    return this.storage.snapshot();
  }

  /** Whether init has completed. */
  isReady(): boolean {
    return this.initialized;
  }
}

/** Singleton accessor — pinned to globalThis. */
export function getInbXStrategy(): InbXStrategy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g[SINGLETON_KEY]) {
    g[SINGLETON_KEY] = new InbXStrategy();
  }
  return g[SINGLETON_KEY] as InbXStrategy;
}

// Re-export the most useful types & functions so consumers only need this entry point
export { applyMexcTick } from './feeds/mexc-aggregator';
export { getBarStorage, BarStorage } from './bar-storage';
export type { Bar, CanonicalSymbol, FeedId, Timeframe, FeedComparison } from './types';
