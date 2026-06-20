/**
 * MEXC Price Feed - Ground Truth Layer
 *
 * Supports two transports:
 *  - "rest"      (default): polls /api/v3/ticker/price every N ms.
 *                Required because MEXC's public WebSocket blocks our IP.
 *  - "websocket" (fallback): connects to wss://wbs.mexc.com/ws and
 *                subscribes to public deals/depth channels.
 */

import WebSocket from 'ws';
import type { MEXCTickerData, MEXCOrderBook, MEXCMode } from './types.js';
import { applyMexcTick } from './strategies/inb-x/index.js';

export type MEXCPriceCallback = (data: MEXCTickerData) => void;
export type MEXCOrderBookCallback = (data: MEXCOrderBook) => void;
export type MEXCConnectionCallback = (connected: boolean) => void;

export class MEXCFeed {
  private ws: WebSocket | null = null;
  private symbols: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isRunning = false;

  private mode: MEXCMode = 'rest';
  private pollIntervalMs = 5000;
  private pollInterval: NodeJS.Timeout | null = null;

  // Callbacks
  private onPrice: MEXCPriceCallback | null = null;
  private onOrderBook: MEXCOrderBookCallback | null = null;
  private onConnection: MEXCConnectionCallback | null = null;

  // Latest prices
  private prices: Map<string, MEXCTickerData> = new Map();

