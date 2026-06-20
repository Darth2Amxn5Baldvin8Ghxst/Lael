// ============================================================================
// LAEL INB-x — MEXC Tick Aggregator
// Bridges the existing MEXC REST price poller into the multi-feed bar
// storage. Every tick (one per ~5s per symbol) is applied to all configured
// timeframes; the storage layer handles bar rollover automatically.
// ============================================================================

import type { CanonicalSymbol, Timeframe } from '../types';
import { toCanonical } from '../symbols';
import { getBarStorage } from '../bar-storage';

/**
 * Apply a single MEXC price tick across all configured timeframes for that symbol.
 *
 * Call this from the existing MEXCFeed singleton inside its tick callback.
 *
 * @param rawSymbol The MEXC-native symbol name (e.g. "BTCUSDT")
 * @param price Latest trade price
 * @param timestamp Tick timestamp (epoch ms); defaults to Date.now()
 */
export function applyMexcTick(
  rawSymbol: string,
  price: number,
  timestamp: number = Date.now()
): void {
  const canonical = toCanonical('mexc', rawSymbol);
  if (!canonical) return; // Unmapped symbol — silently ignore

  const storage = getBarStorage();
  for (const tf of storage.config.timeframes) {
    storage.applyTick('mexc', canonical, tf, timestamp, price, 0);
    // Note: REST poll gives us no per-tick volume, so we pass 0.
    // Volume comes from the historical klines load and is not updated tick-by-tick.
  }
}
