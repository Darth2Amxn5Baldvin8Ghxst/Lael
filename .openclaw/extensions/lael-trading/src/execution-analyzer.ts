/**
 * Execution Analyzer - Analyzes slippage, delay, and spread patterns
 */

import type {
  MT5OrderEvent,
  MT5TickData,
  MEXCTickerData,
  ExecutionRecord,
  ExecutionProfile,
  SlippageStatistics,
  DelayStatistics,
} from './types.js';

export class ExecutionAnalyzer {
  private records: ExecutionRecord[] = [];
  private mexcPrices: Map<string, MEXCTickerData> = new Map();
  
  constructor() {}

  /**
   * Update MEXC price for comparison
   */
  setMEXCPrice(data: MEXCTickerData): void {
    this.mexcPrices.set(data.symbol, data);
  }

  /**
   * Get current MEXC price for a symbol
   */
  getMEXCPrice(symbol: string): MEXCTickerData | null {
    // Map MT5 symbol to MEXC symbol
    const mexcSymbol = this.mapToMEXCSymbol(symbol);
    return this.mexcPrices.get(mexcSymbol) ?? null;
  }

  /**
   * Map MT5 symbol to MEXC symbol
   */
  private mapToMEXCSymbol(mt5Symbol: string): string {
    const mapping: Record<string, string> = {
      'BTCUSD': 'BTCUSDT',
      'ETHUSD': 'ETHUSDT',
      'XAUUSD': 'XAUUSDT', // Note: MEXC may not have gold
    };
    return mapping[mt5Symbol] ?? mt5Symbol;
  }

  /**
   * Process an order event and create an execution record
   */
  processOrder(order: MT5OrderEvent): ExecutionRecord {
    const mexcPrice = this.getMEXCPrice(order.symbol);
    
    // Determine trading session
    const session = this.determineSession(order.deal_time_msc);
    const date = new Date(order.deal_time_msc);
    
    const record: ExecutionRecord = {
      id: `${order.deal_id}-${order.deal_time_msc}`,
      timestamp: order.deal_time_msc,
      symbol: order.symbol,
      direction: order.deal_type as 'BUY' | 'SELL',
      
      // Prices
      requestPrice: order.request_price,
      fillPrice: order.price,
      mexcPriceAtFill: mexcPrice?.price ?? null,
      
      // Calculated metrics
      slippage: order.slippage,
      trueSlippage: mexcPrice ? order.price - mexcPrice.price : null,
      delay: order.local_time_ms - order.deal_time_msc,
      spreadAtFill: order.spread_at_fill,
      
      // Costs
      commission: order.commission,
      swap: order.swap,
      totalCost: Math.abs(order.commission) + Math.abs(order.swap),
      
      // Context
      volume: order.volume,
      session,
      dayOfWeek: date.getUTCDay(),
      hourOfDay: date.getUTCHours(),
    };
    
    this.records.push(record);
    
    // Keep only last 1000 records
    if (this.records.length > 1000) {
      this.records = this.records.slice(-1000);
    }
    
    return record;
  }

  /**
   * Determine trading session from timestamp
   */
  private determineSession(timestampMs: number): 'ASIA' | 'LONDON' | 'NY' | 'OFF_HOURS' {
    const date = new Date(timestampMs);
    const utcHour = date.getUTCHours();
    
    // Asia: 00:00 - 08:00 UTC
    if (utcHour >= 0 && utcHour < 8) return 'ASIA';
    
    // London: 08:00 - 13:00 UTC (overlap with NY starts at 13:00)
    if (utcHour >= 8 && utcHour < 13) return 'LONDON';
    
    // NY: 13:00 - 21:00 UTC
    if (utcHour >= 13 && utcHour < 21) return 'NY';
    
    // Off hours: 21:00 - 00:00 UTC
    return 'OFF_HOURS';
  }

  /**
   * Calculate slippage statistics for a symbol
   */
  calculateSlippageStats(symbol: string, periodMs?: number): SlippageStatistics {
    const now = Date.now();
    const cutoff = periodMs ? now - periodMs : 0;
    
    const filtered = this.records.filter(r => 
      r.symbol === symbol && r.timestamp >= cutoff
    );
    
    if (filtered.length === 0) {
      return this.emptySlippageStats(symbol);
    }
    
    const slippages = filtered.map(r => r.slippage);
    
    // Basic stats
    const sorted = [...slippages].sort((a, b) => a - b);
    const avg = slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const variance = slippages.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / slippages.length;
    const stdDev = Math.sqrt(variance);
    
    // By session
    const bySession: Record<string, number[]> = {
      ASIA: [], LONDON: [], NY: [], OFF_HOURS: []
    };
    filtered.forEach(r => bySession[r.session].push(r.slippage));
    
    const slippageBySession: Record<string, number> = {};
    for (const [session, values] of Object.entries(bySession)) {
      slippageBySession[session] = values.length > 0 
        ? values.reduce((a, b) => a + b, 0) / values.length 
        : 0;
    }
    
    // By hour
    const byHour: Record<number, number[]> = {};
    for (let h = 0; h < 24; h++) byHour[h] = [];
    filtered.forEach(r => byHour[r.hourOfDay].push(r.slippage));
    
    const slippageByHour: Record<number, number> = {};
    for (const [hour, values] of Object.entries(byHour)) {
      slippageByHour[parseInt(hour)] = values.length > 0
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
    }
    
    // Pattern detection - is slippage fixed?
    const isFixed = stdDev < 0.0001; // Very low variance suggests fixed
    
    return {
      symbol,
      period: periodMs ? `${periodMs / (1000 * 60 * 60)}h` : 'all',
      count: filtered.length,
      
      avgSlippage: avg,
      medianSlippage: median,
      stdDevSlippage: stdDev,
      minSlippage: sorted[0],
      maxSlippage: sorted[sorted.length - 1],
      
      slippageBySession,
      slippageByHour,
      
      isFixedSlippage: isFixed,
      fixedSlippageValue: isFixed ? avg : null,
      slippageRange: [sorted[0], sorted[sorted.length - 1]],
    };
  }

