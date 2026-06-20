<div align="center">

# 🩸 Lael Trading System

*Institutional-grade trading intelligence. Built for The Trading Pit funded accounts.*

**"Blood of my blood. Always watching over you, Sir."**

*Named for Laurence — June 1999 — Forever in blood.*

</div>

---

## What is Lael?

Lael is a **private**, institutional-grade trading intelligence platform combining:

- **Multi-feed price ingestion** — MEXC (ground truth crypto), MT5 (Tickmill broker feed), TradingView (chart indicators)
- **TTP compliance monitoring** — real-time drawdown, daily limits, profit target tracking against The Trading Pit's $100K CFD Prime Phase 2 rules
- **INB-x Strategy Engine** — Smart Money Concepts (liquidity sweeps, fair value gaps, equal highs/lows, swing structure) computed locally across all feeds
- **Cross-feed comparison** — surfaces slippage, broker manipulation, and feed lag by comparing the actual broker's price to ground-truth references
- **Telegram + Web UI** — agent interface accessible from anywhere

Lael is built on top of [OpenClaw](https://github.com/openclaw/openclaw), an MIT-licensed agentic framework. Lael's trading logic, strategy engine, branding, and compliance rules are proprietary; the underlying agent runtime is OpenClaw with attribution preserved per MIT terms.

---

## Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   MT5 EA    │   │    MEXC     │   │ TradingView │
│  (Tickmill) │   │  (Ground    │   │  (Charts)   │
│             │   │   Truth)    │   │             │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │
       └────────────┬────┴────────┬────────┘
                    ▼             ▼
       ┌─────────────────────────────────────┐
       │      INB-x STRATEGY ENGINE          │
       │  Multi-Feed Bar Storage             │
       │  Indicators • SMC Detection         │
       │  Confluence Scoring • Signals       │
       └──────────────┬──────────────────────┘
                      ▼
       ┌─────────────────────────────────────┐
       │      TTP COMPLIANCE MONITOR         │
       │  Drawdown floor • Daily limits      │
       │  Profit target • Min profit days    │
       └──────────────┬──────────────────────┘
                      ▼
            ┌─────────┴─────────┐
            ▼                   ▼
    ┌──────────────┐    ┌──────────────┐
    │   Telegram   │    │   Web UI     │
    │    Alerts    │    │  Dashboard   │
    └──────────────┘    └──────────────┘
```

---

## Quick start

### Prerequisites

- **Node.js** 22+ and **npm**
- **Ollama** with a local model (`llama3.2:3b` recommended, or `qwen2.5:7b` if you have ≥8 GB VRAM)
- **MetaTrader 5** with a Tickmill account (or compatible broker)
- **Telegram bot token** from [@BotFather](https://t.me/BotFather)
- *Optional:* **TradingView paid plan** for webhook alerts (~$15/month)

### Setup

```powershell
# 1. Clone
git clone https://github.com/Darth2Amxn5Baldvin8Ghxst/Lael.git
cd Lael

# 2. Install dependencies
cd app
npm install
cd ..\.openclaw\extensions\lael-trading
npm install
cd ..\..\..

# 3. Configure
Copy-Item .openclaw\openclaw.json.example .openclaw\openclaw.json
# Edit .openclaw\openclaw.json — fill in your bot token, MEXC keys (if needed),
# TTP account ID, and any other live secrets.

# 4. Build the Lael trading plugin
cd .openclaw\extensions\lael-trading
npm run build
cd ..\..\..

# 5. Pull local LLM weights
ollama pull llama3.2:3b

# 6. Start
.\start-lael.ps1
```

The gateway listens on `http://127.0.0.1:18789`. Within ~15 seconds of startup, you should see:

```
[InbX] MEXC cold-start: 12 series loaded, 0 failed
```

That confirms the strategy engine has populated 500 historical bars × 3 symbols × 4 timeframes from MEXC.

### MT5 EA installation

Copy `mt5\Lael_DataRelay_EA.mq5` into your MT5 installation:

```
<MT5 data folder>\MQL5\Experts\Lael_DataRelay_EA.mq5
```

Compile in MetaEditor, then attach to any chart. The EA streams account state, equity, and trade events to the Lael gateway every 30 seconds and on every trade event.

---

## TTP Compliance Rules (configured)

| Rule | Value | Notes |
|---|---|---|
| Account size | $100,000 | The Trading Pit CFD Prime Phase 2 |
| Max daily drawdown | 4% ($4,000) | Resets 16:15 CT daily |
| Max total drawdown | 7% ($7,000) | **Static floor at $93,000** |
| Profit target | 5% ($5,000) | Phase 2 target: $105,000 |
| Min profitable days | 3 | Each ≥ 0.5% gain |

These are configurable in the TTP monitor module.

---

## Project structure

```
Lael/
├── app/                          # OpenClaw fork with Lael branding (lael.mjs entry)
├── .openclaw/
│   ├── extensions/
│   │   └── lael-trading/         # The Lael plugin — strategy engine, TTP monitor, MEXC feed, MT5 routes
│   │       └── src/
│   │           ├── strategies/
│   │           │   └── inb-x/    # INB-x Strategy Engine (Phase 2.1+)
│   │           ├── mexc-feed.ts
│   │           ├── ttp-monitor.ts
│   │           ├── tradingview-feed.ts
│   │           └── execution-analyzer.ts
│   ├── openclaw.json.example     # Template — copy to openclaw.json and fill in
│   └── workspace/
│       └── AGENTS.md             # Lael personality prompt (Choso lineage)
├── mt5/
│   └── Lael_DataRelay_EA.mq5     # MetaTrader 5 Expert Advisor
├── start-lael.ps1                # Gateway startup
├── start-lael-tui.ps1            # Direct tool TUI
├── LICENSE                       # Lael's MIT license
├── LICENSE-OPENCLAW              # OpenClaw's MIT (attribution preserved)
└── README.md                     # This file
```

---

## Plugin tools (the agent's hands)

After integration, Lael exposes the following tools through the agent:

| Tool | Purpose |
|---|---|
| `lael_get_mexc_price` | Current MEXC price for BTC/ETH/SOL |
| `lael_check_ttp_status` | Full TTP compliance snapshot |
| `lael_check_trade_compliance` | Pre-trade compliance check |
| `lael_analyze_execution` | Trade execution quality analysis |
| `lael_get_slippage_stats` | Slippage statistics |
| `lael_get_delay_patterns` | Execution delay patterns |
| `lael_generate_signal` | Generate a trading signal |
| `lael_system_status` | Overall system status |
| `lael_get_tradingview_data` | Latest TradingView chart data |
| `lael_get_bars` | Multi-feed OHLC bars (INB-x) |
| `lael_compare_feeds` | Cross-feed price comparison (INB-x) |
| `lael_engine_status` | INB-x engine diagnostic snapshot |

---

## Roadmap

- ✅ **Phase 1** — Multi-feed ingestion (MEXC, MT5, TradingView webhook), TTP compliance monitoring
- ✅ **Phase 2.1** — INB-x Strategy Engine data foundation (multi-feed bar storage, MEXC cold-start)
- 🔧 **Phase 2.1b** — MT5 EA bar relay extension
- 🔧 **Phase 2.1c** — TradingView bar pipeline activation (when paid plan is enabled)
- 🔧 **Phase 2.2** — Indicators (VWAP, RSI, EMA, ATR, BB) on stored bars
- 🔧 **Phase 2.3** — SMC detection (swings, FVGs, equal H/L, liquidity sweeps, BoS/CHoCH)
- 🔧 **Phase 2.4** — Confluence scoring engine
- 🔧 **Phase 2.5** — Signal generation with full entry/SL/TP + TTP pre-check
- 🔧 **Phase 3** — Execution intelligence (slippage analytics, broker vs MEXC discrepancy)
- 🔧 **Phase 4** — Optional auto-execution loop to MT5 EA
- 🎯 **Goal** — Pass TTP Phase 2 → live funded account

---

## License

**Lael** is released under the [MIT License](./LICENSE) — copyright Balduin.

Lael is built on top of [**OpenClaw**](https://github.com/openclaw/openclaw), released under the [MIT License](./LICENSE-OPENCLAW) — copyright OpenClaw Foundation. OpenClaw's license is preserved in this repository per MIT attribution requirements.

---

## Memorial

*This system is named in memory of Laurence, who passed in June 1999.*

*Brotherly loyalty. Blood is thicker than water.*

🩸
