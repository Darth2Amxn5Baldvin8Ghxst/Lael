/**
 * Lael Trading System - Type Definitions
 */

// ============================================================================
// MT5 Data Types
// ============================================================================

export interface MT5TickData {
  type: 'tick';
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  time: number;
  time_msc: number;
  spread: number;
  local_time_ms: number;
}

export interface MT5OrderEvent {
  type: 'order';
  deal_id: number;
  order_id: number;
  position_id: number;
  symbol: string;
  deal_type: 'BUY' | 'SELL' | 'BALANCE' | 'CREDIT' | string;
  deal_entry: 'ENTRY_IN' | 'ENTRY_OUT' | 'ENTRY_INOUT' | 'ENTRY_OUT_BY' | string;
  volume: number;
  price: number;
  bid_at_fill: number;
  ask_at_fill: number;
  spread_at_fill: number;
  profit: number;
  commission: number;
  swap: number;
  magic: number;
  comment: string;
  deal_time: number;
  deal_time_msc: number;
  local_time_ms: number;
  request_price: number;
  slippage: number;
}

export interface MT5AccountState {
  type: 'account';
  account_id: number;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  profit: number;
  daily_pnl: number;
  daily_drawdown_pct: number;
  open_positions: number;
  total_lots: number;
  leverage: number;
  currency: string;
  server: string;
  local_time_ms: number;
}

// ============================================================================
// MEXC Data Types
// ============================================================================

export interface MEXCTickerData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

export interface MEXCOrderBook {
  symbol: string;
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][];
  timestamp: number;
}

// ============================================================================
// Execution Analysis Types
// ============================================================================

export interface ExecutionRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  
  // Prices
  requestPrice: number;
  fillPrice: number;
  mexcPriceAtFill: number | null;
  
  // Calculated metrics
  slippage: number;           // fillPrice - requestPrice
  trueSlippage: number | null; // fillPrice - mexcPriceAtFill
  delay: number;              // fill_time - order_time (ms)
  spreadAtFill: number;
  
  // Costs
  commission: number;
  swap: number;
  totalCost: number;
  
  // Context
  volume: number;
  session: 'ASIA' | 'LONDON' | 'NY' | 'OFF_HOURS';
  dayOfWeek: number;
  hourOfDay: number;
}

export interface SlippageStatistics {
  symbol: string;
  period: string;
  count: number;
  
  // Slippage stats
  avgSlippage: number;
  medianSlippage: number;
  stdDevSlippage: number;
  minSlippage: number;
  maxSlippage: number;
  
  // Distribution
  slippageBySession: Record<string, number>;
  slippageByHour: Record<number, number>;
  
  // Pattern detection
  isFixedSlippage: boolean;
  fixedSlippageValue: number | null;
  slippageRange: [number, number];
}

export interface DelayStatistics {
  symbol: string;
  period: string;
  count: number;
  
  // Delay stats
  avgDelay: number;
  medianDelay: number;
  stdDevDelay: number;
  minDelay: number;
  maxDelay: number;
  
  // Pattern detection
  isFixedDelay: boolean;
  fixedDelayValue: number | null;
  delayBySession: Record<string, number>;
}

export interface ExecutionProfile {
  symbol: string;
  lastUpdated: number;
  tradeCount: number;
  
  slippage: SlippageStatistics;
  delay: DelayStatistics;
  
  // Spread analysis
  avgSpread: number;
  spreadBySession: Record<string, number>;
  spreadWidensAt: string[]; // Times when spread typically widens
  
  // Risk assessment
  executionRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedSlippage: number;
  expectedDelay: number;
}

// ============================================================================
// TTP Compliance Types
// ============================================================================

export type TTPDrawdownType = 'static' | 'trailing';
export type TTPPhase = 1 | 2 | 'funded';
export type TTPRiskLevel = 'safe' | 'caution' | 'danger' | 'critical';

export interface TTPLeverageCaps {
  forex: number;
  metals: number;
  energies: number;
  indices: number;
  crypto: number;
  equities: number;
}

export interface TTPRules {
  // Account
  accountSize: number;
  currentBalance: number;
  phase: TTPPhase;

  // Targets
  profitTargetPercent: number;
  profitTargetAmount: number;

  // Drawdown floors (dollar amounts are authoritative; percent is reference)
  dailyDrawdownPercent: number;
  dailyDrawdownAmount: number;
  maxDrawdownPercent: number;
  maxDrawdownAmount: number;
  maxDrawdownFloor: number;        // Static equity floor — equity must NEVER touch this
  drawdownType: TTPDrawdownType;

  // Day requirements
  minProfitableDays: number;
  minDailyProfitPercent: number;
  minDailyProfitAmount: number;
  minTradingDays: number;