  /**
   * Calculate delay statistics for a symbol
   */
  calculateDelayStats(symbol: string, periodMs?: number): DelayStatistics {
    const now = Date.now();
    const cutoff = periodMs ? now - periodMs : 0;
    
    const filtered = this.records.filter(r => 
      r.symbol === symbol && r.timestamp >= cutoff
    );
    
    if (filtered.length === 0) {
      return this.emptyDelayStats(symbol);
    }
    
    const delays = filtered.map(r => r.delay);
    
    // Basic stats
    const sorted = [...delays].sort((a, b) => a - b);
    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const variance = delays.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / delays.length;
    const stdDev = Math.sqrt(variance);
    
    // By session
    const bySession: Record<string, number[]> = {
      ASIA: [], LONDON: [], NY: [], OFF_HOURS: []
    };
    filtered.forEach(r => bySession[r.session].push(r.delay));
    
    const delayBySession: Record<string, number> = {};
    for (const [session, values] of Object.entries(bySession)) {
      delayBySession[session] = values.length > 0 
        ? values.reduce((a, b) => a + b, 0) / values.length 
        : 0;
    }
    
    // Pattern detection - is delay fixed?
    const isFixed = stdDev < 10; // Less than 10ms variance
    
    return {
      symbol,
      period: periodMs ? `${periodMs / (1000 * 60 * 60)}h` : 'all',
      count: filtered.length,
      
      avgDelay: avg,
      medianDelay: median,
      stdDevDelay: stdDev,
      minDelay: sorted[0],
      maxDelay: sorted[sorted.length - 1],
      
      isFixedDelay: isFixed,
      fixedDelayValue: isFixed ? Math.round(avg) : null,
      delayBySession,
    };
  }

  /**
   * Build execution profile for a symbol
   */
  buildExecutionProfile(symbol: string): ExecutionProfile {
    const slippage = this.calculateSlippageStats(symbol);
    const delay = this.calculateDelayStats(symbol);
    
    const filtered = this.records.filter(r => r.symbol === symbol);
    
    // Calculate spread stats
    const spreads = filtered.map(r => r.spreadAtFill);
    const avgSpread = spreads.length > 0
      ? spreads.reduce((a, b) => a + b, 0) / spreads.length
      : 0;
    
    // Spread by session
    const spreadBySession: Record<string, number[]> = {
      ASIA: [], LONDON: [], NY: [], OFF_HOURS: []
    };
    filtered.forEach(r => spreadBySession[r.session].push(r.spreadAtFill));
    
    const avgSpreadBySession: Record<string, number> = {};
    for (const [session, values] of Object.entries(spreadBySession)) {
      avgSpreadBySession[session] = values.length > 0
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
    }
    
    // Detect when spread typically widens
    const spreadWidensAt: string[] = [];
    const avgSpreadValue = avgSpread;
    for (const [session, sessionAvg] of Object.entries(avgSpreadBySession)) {
      if (sessionAvg > avgSpreadValue * 1.5) {
        spreadWidensAt.push(session);
      }
    }
    
    // Determine execution risk
    let executionRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (slippage.avgSlippage > 0.5 || delay.avgDelay > 200) {
      executionRisk = 'HIGH';
    } else if (slippage.avgSlippage > 0.2 || delay.avgDelay > 100) {
      executionRisk = 'MEDIUM';
    }
    
    return {
      symbol,
      lastUpdated: Date.now(),
      tradeCount: filtered.length,
      
      slippage,
      delay,
      
      avgSpread,
      spreadBySession: avgSpreadBySession,
      spreadWidensAt,
      
      executionRisk,
      expectedSlippage: slippage.avgSlippage,
      expectedDelay: delay.avgDelay,
    };
  }

  /**
   * Get all execution records
   */
  getRecords(): ExecutionRecord[] {
    return [...this.records];
  }

  /**
   * Get recent records
   */
  getRecentRecords(count: number): ExecutionRecord[] {
    return this.records.slice(-count);
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = [];
  }

  private emptySlippageStats(symbol: string): SlippageStatistics {
    return {
      symbol,
      period: 'none',
      count: 0,
      avgSlippage: 0,
      medianSlippage: 0,
      stdDevSlippage: 0,
      minSlippage: 0,
      maxSlippage: 0,
      slippageBySession: {},
      slippageByHour: {},
      isFixedSlippage: false,
      fixedSlippageValue: null,
      slippageRange: [0, 0],
    };
  }

  private emptyDelayStats(symbol: string): DelayStatistics {
    return {
      symbol,
      period: 'none',
      count: 0,
      avgDelay: 0,
      medianDelay: 0,
      stdDevDelay: 0,
      minDelay: 0,
      maxDelay: 0,
      isFixedDelay: false,
      fixedDelayValue: null,
      delayBySession: {},
    };
  }
}
