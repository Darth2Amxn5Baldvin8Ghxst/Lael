// ============================================================================
// LAEL INB-x — Symbol Normalization
// Maps per-feed symbol names to/from internal canonical names.
// Centralizing this avoids string-matching bugs scattered across modules.
// ============================================================================

import type { CanonicalSymbol, FeedId } from './types';

/** Per-feed → canonical mapping table. */
const FEED_TO_CANONICAL: Record<FeedId, Record<string, CanonicalSymbol>> = {
  mexc: {
    BTCUSDT: 'BTC/USD',
    ETHUSDT: 'ETH/USD',
    SOLUSDT: 'SOL/USD',
  },
  mt5: {
    BTCUSD: 'BTC/USD',
    ETHUSD: 'ETH/USD',
    SOLUSD: 'SOL/USD',
    // Tickmill sometimes appends suffixes for ECN/raw accounts
    'BTCUSD.r': 'BTC/USD',
    'ETHUSD.r': 'ETH/USD',
    'SOLUSD.r': 'SOL/USD',
  },
  tradingview: {
    BTCUSD: 'BTC/USD',
    ETHUSD: 'ETH/USD',
    SOLUSD: 'SOL/USD',
    BTCUSDT: 'BTC/USD',
    ETHUSDT: 'ETH/USD',
    SOLUSDT: 'SOL/USD',
  },
};

/** Reverse mapping: canonical → per-feed primary name (used for outbound API calls). */
const CANONICAL_TO_FEED: Record<CanonicalSymbol, Record<FeedId, string>> = {
  'BTC/USD': { mexc: 'BTCUSDT', mt5: 'BTCUSD', tradingview: 'BTCUSD' },
  'ETH/USD': { mexc: 'ETHUSDT', mt5: 'ETHUSD', tradingview: 'ETHUSD' },
  'SOL/USD': { mexc: 'SOLUSDT', mt5: 'SOLUSD', tradingview: 'SOLUSD' },
};

/**
 * Convert a feed-native symbol name to its canonical form.
 * Returns null if the symbol is not registered for that feed.
 */
export function toCanonical(feed: FeedId, raw: string): CanonicalSymbol | null {
  const upper = raw.toUpperCase();
  const table = FEED_TO_CANONICAL[feed];
  // Try exact match first, then case-insensitive
  return table[raw] ?? table[upper] ?? null;
}

/**
 * Convert a canonical symbol to its primary name on the given feed.
 * Used when calling external APIs (e.g. MEXC klines endpoint).
 */
export function toFeedNative(feed: FeedId, canonical: CanonicalSymbol): string {
  return CANONICAL_TO_FEED[canonical][feed];
}

/** List all canonical symbols a given feed supports. */
export function supportedSymbols(feed: FeedId): CanonicalSymbol[] {
  const seen = new Set<CanonicalSymbol>();
  for (const c of Object.values(FEED_TO_CANONICAL[feed])) seen.add(c);
  return Array.from(seen);
}

/** Register a new symbol mapping at runtime (for ad-hoc broker quirks). */
export function registerSymbolMapping(
  feed: FeedId,
  rawName: string,
  canonical: CanonicalSymbol
): void {
  FEED_TO_CANONICAL[feed][rawName] = canonical;
}