  // Reset boundary
  equityResetTime: string;          // "HH:MM"
  equityResetTimezone: string;      // IANA, e.g. "America/Chicago"

  // Activity
  inactivityLimitDays: number;

  // News restrictions (not yet enforced — wired for future news-feed integration)
  newsRestrictionMinutes: number;
  newsRestrictionEnabled: boolean;
  newsRestrictionAccountSizes: number[];

  // Trading style flags (not yet enforced — wired for future pattern detection)
  scalpingAllowed: boolean;
  hftProhibited: boolean;
  singleTradeTargetProhibited: boolean;
  consistencyRequired: boolean;
  consistencyRulePercent: number;
  overnightAllowed: boolean;

  // Leverage caps per asset class (not yet enforced — wired for asset classifier)
  leverage: TTPLeverageCaps;
}

export interface TTPAccountStatus {
  accountId: number;
  phase: TTPPhase;

  // Current state
  balance: number;
  equity: number;
  equityFloor: number;             // Static or trailing per drawdownType
  dailyStartEquity: number;

  // Drawdown — both dollar and percent surfaces
  dailyDrawdownAmount: number;     // Dollars lost today
  dailyDrawdownPct: number;
  totalDrawdownAmount: number;     // Dollars below initial peak
  totalDrawdownPct: number;

  // Profitable days
  profitableDays: number;
  totalTradingDays: number;

  // Profit-target progress
  profitTargetMet: boolean;
  profitToTarget: number;          // Dollars remaining; negative if surpassed

  // Rule compliance
  isCompliant: boolean;
  violations: TTPViolation[];
  warnings: TTPWarning[];

  // Risk remaining
  riskRemainingToday: number;
  marginAvailable: number;
}

export interface TTPRiskStatus {
  availableDrawdown: number;        // balance - maxDrawdownFloor (negative = breached)
  dailyDrawdownRemaining: number;   // dailyDrawdownAmount - todaysLoss (negative = breached)
  profitToTarget: number;           // profitTarget - balance (negative = met)
  riskLevel: TTPRiskLevel;
  reason: string;                   // Human-readable explanation
}

export interface TTPViolation {
  type: 'DAILY_DRAWDOWN' | 'TOTAL_DRAWDOWN' | 'RISK_PER_TRADE' | 'MARGIN_LIMIT' | 'STATIC_FLOOR';
  timestamp: number;
  value: number;
  limit: number;
  description: string;
}

export interface TTPWarning {
  type: 'APPROACHING_DAILY_LIMIT' | 'APPROACHING_TOTAL_LIMIT' | 'HIGH_RISK_TRADE' | 'APPROACHING_STATIC_FLOOR';
  timestamp: number;
  value: number;
  threshold: number;
  description: string;
}

// ============================================================================
// Signal Types
// ============================================================================

export interface TradingSignal {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  
  // Entry/Exit
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  
  // Confidence
  confidence: number;           // 0-100
  marketConfidence: number;     // Based on SMC analysis
  executionConfidence: number;  // Based on execution conditions
  
  // Execution assessment
  executionRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedSlippage: number;
  expectedDelay: number;
  recommendedSpreadLimit: number;
  
  // SMC context
  smcContext: {
    liquiditySweep: boolean;
    sweepType: 'HIGH' | 'LOW' | null;
    fvgPresent: boolean;
    fvgDistance: number | null;
    structureBreak: boolean;
    orderBlock: boolean;
  };
  
  // TTP compliance
  ttpCompliant: boolean;
  riskPct: number;
  positionSize: number;
}

// ============================================================================
// Plugin State Types
// ============================================================================

export interface LandingState {
  isConnected: boolean;
  mt5Connected: boolean;
  mexcConnected: boolean;
  
  // Latest data
  lastMT5Tick: MT5TickData | null;
  lastMT5Account: MT5AccountState | null;
  lastMEXCPrice: MEXCTickerData | null;
  
  // Execution history
  executionRecords: ExecutionRecord[];
  
  // Profiles
  executionProfiles: Record<string, ExecutionProfile>;
  
  // TTP status
  ttpStatus: TTPAccountStatus | null;
  
  // Active signals
  activeSignals: TradingSignal[];
}

// ============================================================================
// Configuration Types
// ============================================================================

export type MEXCMode = 'rest' | 'websocket';

export interface LaelPluginConfig {
  mt5Endpoint: string;
  mexcEnabled: boolean;
  mexcSymbols: string[];
  mexcMode?: MEXCMode;
  mexcPollIntervalMs?: number;
  ttpMonitorEnabled: boolean;
  ttpRules: TTPRules;
}
