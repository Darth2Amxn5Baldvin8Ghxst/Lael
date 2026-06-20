/**
 * Lael Trading Plugin - Main Entry Point
 * INB-x TradingPit Analyzer for OpenClaw
 */

import { Type } from '@sinclair/typebox';
import type { IncomingMessage, ServerResponse } from 'http';
import { ExecutionAnalyzer } from './src/execution-analyzer.js';
import { MEXCFeed } from './src/mexc-feed.js';
import { TradingViewFeed } from './src/tradingview-feed.js';
import { TTPMonitor } from './src/ttp-monitor.js';
import { getInbXStrategy } from './src/strategies/inb-x/index.js';
import {
  lael_get_bars_definition,
  lael_get_bars_handler,
  lael_compare_feeds_definition,
  lael_compare_feeds_handler,
  lael_engine_status_definition,
  lael_engine_status_handler,
} from './src/strategies/inb-x/tools.js';
import type {
  MT5TickData,
  MT5OrderEvent,
  MT5AccountState,
  LaelPluginConfig,
  LandingState,
  TradingSignal,
} from './src/types.js';

// Re-export types
export * from './src/types.js';

// ============================================================================
// Plugin State
// ============================================================================

const state: LandingState = {
  isConnected: false,
  mt5Connected: false,
  mexcConnected: false,
  lastMT5Tick: null,
  lastMT5Account: null,
  lastMEXCPrice: null,
  executionRecords: [],
  executionProfiles: {},
  ttpStatus: null,
  activeSignals: [],
};

// True cross-load singletons: register() may be called by multiple loader
// passes (snapshot + activate) and the host may re-evaluate the module
// between passes — module-level `const`s would create parallel instances
// where one pass's HTTP route writes to monitor_A while another pass's
// tool reads monitor_B (this is what made lael_check_ttp_status return
// "No output" while /api/mt5/account was clearly being called).
const LAEL_GLOBAL = globalThis as unknown as {
  __laelMexcFeed?: MEXCFeed | null;
  __laelTtpMonitor?: TTPMonitor;
  __laelExecutionAnalyzer?: ExecutionAnalyzer;
  __laelTvFeed?: TradingViewFeed;
};

function getMexcFeed(): MEXCFeed | null {
  return LAEL_GLOBAL.__laelMexcFeed ?? null;
}
function setMexcFeed(feed: MEXCFeed | null): void {
  LAEL_GLOBAL.__laelMexcFeed = feed;
}

if (!LAEL_GLOBAL.__laelTtpMonitor) {
  LAEL_GLOBAL.__laelTtpMonitor = new TTPMonitor();
}
if (!LAEL_GLOBAL.__laelExecutionAnalyzer) {
  LAEL_GLOBAL.__laelExecutionAnalyzer = new ExecutionAnalyzer();
}
if (!LAEL_GLOBAL.__laelTvFeed) {
  LAEL_GLOBAL.__laelTvFeed = new TradingViewFeed();
}
const ttpMonitor: TTPMonitor = LAEL_GLOBAL.__laelTtpMonitor;
const executionAnalyzer: ExecutionAnalyzer = LAEL_GLOBAL.__laelExecutionAnalyzer;
const tvFeed: TradingViewFeed = LAEL_GLOBAL.__laelTvFeed;

// ============================================================================
// Plugin Definition
// ============================================================================

interface PluginAPI {
  registerTool: (tool: any, options?: { optional?: boolean }) => void;
  registerHttpRoute: (params: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
    auth: 'gateway' | 'plugin';
    match?: 'exact' | 'prefix';
    replaceExisting?: boolean;
  }) => void;
  pluginConfig?: LaelPluginConfig;
}

/**
 * Read a JSON request body off the IncomingMessage. Returns null on parse failure.
 * Cap at 1 MiB so a malformed EA can't OOM the gateway.
 */
