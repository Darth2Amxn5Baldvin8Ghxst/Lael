// TradingView Data Feed Handler
// Receives webhook data from TradingView Pine Script alerts.

export interface TVCandle {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TVIndicators {
  vwap: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
}

export interface TVLiquidityZone {
  type: 'equal_high' | 'equal_low' | 'swing_high' | 'swing_low' | 'fvg_bullish' | 'fvg_bearish';
  price: number;
  strength: number; // 1-5
  touched: boolean;
}

export interface TVMarketData {
  symbol: string;
  timeframe: string;
  timestamp: number;
  candle: TVCandle;
  indicators: TVIndicators;
  liquidityZones: TVLiquidityZone[];
  trend: 'bullish' | 'bearish' | 'ranging';
  volatility: 'low' | 'medium' | 'high';
}

export class TradingViewFeed {
  private latestData: Map<string, TVMarketData> = new Map();
  private dataHistory: Map<string, TVMarketData[]> = new Map();
  private maxHistorySize = 100;

  // Callbacks
  public onDataReceived: ((data: TVMarketData) => void) | null = null;
  public onFVGDetected: ((zone: TVLiquidityZone, data: TVMarketData) => void) | null = null;
  public onLiquiditySweep: ((zone: TVLiquidityZone, data: TVMarketData) => void) | null = null;

  constructor() {
    console.log('[TradingView] Feed initialized');
  }

  processWebhook(payload: unknown): { success: boolean; message: string } {
    try {
      const data = this.parsePayload(payload);

      const key = `${data.symbol}_${data.timeframe}`;
      this.latestData.set(key, data);

      const history = this.dataHistory.get(key) ?? [];
      history.push(data);
      if (history.length > this.maxHistorySize) {
        history.shift();
      }
      this.dataHistory.set(key, history);

      console.log(`[TradingView] ${data.symbol} ${data.timeframe}: O=${data.candle.open} H=${data.candle.high} L=${data.candle.low} C=${data.candle.close} RSI=${data.indicators.rsi.toFixed(1)} VWAP=${data.indicators.vwap.toFixed(2)}`);

      if (this.onDataReceived) {
        this.onDataReceived(data);
      }

      for (const zone of data.liquidityZones) {
        if ((zone.type === 'fvg_bullish' || zone.type === 'fvg_bearish') && this.onFVGDetected) {
          this.onFVGDetected(zone, data);
        }
      }

      return { success: true, message: 'Data processed' };
    } catch (error) {
      console.error('[TradingView] Failed to process webhook:', error);
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private parsePayload(payload: unknown): TVMarketData {
    const raw = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const data = raw as Record<string, unknown>;
    const num = (v: unknown, fallback = 0): number => {
      const n = typeof v === 'number' ? v : parseFloat(v as string);
      return Number.isFinite(n) ? n : fallback;
    };

    const symbol = (data.symbol as string) || 'BTCUSD';
    const timeframe = (data.timeframe as string) || '15';
    const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();

    return {
      symbol,
      timeframe,
      timestamp,
      candle: {
        symbol,
        timeframe,
        timestamp,
        open: num(data.open),
        high: num(data.high),
        low: num(data.low),
        close: num(data.close),
        volume: num(data.volume),
      },
      indicators: {
        vwap: num(data.vwap),
        rsi: num(data.rsi, 50),
        macd: num(data.macd),
        macdSignal: num(data.macd_signal),
        macdHist: num(data.macd_hist),
        bbUpper: num(data.bb_upper),
        bbMiddle: num(data.bb_middle),
        bbLower: num(data.bb_lower),
      },
      liquidityZones: this.parseLiquidityZones(Array.isArray(data.liquidity_zones) ? data.liquidity_zones : []),
      trend: (data.trend as TVMarketData['trend']) || 'ranging',
      volatility: (data.volatility as TVMarketData['volatility']) || 'medium',
    };
  }

  private parseLiquidityZones(zones: unknown[]): TVLiquidityZone[] {
    return zones.map((raw) => {
      const z = raw as Record<string, unknown>;
      const price = typeof z.price === 'number' ? z.price : parseFloat(z.price as string);
      const strength = typeof z.strength === 'number' ? z.strength : parseInt(z.strength as string, 10);
      return {
        type: (z.type as TVLiquidityZone['type']) || 'swing_high',
        price: Number.isFinite(price) ? price : 0,
        strength: Number.isFinite(strength) ? strength : 1,
        touched: z.touched === true || z.touched === 'true',
      };
    });
  }

  getLatestData(symbol: string, timeframe: string): TVMarketData | null {
    return this.latestData.get(`${symbol}_${timeframe}`) ?? null;
  }

  getHistory(symbol: string, timeframe: string): TVMarketData[] {
    return this.dataHistory.get(`${symbol}_${timeframe}`) ?? [];
  }

  /** Compare TradingView's last close vs MEXC's last trade price for venue divergence. */
  comparePrices(tvPrice: number, mexcPrice: number): {
    discrepancy: number;
    percentDiff: number;
    significant: boolean;
  } {
    const discrepancy = tvPrice - mexcPrice;
    const percentDiff = mexcPrice > 0 ? (discrepancy / mexcPrice) * 100 : 0;
    const significant = Math.abs(percentDiff) > 0.1;
    return { discrepancy, percentDiff, significant };
  }
}
