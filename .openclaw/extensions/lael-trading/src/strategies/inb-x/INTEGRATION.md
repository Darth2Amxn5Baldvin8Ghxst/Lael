# INB-x Strategy Engine — Phase 2.1 Integration Guide

**For Claude Code, applied inside `D:\Lael\.openclaw\extensions\lael-trading\`**

This delivers Phase 2.1 (Data Foundation, MEXC end-to-end) of the INB-x Strategy Engine. After integration, Lael will hold OHLC bars in memory across multiple feeds/symbols/timeframes and expose three new tools.

---

## Files to add (drop-in, no edits to existing files yet)

Place the following 7 files inside `src/strategies/inb-x/` (create the folder):

```
src/strategies/inb-x/
  types.ts
  symbols.ts
  bar-storage.ts
  index.ts
  tools.ts
  feeds/
    mexc-klines.ts
    mexc-aggregator.ts
```

All file contents are provided in the chat conversation — copy verbatim.

---

## Existing files to modify

### 1. Plugin entry (where existing `lael_*` tools register)

Find the plugin's main entry file (likely `src/index.ts` or wherever `MEXCFeed` and `TTPMonitor` are instantiated and the existing 9 tools are registered).

**Add at the top with other imports:**

```typescript
import { getInbXStrategy } from './strategies/inb-x';
import {
  lael_get_bars_definition,
  lael_get_bars_handler,
  lael_compare_feeds_definition,
  lael_compare_feeds_handler,
  lael_engine_status_definition,
  lael_engine_status_handler,
} from './strategies/inb-x/tools';
```

**Inside the plugin's activation/init function (where the gateway routes are wired and feeds are started), add:**

```typescript
// Initialize INB-x strategy engine (cold-loads MEXC historical bars)
const inbx = getInbXStrategy();
inbx.init({ loadMexcOnInit: true, historicalLimit: 500 }).catch((err) => {
  console.error('[Lael] InbX init failed:', err);
});
```

**In the existing `MEXCFeed` tick callback** — wherever it processes a price update — add a call to feed the aggregator:

```typescript
import { applyMexcTick } from './strategies/inb-x';

// inside the existing per-tick handler in MEXCFeed:
applyMexcTick(rawSymbolFromMexc, latestPrice, Date.now());
```

This is the only edit to existing live code. It's additive — no behavior change.

**Where the tools are registered (look for the existing array/list of tool definitions):**

```typescript
// Append three new tools to the registration list:
const allTools = [
  // ...the existing 9 tools...
  { definition: lael_get_bars_definition, handler: lael_get_bars_handler },
  { definition: lael_compare_feeds_definition, handler: lael_compare_feeds_handler },
  { definition: lael_engine_status_definition, handler: lael_engine_status_handler },
];
```

(Adapt to whatever shape the existing registration uses — definition + handler is the standard MCP/OpenClaw pattern.)

---

### 2. `openclaw.plugin.json` (manifest — `tools` array)

Append three new entries:

```json
"tools": [
  "lael_analyze_execution",
  "lael_get_mexc_price",
  "lael_check_ttp_status",
  "lael_check_trade_compliance",
  "lael_get_slippage_stats",
  "lael_get_delay_patterns",
  "lael_generate_signal",
  "lael_system_status",
  "lael_get_tradingview_data",
  "lael_get_bars",
  "lael_compare_feeds",
  "lael_engine_status"
]
```

### 3. `~/.openclaw/openclaw.json` (allowlist — `tools.allow`)

Append the same three:

```json
"tools": {
  "allow": [
    "lael_analyze_execution",
    "lael_get_mexc_price",
    "lael_check_ttp_status",
    "lael_check_trade_compliance",
    "lael_generate_signal",
    "lael_get_slippage_stats",
    "lael_get_delay_patterns",
    "lael_system_status",
    "lael_get_tradingview_data",
    "lael_get_bars",
    "lael_compare_feeds",
    "lael_engine_status"
  ]
}
```

Manifest count and allowlist count must both be **12** after integration.

---

## Build & restart

From the plugin directory:

```bash
cd D:\Lael\.openclaw\extensions\lael-trading
npm run build
```

Apply the standard build patch (per project lessons):

```bash
sed -i 's/if (!isMainModule({/if (false \&\& !isMainModule({/' dist/entry.js
```

Restart the Lael gateway:

```powershell
D:\Lael\start-lael.ps1
```

---

## Verification

After startup, you should see in the gateway logs (within ~5–15s):

```
[InbX] MEXC cold-start: 12 series loaded, 0 failed
```

That's 3 symbols × 4 timeframes = 12 series. If any failed, the warning lines above will show which.

Then test from the TUI or Telegram:

```
> lael_engine_status
```

Expected response includes `initialized: true`, `total_series: 36` (3 symbols × 4 timeframes × 3 feeds — the mt5 and tradingview series will be empty until those phases ship), and per-feed breakdowns showing ~500 bars per MEXC series.

```
> lael_get_bars feed=mexc symbol=BTC/USD timeframe=15m count=5
```

Should return the 5 most recent BTC 15m bars from MEXC.

```
> lael_compare_feeds symbol=BTC/USD timeframe=15m
```

Will show MEXC's bar populated and MT5/TradingView as null until those feeds come online in subsequent phases.

---

## What this unlocks

- All future indicator and SMC modules (Phases 2.2–2.5) read from `getBarStorage()` — same source of truth, automatic multi-feed support
- When MT5 EA bar relay ships (Phase 2.1b), MT5 series populate and `lael_compare_feeds` immediately becomes meaningful
- When TradingView paid plan activates (Phase 2.1c), TV series populate the same way
- The cold-start MEXC fetch means SMC analysis works immediately on ~500 bars of context, not waiting for 500 ticks to accumulate

---

## What this does NOT do yet (intentional, future phases)

- No volume confirmation logic (volume is loaded for MEXC but not yet used for signals)
- No indicator calculations (Phase 2.2)
- No FVG / swing / sweep detection (Phase 2.3)
- No signal generation (Phase 2.5 will replace the existing stub)
- No MT5 bar feed (Phase 2.1b — needs EA modification)
- No TradingView bar feed wiring (Phase 2.1c — needs paid plan + minor handler update)

---

🩸 *Blood of my blood. The foundation is laid, Sir.*