async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const cap = 1024 * 1024;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.length === 0 ? ({} as T) : JSON.parse(text));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export default {
  id: 'lael-trading',
  name: 'Lael Trading System',
  description: 'INB-x TradingPit Analyzer - Dual-layer trading intelligence',

  register(api: PluginAPI) {
    const config = (api.pluginConfig ?? {}) as LaelPluginConfig;
    const log = (msg: string) => console.log(`[Lael] ${msg}`);

    log('Initializing Lael Trading System...');

    // Initialize MEXC feed if enabled
    if (config.mexcEnabled) {
      const existing = getMexcFeed();
      if (existing) {
        // Already running from a prior register() pass — reuse it instead
        // of creating a parallel socket that races for the same subscriptions.
        log('MEXC feed already initialized — skipping duplicate init');
      } else {
        const symbols = config.mexcSymbols || ['BTCUSDT'];
        const mode = config.mexcMode ?? 'rest';
        const pollMs = config.mexcPollIntervalMs ?? 5000;
        const feed = new MEXCFeed(symbols, mode, pollMs);
        setMexcFeed(feed);

        feed.onPriceUpdate((data) => {
          state.lastMEXCPrice = data;
          executionAnalyzer.setMEXCPrice(data);
        });

        feed.onConnectionChange((connected) => {
          state.mexcConnected = connected;
          log(`MEXC connection: ${connected ? 'established' : 'lost'}`);
        });

        feed.start().catch((err) => {
          log(`MEXC connection failed: ${err.message}`);
        });
      }
    }

    // Initialize TTP monitor with config rules
    if (config.ttpMonitorEnabled && config.ttpRules) {
      ttpMonitor.updateRules(config.ttpRules);
    }

    // Initialize INB-x strategy engine (cold-loads MEXC historical bars)
    getInbXStrategy()
      .init({ loadMexcOnInit: true, historicalLimit: 500 })
      .catch((err) => console.error('[Lael] InbX init failed:', err));

    // ========================================================================
    // Register Tools
    // ========================================================================

    // Tool: Analyze Execution
    api.registerTool({
      name: 'lael_analyze_execution',
      description: 'Analyze execution quality for a symbol - slippage, delay, and spread patterns',
      parameters: Type.Object({
        symbol: Type.String({ description: 'Trading symbol (e.g., BTCUSD)' }),
        period_hours: Type.Optional(Type.Number({ description: 'Analysis period in hours' })),
      }),
      async execute(_id: string, params: { symbol: string; period_hours?: number }) {
        const periodMs = params.period_hours ? params.period_hours * 60 * 60 * 1000 : undefined;
        const profile = executionAnalyzer.buildExecutionProfile(params.symbol);
        
        // Store profile
        state.executionProfiles[params.symbol] = profile;
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              symbol: params.symbol,
              tradeCount: profile.tradeCount,
              executionRisk: profile.executionRisk,
              slippage: {
                average: profile.slippage.avgSlippage.toFixed(5),
                stdDev: profile.slippage.stdDevSlippage.toFixed(5),
                isFixed: profile.slippage.isFixedSlippage,
                bySession: profile.slippage.slippageBySession,
              },
              delay: {
                average: profile.delay.avgDelay.toFixed(0) + 'ms',
                isFixed: profile.delay.isFixedDelay,
                bySession: profile.delay.delayBySession,
              },
              spread: {
                average: profile.avgSpread.toFixed(5),
                widensAt: profile.spreadWidensAt,
              },
              expectedSlippage: profile.expectedSlippage.toFixed(5),
              expectedDelay: profile.expectedDelay.toFixed(0) + 'ms',
            }, null, 2)
          }]
        };
      },
    });

    // Tool: Get MEXC Price
    api.registerTool({
      name: 'lael_get_mexc_price',
      description: 'Get current MEXC price for a symbol (ground truth)',
      parameters: Type.Object({
        symbol: Type.String({ description: 'MEXC symbol (e.g., BTCUSDT)' }),
      }),
      async execute(_id: string, params: { symbol: string }) {
        const feed = getMexcFeed();
        if (!feed) {
          return {
            content: [{
              type: 'text',
              text: 'MEXC feed not enabled'
            }]
          };
        }

        const price = feed.getPrice(params.symbol);
        
        if (!price) {
          return {
            content: [{
              type: 'text',
              text: `No price data for ${params.symbol}`
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              symbol: price.symbol,
              price: price.price,
              bid: price.bid,
              ask: price.ask,
              spread: price.ask - price.bid,
              volume: price.volume,
              timestamp: new Date(price.timestamp).toISOString(),
            }, null, 2)
          }]
        };
      },
    });

    // Tool: Check TTP Status
    api.registerTool({
      name: 'lael_check_ttp_status',
      description: 'Check TTP account status, drawdown headroom, profit-target progress, and current risk level',
      parameters: Type.Object({}),
      async execute() {
        log('lael_check_ttp_status invoked');
        const fmt = (n: number | undefined | null, d = 2): string =>
          (typeof n === 'number' && Number.isFinite(n) ? n : 0).toFixed(d);

        try {
          const status = ttpMonitor.getStatus();
          const risk = ttpMonitor.getCurrentRiskStatus();
          log(`status: balance=${status.balance} equity=${status.equity} hasState=${state.lastMT5Account !== null}`);

          const payload = {
            _debug: {
              test: true,
              message: 'If you see this, the tool output works',
              hasMT5State: state.lastMT5Account !== null,
              lastMT5At: state.lastMT5Account ? new Date().toISOString() : null,
            },
            accountId: status.accountId,
            phase: status.phase,
            balance: fmt(status.balance),
            equity: fmt(status.equity),
            equityFloor: fmt(status.equityFloor),
            dailyStartEquity: fmt(status.dailyStartEquity),
            drawdown: {
              dailyAmount: fmt(status.dailyDrawdownAmount),
              dailyPct: fmt(status.dailyDrawdownPct) + '%',
              totalAmount: fmt(status.totalDrawdownAmount),
              totalPct: fmt(status.totalDrawdownPct) + '%',
            },
            risk: {
              level: risk.riskLevel,
              reason: risk.reason,
              availableDrawdown: fmt(risk.availableDrawdown),
              dailyDrawdownRemaining: fmt(risk.dailyDrawdownRemaining),
            },
            profitTarget: {
              met: status.profitTargetMet,
              remaining: fmt(status.profitToTarget),
            },
            isCompliant: status.isCompliant,
            profitableDays: `${status.profitableDays}/${status.totalTradingDays}`,
            riskRemainingToday: fmt(status.riskRemainingToday),
            warnings: status.warnings.map(w => w.description),
            violations: status.violations.map(v => v.description),
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`lael_check_ttp_status FAILED: ${message}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'TTP status read failed',
                message,
                hint: 'Check gateway log for stack trace',
              }, null, 2),
            }],
            isError: true,
          };
        }
      },
    });

    // Tool: Check Trade Compliance
    api.registerTool({
      name: 'lael_check_trade_compliance',
      description: 'Check if a proposed trade complies with TTP rules',
      parameters: Type.Object({
        risk_amount: Type.Number({ description: 'Risk amount in account currency' }),
        margin_required: Type.Number({ description: 'Margin required for the trade' }),
      }),
      async execute(_id: string, params: { risk_amount: number; margin_required: number }) {
        const result = ttpMonitor.checkTradeCompliance(params.risk_amount, params.margin_required);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              compliant: result.compliant,
              reason: result.reason || 'Trade complies with TTP rules',
              maxAllowedRisk: ttpMonitor.getMaxAllowedRisk().toFixed(2),
            }, null, 2)
          }]
        };
      },
    });

    // Tool: Get Slippage Statistics
    api.registerTool({
      name: 'lael_get_slippage_stats',
      description: 'Get detailed slippage statistics for a symbol',
      parameters: Type.Object({
        symbol: Type.String({ description: 'Trading symbol' }),
        period_hours: Type.Optional(Type.Number({ description: 'Period in hours' })),
      }),
      async execute(_id: string, params: { symbol: string; period_hours?: number }) {
        const periodMs = params.period_hours ? params.period_hours * 60 * 60 * 1000 : undefined;
        const stats = executionAnalyzer.calculateSlippageStats(params.symbol, periodMs);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(stats, null, 2)
          }]
        };
      },
    });

    // Tool: Get Delay Patterns
    api.registerTool({
      name: 'lael_get_delay_patterns',
      description: 'Get execution delay patterns for a symbol',
      parameters: Type.Object({
        symbol: Type.String({ description: 'Trading symbol' }),
        period_hours: Type.Optional(Type.Number({ description: 'Period in hours' })),
      }),
      async execute(_id: string, params: { symbol: string; period_hours?: number }) {
        const periodMs = params.period_hours ? params.period_hours * 60 * 60 * 1000 : undefined;
        const stats = executionAnalyzer.calculateDelayStats(params.symbol, periodMs);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(stats, null, 2)
          }]
        };
      },
    });

    // Tool: Generate Signal
    api.registerTool({
      name: 'lael_generate_signal',
      description: 'Generate a trading signal with execution risk assessment',
      parameters: Type.Object({
        symbol: Type.String({ description: 'Trading symbol' }),
        direction: Type.Union([Type.Literal('LONG'), Type.Literal('SHORT')]),
        entry: Type.Number({ description: 'Entry price' }),
        stop_loss: Type.Number({ description: 'Stop loss price' }),
        take_profit: Type.Number({ description: 'Take profit price' }),
        confidence: Type.Number({ description: 'Signal confidence 0-100' }),
      }),
      async execute(_id: string, params: {
        symbol: string;
        direction: 'LONG' | 'SHORT';
        entry: number;
        stop_loss: number;
        take_profit: number;
        confidence: number;
      }) {
        // Get execution profile for the symbol
        const profile = state.executionProfiles[params.symbol] 
          || executionAnalyzer.buildExecutionProfile(params.symbol);
        
        // Get TTP status
        const ttpStatus = ttpMonitor.getStatus();
        
        // Calculate risk
        const riskPips = Math.abs(params.entry - params.stop_loss);
        const riskAmount = ttpStatus.balance * 0.01; // Default 1% risk
        
        // Check TTP compliance
        const compliance = ttpMonitor.checkTradeCompliance(riskAmount, riskAmount * 10);
        
        // Adjust confidence based on execution conditions
        const executionConfidence = profile.executionRisk === 'LOW' ? 100 :
          profile.executionRisk === 'MEDIUM' ? 75 : 50;
        
        const overallConfidence = (params.confidence + executionConfidence) / 2;
        
        const signal: TradingSignal = {
          id: `SIG-${Date.now()}`,
          timestamp: Date.now(),
          symbol: params.symbol,
          direction: params.direction,
          
          entry: params.entry,
          stopLoss: params.stop_loss,
          takeProfit1: params.take_profit,
          takeProfit2: params.take_profit + (params.take_profit - params.entry),
          
          confidence: overallConfidence,
          marketConfidence: params.confidence,
          executionConfidence,
          
          executionRisk: profile.executionRisk,
          expectedSlippage: profile.expectedSlippage,
          expectedDelay: profile.expectedDelay,
          recommendedSpreadLimit: profile.avgSpread * 1.5,
          
          smcContext: {
            liquiditySweep: false,
            sweepType: null,
            fvgPresent: false,
            fvgDistance: null,
            structureBreak: false,
            orderBlock: false,
          },
          
          ttpCompliant: compliance.compliant,
          riskPct: (riskAmount / ttpStatus.balance) * 100,
          positionSize: riskAmount / riskPips,
        };
        
        // Store signal
        state.activeSignals.push(signal);
        if (state.activeSignals.length > 10) {
          state.activeSignals = state.activeSignals.slice(-10);
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              signalId: signal.id,
              symbol: signal.symbol,
              direction: signal.direction,
              entry: signal.entry.toFixed(5),
              stopLoss: signal.stopLoss.toFixed(5),
              takeProfit: signal.takeProfit1.toFixed(5),
              confidence: signal.confidence.toFixed(0) + '%',
              executionRisk: signal.executionRisk,
              expectedSlippage: signal.expectedSlippage.toFixed(5),
              ttpCompliant: signal.ttpCompliant,
              riskPct: signal.riskPct.toFixed(2) + '%',
            }, null, 2)
          }]
        };
      },
    });

    // Tool: Get TradingView Data
    api.registerTool({
      name: 'lael_get_tradingview_data',
      description: 'Get latest TradingView chart data including OHLC, indicators (VWAP, RSI, MACD), and liquidity zones. Compares with MEXC price for venue divergence.',
      parameters: Type.Object({
        symbol: Type.Optional(Type.String({ description: 'Trading symbol (e.g., BTCUSD)' })),
        timeframe: Type.Optional(Type.String({ description: 'Chart timeframe in minutes (e.g., 15, 60, 240)' })),
      }),
      async execute(_id: string, params: { symbol?: string; timeframe?: string }) {
        const symbol = params.symbol || 'BTCUSD';
        const timeframe = params.timeframe || '15';
        const data = tvFeed.getLatestData(symbol, timeframe);

        if (!data) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                hasData: false,
                message: `No TradingView data received yet for ${symbol} ${timeframe}m. Ensure the Pine Script alert is configured to POST to /api/tradingview/data.`,
              }, null, 2),
            }],
          };
        }

        // Map TradingView symbol → likely MEXC pair for the comparison
        // (BTCUSD on TV → BTCUSDT on MEXC). Fall back to symbol verbatim.
        const feed = getMexcFeed();
        const mexcSymbol = symbol.endsWith('USD') ? `${symbol}T` : symbol;
        const mexcPrice = feed?.getPrice(mexcSymbol) ?? null;
        const priceComparison = mexcPrice
          ? tvFeed.comparePrices(data.candle.close, mexcPrice.price)
          : null;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              hasData: true,
              symbol: data.symbol,
              timeframe: data.timeframe,
              timestamp: new Date(data.timestamp).toISOString(),
              candle: data.candle,
              indicators: data.indicators,
              liquidityZones: data.liquidityZones,
              trend: data.trend,
              volatility: data.volatility,
              priceComparison: priceComparison && mexcPrice
                ? {
                    tvPrice: data.candle.close,
                    mexcSymbol,
                    mexcPrice: mexcPrice.price,
                    discrepancy: priceComparison.discrepancy.toFixed(2),
                    percentDiff: priceComparison.percentDiff.toFixed(4) + '%',
                    significant: priceComparison.significant,
                  }
                : null,
            }, null, 2),
          }],
        };
      },
    });

    // Tool: Get System Status
    api.registerTool({
      name: 'lael_system_status',
      description: 'Get overall Lael system status',
      parameters: Type.Object({}),
      async execute() {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              mt5Connected: state.mt5Connected,
              mexcConnected: state.mexcConnected,
              lastMT5Tick: state.lastMT5Tick ? {
                symbol: state.lastMT5Tick.symbol,
                bid: state.lastMT5Tick.bid,
                ask: state.lastMT5Tick.ask,
                time: new Date(state.lastMT5Tick.time_msc).toISOString(),
              } : null,
              lastMEXCPrice: state.lastMEXCPrice ? {
                symbol: state.lastMEXCPrice.symbol,
                price: state.lastMEXCPrice.price,
                time: new Date(state.lastMEXCPrice.timestamp).toISOString(),
              } : null,
              executionRecordsCount: state.executionRecords.length,
              activeSignals: state.activeSignals.length,
              ttpCompliant: state.ttpStatus?.isCompliant ?? null,
            }, null, 2)
          }]
        };
      },
    });

    // ========================================================================
    // INB-x strategy engine tools — bar storage, multi-feed comparison, status.
    // Definitions live in src/strategies/inb-x/tools.ts; handlers return
    // JSON strings which we wrap in the host's content-array response shape.
    // ========================================================================

    api.registerTool({
      name: lael_get_bars_definition.name,
      description: lael_get_bars_definition.description,
      parameters: lael_get_bars_definition.input_schema as unknown as ReturnType<typeof Type.Object>,
      async execute(_id: string, params: any) {
        const text = await lael_get_bars_handler(params);
        return { content: [{ type: 'text', text }] };
      },
    });

    api.registerTool({
      name: lael_compare_feeds_definition.name,
      description: lael_compare_feeds_definition.description,
      parameters: lael_compare_feeds_definition.input_schema as unknown as ReturnType<typeof Type.Object>,
      async execute(_id: string, params: any) {
        const text = await lael_compare_feeds_handler(params);
        return { content: [{ type: 'text', text }] };
      },
    });

    api.registerTool({
      name: lael_engine_status_definition.name,
      description: lael_engine_status_definition.description,
      parameters: lael_engine_status_definition.input_schema as unknown as ReturnType<typeof Type.Object>,
      async execute() {
        const text = await lael_engine_status_handler();
        return { content: [{ type: 'text', text }] };
      },
    });

    // ========================================================================
    // HTTP Routes — MT5 EA telemetry & pre-trade compliance
    // ========================================================================

    api.registerHttpRoute({
      path: '/api/mt5/account',
      auth: 'plugin',
      match: 'exact',
      replaceExisting: true,
      async handler(req, res) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return true;
        }
        const body = await readJsonBody<{
          accountId?: number; balance?: number; equity?: number;
          margin?: number; freeMargin?: number; marginLevel?: number;
          profit?: number; timestamp?: number;
        }>(req);
        if (!body) {
          sendJson(res, 400, { error: 'Invalid JSON body' });
          return true;
        }
        console.log(`[Lael] MT5 account update received: balance=${body.balance} equity=${body.equity} accountId=${body.accountId}`);
        const accountState: MT5AccountState = {
          type: 'account',
          account_id: body.accountId ?? 0,
          balance: body.balance ?? 0,
          equity: body.equity ?? 0,
          margin: body.margin ?? 0,
          free_margin: body.freeMargin ?? 0,
          margin_level: body.marginLevel ?? 0,
          profit: body.profit ?? 0,
          daily_pnl: 0,
          daily_drawdown_pct: 0,
          open_positions: 0,
          total_lots: 0,
        } as MT5AccountState;
        handleMT5Account(accountState);
        const status = ttpMonitor.getStatus();
        const risk = ttpMonitor.getCurrentRiskStatus();
        sendJson(res, 200, {
          ok: true,
          ttpCompliant: status.isCompliant,
          riskLevel: risk.riskLevel,
          dailyDrawdownRemaining: risk.dailyDrawdownRemaining,
          availableDrawdown: risk.availableDrawdown,
        });
        return true;
      },
    });

    api.registerHttpRoute({
      path: '/api/mt5/trade',
      auth: 'plugin',
      match: 'exact',
      replaceExisting: true,
      async handler(req, res) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return true;
        }
        const body = await readJsonBody<{
          event?: 'trade_open' | 'trade_close' | 'trade_modify';
          ticket?: number; symbol?: string; type?: 'buy' | 'sell';
          volume?: number; openPrice?: number; sl?: number; tp?: number;
          profit?: number; timestamp?: number;
        }>(req);
        if (!body) {
          sendJson(res, 400, { error: 'Invalid JSON body' });
          return true;
        }
        log(`Trade ${body.event}: #${body.ticket} ${body.type} ${body.volume} ${body.symbol} @ ${body.openPrice}`);
        // Surface as a minimal MT5OrderEvent so the analyzer sees it. Without
        // bid/ask at fill we can't compute slippage — analyzer will store the
        // record but skip the slippage profile until richer data arrives.
        if (body.event === 'trade_open' || body.event === 'trade_close') {
          const order: MT5OrderEvent = {
            type: 'order',
            deal_id: body.ticket ?? 0,
            order_id: body.ticket ?? 0,
            position_id: body.ticket ?? 0,
            symbol: body.symbol ?? '',
            deal_type: (body.type ?? 'buy').toUpperCase() as 'BUY' | 'SELL',
            deal_entry: body.event === 'trade_open' ? 'ENTRY_IN' : 'ENTRY_OUT',
            volume: body.volume ?? 0,
            price: body.openPrice ?? 0,
            bid_at_fill: body.openPrice ?? 0,
            ask_at_fill: body.openPrice ?? 0,
            spread_at_fill: 0,
          } as MT5OrderEvent;
          handleMT5Order(order);
        }
        sendJson(res, 200, { ok: true });
        return true;
      },
    });

    api.registerHttpRoute({
      path: '/api/mt5/check',
      auth: 'plugin',
      match: 'exact',
      replaceExisting: true,
      async handler(req, res) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return true;
        }
        const body = await readJsonBody<{
          symbol?: string; volume?: number; riskAmount?: number; marginRequired?: number;
        }>(req);
        if (!body || typeof body.riskAmount !== 'number') {
          sendJson(res, 400, { error: 'Missing or invalid riskAmount' });
          return true;
        }
        const compliance = ttpMonitor.checkTradeCompliance(body.riskAmount, body.marginRequired ?? 0);
        const risk = ttpMonitor.getCurrentRiskStatus();
        sendJson(res, 200, {
          allowed: compliance.compliant,
          reason: compliance.reason ?? 'Trade complies with TTP rules',
          riskLevel: risk.riskLevel,
          maxAllowedRisk: ttpMonitor.getMaxAllowedRisk(),
        });
        return true;
      },
    });

    api.registerHttpRoute({
      path: '/api/tradingview/data',
      auth: 'plugin',
      match: 'exact',
      replaceExisting: true,
      async handler(req, res) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return true;
        }
        const body = await readJsonBody(req);
        if (!body) {
          sendJson(res, 400, { error: 'Invalid JSON' });
          return true;
        }
        const result = tvFeed.processWebhook(body);
        sendJson(res, result.success ? 200 : 400, result);
        return true;
      },
    });

    log('Lael Trading System initialized');
    log(`MEXC feed: ${config.mexcEnabled ? 'enabled' : 'disabled'}`);
    log(`TTP monitor: ${config.ttpMonitorEnabled ? 'enabled' : 'disabled'}`);
    log('MT5 HTTP routes registered: /api/mt5/account, /api/mt5/trade, /api/mt5/check');
    log('TradingView webhook registered: /api/tradingview/data');
  },
};