  // Heartbeat
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(symbols: string[] = ['BTCUSDT'], mode: MEXCMode = 'rest', pollIntervalMs = 5000) {
    this.symbols = symbols;
    this.mode = mode;
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Set price callback
   */
  onPriceUpdate(callback: MEXCPriceCallback): void {
    this.onPrice = callback;
  }

  /**
   * Set orderbook callback
   */
  onOrderBookUpdate(callback: MEXCOrderBookCallback): void {
    this.onOrderBook = callback;
  }

  /**
   * Set connection status callback
   */
  onConnectionChange(callback: MEXCConnectionCallback): void {
    this.onConnection = callback;
  }

  /**
   * Start the price feed in the configured transport.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[MEXC] Already running');
      return;
    }

    this.isRunning = true;
    if (this.mode === 'rest') {
      console.log(`[MEXC] Starting REST polling (${this.pollIntervalMs}ms) for ${this.symbols.join(', ')}`);
      this.onConnection?.(true);
      await this.fetchPrices();
      this.pollInterval = setInterval(() => {
        this.fetchPrices().catch((err) => console.error('[MEXC] Poll cycle failed:', err));
      }, this.pollIntervalMs);
    } else {
      await this.connect();
    }
  }

  /**
   * Stop the price feed and release any timers/sockets.
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.onConnection?.(false);
    }
    this.cleanup();
  }

  /**
   * Fetch latest price for every configured symbol in parallel via REST.
   * One symbol's failure must not block the others.
   */
  private async fetchPrices(): Promise<void> {
    await Promise.all(this.symbols.map((symbol) => this.fetchPrice(symbol)));
  }

  private async fetchPrice(symbol: string): Promise<void> {
    try {
      const response = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`);
      if (!response.ok) {
        console.error(`[MEXC] ${symbol}: HTTP ${response.status}`);
        return;
      }
      const data = await response.json() as { symbol?: string; price?: string };
      const price = parseFloat(data.price ?? 'NaN');
      if (!Number.isFinite(price)) {
        console.error(`[MEXC] ${symbol}: invalid price payload`, data);
        return;
      }
      const ticker: MEXCTickerData = {
        symbol,
        price,
        bid: price,
        ask: price,
        volume: 0,
        timestamp: Date.now(),
      };
      this.prices.set(symbol, ticker);
      applyMexcTick(symbol, price, Date.now());
      this.onPrice?.(ticker);
      console.log(`[MEXC] ${symbol}: ${price}`);
    } catch (error) {
      console.error(`[MEXC] Failed to fetch ${symbol}:`, error);
    }
  }

  /**
   * Get latest price for a symbol
   */
  getPrice(symbol: string): MEXCTickerData | null {
    return this.prices.get(symbol) ?? null;
  }

  /**
   * Get all latest prices
   */
  getAllPrices(): Map<string, MEXCTickerData> {
    return new Map(this.prices);
  }

  /**
   * Connect to MEXC WebSocket
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // MEXC Spot WebSocket URL
        const wsUrl = 'wss://wbs.mexc.com/ws';
        
        console.log('[MEXC] Connecting to', wsUrl);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.on('open', () => {
          console.log('[MEXC] Connected');
          this.reconnectAttempts = 0;
          this.onConnection?.(true);
          
          // Subscribe to symbols
          this.subscribe();
          
          // Start ping interval
          this.startPing();
          
          resolve();
        });
        
        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('pong', () => {
          console.log('[MEXC] Received pong');
        });

        this.ws.on('error', (error) => {
          console.error('[MEXC] WebSocket error:', error.message);
        });
        
        this.ws.on('close', () => {
          console.log('[MEXC] Connection closed');
          this.onConnection?.(false);
          this.cleanup();
          
          // Attempt reconnect if still running
          if (this.isRunning) {
            this.scheduleReconnect();
          }
        });
        
      } catch (error) {
        console.error('[MEXC] Connection failed:', error);
        reject(error);
      }
    });
  }

  /**
   * Subscribe to symbol streams
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Subscribe to deals (trade prints) per symbol — publishes on every
    // executed trade, well within MEXC's idle-data timeout. bookTicker
    // does not exist on Spot v3 (futures-only), and miniTicker is too
    // sparse; both got "Blocked!" / idle-closed.
    for (const symbol of this.symbols) {
      const tickerSub = {
        method: 'SUBSCRIPTION',
        params: [`spot@public.deals.v3.api@${symbol}`]
      };

      this.ws.send(JSON.stringify(tickerSub));
      console.log(`[MEXC] Subscribed to ${symbol} deals`);

      const depthSub = {
        method: 'SUBSCRIPTION',
        params: [`spot@public.limit.depth.v3.api@${symbol}@5`]
      };

      this.ws.send(JSON.stringify(depthSub));
      console.log(`[MEXC] Subscribed to ${symbol} depth`);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      console.log('[MEXC] Data received:', JSON.stringify(message).substring(0, 200));

      // Handle ping/pong
      if (message.ping) {
        this.ws?.send(JSON.stringify({ pong: message.ping }));
        return;
      }

      // Handle subscription confirmation
      if (message.code === 0) {
        return;
      }
      
      // Handle ticker data
      if (message.c && message.d) {
        const channel = message.c;
        const msgData = message.d;
        
        if (channel.includes('deals')) {
          this.handleDeals(message.s, msgData);
        } else if (channel.includes('bookTicker') || channel.includes('miniTicker')) {
          this.handleTicker(msgData);
        } else if (channel.includes('depth')) {
          this.handleOrderBook(msgData);
        }
      }
      
    } catch (error) {
      // Ignore parse errors for non-JSON messages
    }
  }

  /**
   * Handle deals (trade prints) update.
   * MEXC sends a `deals` array; the last entry is the most recent trade.
   * Spot v3 deals carries no bid/ask, so we mirror price into both fields
   * — execution analyzer treats spread separately via the depth channel.
   */
  private handleDeals(symbol: string, data: any): void {
    try {
      const deals = Array.isArray(data?.deals) ? data.deals : [];
      if (deals.length === 0) return;
      const latest = deals[deals.length - 1];
      const price = parseFloat(latest.p);
      const volume = parseFloat(latest.v ?? '0');
      const ticker: MEXCTickerData = {
        symbol,
        price,
        bid: price,
        ask: price,
        volume,
        timestamp: typeof latest.t === 'number' ? latest.t : Date.now(),
      };
      this.prices.set(ticker.symbol, ticker);
      this.onPrice?.(ticker);
    } catch (error) {
      console.error('[MEXC] Error parsing deals:', error);
    }
  }

  /**
   * Handle ticker update
   */
  private handleTicker(data: any): void {
    try {
      const ticker: MEXCTickerData = {
        symbol: data.s,
        price: parseFloat(data.p),
        bid: parseFloat(data.b || data.p),
        ask: parseFloat(data.a || data.p),
        volume: parseFloat(data.v || '0'),
        timestamp: Date.now(),
      };
      
      this.prices.set(ticker.symbol, ticker);
      this.onPrice?.(ticker);
      
    } catch (error) {
      console.error('[MEXC] Error parsing ticker:', error);
    }
  }

  /**
   * Handle orderbook update
   */
  private handleOrderBook(data: any): void {
    try {
      const book: MEXCOrderBook = {
        symbol: data.s,
        bids: (data.bids || []).map((b: any) => [parseFloat(b.p), parseFloat(b.v)]),
        asks: (data.asks || []).map((a: any) => [parseFloat(a.p), parseFloat(a.v)]),
        timestamp: Date.now(),
      };
      
      this.onOrderBook?.(book);
      
    } catch (error) {
      console.error('[MEXC] Error parsing orderbook:', error);
    }
  }

  /**
   * Start ping interval to keep connection alive.
   * MEXC requires native WebSocket PING frames — JSON keepalive payloads
   * are ignored and the server closes the socket at the ~30s deadline.
   * Send first ping immediately, then every 15s.
   */
  private startPing(): void {
    const sendPing = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[MEXC] Sending ping');
        this.ws.ping();
      }
    };
    sendPing();
    this.pingInterval = setInterval(sendPing, 15000);
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[MEXC] Max reconnect attempts reached');
      this.isRunning = false;
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[MEXC] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.isRunning) {
        this.connect().catch(console.error);
      }
    }, delay);
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // Ignore close errors
      }
      this.ws = null;
    }
  }

  /**
   * Check if connected (or actively polling, in REST mode).
   */
  isConnected(): boolean {
    if (this.mode === 'rest') {
      return this.isRunning && this.pollInterval !== null;
    }
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