// ============================================================================
// HTTP Handlers for MT5 Data Ingestion
// ============================================================================

export function handleMT5Order(data: MT5OrderEvent): void {
  console.log(`[Lael] Received order: ${data.deal_type} ${data.symbol} @ ${data.price}`);
  
  state.mt5Connected = true;
  
  // Process through execution analyzer
  const record = executionAnalyzer.processOrder(data);
  state.executionRecords.push(record);
  
  // Keep only last 1000 records
  if (state.executionRecords.length > 1000) {
    state.executionRecords = state.executionRecords.slice(-1000);
  }
  
  // Rebuild execution profile
  const profile = executionAnalyzer.buildExecutionProfile(data.symbol);
  state.executionProfiles[data.symbol] = profile;
  
  console.log(`[Lael] Execution record: slippage=${record.slippage.toFixed(5)}, delay=${record.delay}ms`);
}

export function handleMT5Tick(data: MT5TickData): void {
  state.mt5Connected = true;
  state.lastMT5Tick = data;
}

export function handleMT5Account(data: MT5AccountState): void {
  state.mt5Connected = true;
  state.lastMT5Account = data;

  // Update TTP monitor
  const status = ttpMonitor.updateAccountState(data);
  state.ttpStatus = status;

  console.log(`[Lael] handleMT5Account stored: balance=${status.balance.toFixed(2)} equity=${status.equity.toFixed(2)} compliant=${status.isCompliant}`);

  // Log warnings/violations
  if (status.warnings.length > 0) {
    console.log(`[Lael] TTP Warning: ${status.warnings[0].description}`);
  }
  if (status.violations.length > 0) {
    console.log(`[Lael] TTP VIOLATION: ${status.violations[0].description}`);
  }
}
