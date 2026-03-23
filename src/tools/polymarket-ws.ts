/**
 * Polymarket WebSocket Client for Real-Time Market Data
 *
 * Handles real-time price updates and trade detection via WebSocket connections.
 * Supports whale tracking and price monitoring across multiple market tokens.
 */

import { EventEmitter } from "events";

/**
 * Real-time price update event
 */
export interface PriceUpdate {
  tokenId: string;
  oldPrice: number;
  newPrice: number;
  timestamp: number;
  volume?: number;
  midpoint?: number;
}

/**
 * Trade event detected from WebSocket stream
 */
export interface TradeEvent {
  tokenId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  timestamp: number;
  maker?: string;
  taker?: string;
}

/**
 * Whale trade alert (trade exceeding size threshold)
 */
export interface WhaleAlert {
  tokenId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  timestamp: number;
  question?: string;
  threshold: number;
  valueUSD: number;
}

/**
 * WebSocket connection state
 */
export type WSConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

/**
 * Price history entry
 */
interface PriceHistoryEntry {
  price: number;
  timestamp: number;
}

/**
 * Tracked price data per token
 */
interface TrackedPrice {
  currentPrice: number;
  previousPrice: number;
  high24h: number;
  low24h: number;
  priceHistory: PriceHistoryEntry[];
}

/**
 * Whale activity statistics
 */
export interface WhaleActivityStats {
  totalWhaleTradesDetected: number;
  largestTrade: WhaleAlert | null;
  recentWhales: WhaleAlert[];
}

/**
 * Main PolymarketWebSocket class for real-time data
 */
export class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private wsImplementation: typeof WebSocket;
  private state: WSConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private subscriptions: Set<string> = new Set();
  private priceCallbacks: Array<(update: PriceUpdate) => void> = [];
  private tradeCallbacks: Array<(trade: TradeEvent) => void> = [];
  private stateChangeCallbacks: Array<(state: WSConnectionState) => void> = [];
  private messageBuffer: any[] = [];

  constructor(
    wsImpl: typeof WebSocket = (globalThis.WebSocket as any),
    url: string = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
  ) {
    this.wsImplementation = wsImpl;
    this.url = url;
  }

  /**
   * Connect to WebSocket endpoint
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.setState("connecting");

    return new Promise((resolve, reject) => {
      try {
        this.ws = new this.wsImplementation(this.url);

        this.ws.onopen = () => {
          console.log("[PolymarketWS] Connected to Polymarket WebSocket");
          this.setState("connected");
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.startHeartbeat();
          this.processMessageBuffer();
          resolve();
        };

        this.ws.onmessage = (event: any) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error: any) => {
          console.error("[PolymarketWS] WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("[PolymarketWS] WebSocket closed");
          this.setState("disconnected");
          this.stopHeartbeat();
          this.attemptReconnect();
        };

        // Set timeout for connection attempt
        const connectionTimeout = setTimeout(() => {
          if (this.state === "connecting") {
            this.ws?.close();
            reject(new Error("WebSocket connection timeout"));
          }
        }, 10000);

        // Clear timeout on successful connection
        const originalOnOpen = this.ws.onopen;
        const wsInstance = this.ws;
        this.ws.onopen = (event: any) => {
          clearTimeout(connectionTimeout);
          if (wsInstance) {
            originalOnOpen?.call(wsInstance, event);
          }
        };
      } catch (error) {
        this.setState("disconnected");
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
    this.subscriptions.clear();
    this.messageBuffer = [];
  }

  /**
   * Subscribe to market price updates for specific tokens
   */
  subscribe(tokenIds: string[]): void {
    if (!Array.isArray(tokenIds)) {
      return;
    }

    const newSubscriptions = tokenIds.filter((id) => !this.subscriptions.has(id));

    if (newSubscriptions.length === 0) {
      return;
    }

    newSubscriptions.forEach((id) => this.subscriptions.add(id));

    const message = {
      action: "subscribe",
      tokens: newSubscriptions,
    };

    this.send(message);
  }

  /**
   * Unsubscribe from market price updates
   */
  unsubscribe(tokenIds: string[]): void {
    if (!Array.isArray(tokenIds)) {
      return;
    }

    const toRemove = tokenIds.filter((id) => this.subscriptions.has(id));

    if (toRemove.length === 0) {
      return;
    }

    toRemove.forEach((id) => this.subscriptions.delete(id));

    const message = {
      action: "unsubscribe",
      tokens: toRemove,
    };

    this.send(message);
  }

  /**
   * Register callback for price updates
   */
  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    if (typeof callback === "function") {
      this.priceCallbacks.push(callback);
    }
  }

  /**
   * Register callback for trade detection
   */
  onTradeDetected(callback: (trade: TradeEvent) => void): void {
    if (typeof callback === "function") {
      this.tradeCallbacks.push(callback);
    }
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: (state: WSConnectionState) => void): void {
    if (typeof callback === "function") {
      this.stateChangeCallbacks.push(callback);
    }
  }

  /**
   * Get current connection state
   */
  getState(): WSConnectionState {
    return this.state;
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  // Private methods

  private setState(newState: WSConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateChangeCallbacks.forEach((cb) => {
        try {
          cb(newState);
        } catch (error) {
          console.error("[PolymarketWS] Error in state change callback:", error);
        }
      });
    }
  }

  private send(message: any): void {
    if (this.state === "connected" && this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("[PolymarketWS] Error sending message:", error);
        this.messageBuffer.push(message);
      }
    } else {
      this.messageBuffer.push(message);
    }
  }

  private processMessageBuffer(): void {
    while (this.messageBuffer.length > 0) {
      const message = this.messageBuffer.shift();
      this.send(message);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === "price_update") {
        this.handlePriceUpdate(message);
      } else if (message.type === "trade") {
        this.handleTrade(message);
      } else if (message.type === "pong") {
        // Heartbeat response, do nothing
      }
    } catch (error) {
      console.error("[PolymarketWS] Error parsing message:", error);
    }
  }

  private handlePriceUpdate(message: any): void {
    if (!message.tokenId || message.price === undefined) {
      return;
    }

    const update: PriceUpdate = {
      tokenId: message.tokenId,
      oldPrice: message.oldPrice || 0,
      newPrice: message.price,
      timestamp: message.timestamp || Date.now(),
      volume: message.volume,
      midpoint: message.midpoint,
    };

    this.priceCallbacks.forEach((cb) => {
      try {
        cb(update);
      } catch (error) {
        console.error("[PolymarketWS] Error in price update callback:", error);
      }
    });
  }

  private handleTrade(message: any): void {
    if (!message.tokenId || message.size === undefined || message.price === undefined) {
      return;
    }

    const trade: TradeEvent = {
      tokenId: message.tokenId,
      side: message.side || "BUY",
      size: message.size,
      price: message.price,
      timestamp: message.timestamp || Date.now(),
      maker: message.maker,
      taker: message.taker,
    };

    this.tradeCallbacks.forEach((cb) => {
      try {
        cb(trade);
      } catch (error) {
        console.error("[PolymarketWS] Error in trade callback:", error);
      }
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.send({ action: "ping" });
    }, 30000); // Ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[PolymarketWS] Max reconnection attempts reached");
      this.setState("disconnected");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(
      `[PolymarketWS] Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`
    );

    this.setState("reconnecting");

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error("[PolymarketWS] Reconnection failed:", error);
      });
    }, delay);
  }
}

/**
 * Whale detector for identifying large trades
 */
export class WhaleDetector {
  private ws: PolymarketWebSocket;
  private threshold: number;
  private whaleCallbacks: Array<(alert: WhaleAlert) => void> = [];
  private stats: WhaleActivityStats = {
    totalWhaleTradesDetected: 0,
    largestTrade: null,
    recentWhales: [],
  };
  private maxRecentWhales = 50;

  constructor(threshold: number = 10000, wsInstance?: PolymarketWebSocket) {
    this.threshold = threshold;
    this.ws = wsInstance || new PolymarketWebSocket();

    // Subscribe to trade events
    this.ws.onTradeDetected((trade) => {
      this.checkForWhale(trade);
    });
  }

  /**
   * Set threshold for whale detection (in USD)
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /**
   * Register callback for whale alerts
   */
  onWhaleDetected(callback: (alert: WhaleAlert) => void): void {
    if (typeof callback === "function") {
      this.whaleCallbacks.push(callback);
    }
  }

  /**
   * Get whale activity statistics
   */
  getStats(): WhaleActivityStats {
    return {
      ...this.stats,
      recentWhales: [...this.stats.recentWhales],
    };
  }

  /**
   * Get recent whale activity within specified time window
   */
  getRecentWhaleActivity(minutes: number): WhaleAlert[] {
    const cutoffTime = Date.now() - minutes * 60 * 1000;
    return this.stats.recentWhales.filter((whale) => whale.timestamp > cutoffTime);
  }

  /**
   * Connect to WebSocket
   */
  async connect(): Promise<void> {
    return this.ws.connect();
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.ws.disconnect();
  }

  /**
   * Subscribe to tokens
   */
  subscribe(tokenIds: string[]): void {
    this.ws.subscribe(tokenIds);
  }

  /**
   * Unsubscribe from tokens
   */
  unsubscribe(tokenIds: string[]): void {
    this.ws.unsubscribe(tokenIds);
  }

  // Private methods

  private checkForWhale(trade: TradeEvent): void {
    const valueUSD = trade.size * trade.price;

    if (valueUSD >= this.threshold) {
      const alert: WhaleAlert = {
        tokenId: trade.tokenId,
        side: trade.side,
        size: trade.size,
        price: trade.price,
        timestamp: trade.timestamp,
        threshold: this.threshold,
        valueUSD,
      };

      this.stats.totalWhaleTradesDetected++;

      // Update largest trade
      if (
        !this.stats.largestTrade ||
        alert.valueUSD > this.stats.largestTrade.valueUSD
      ) {
        this.stats.largestTrade = alert;
      }

      // Add to recent whales
      this.stats.recentWhales.unshift(alert);
      if (this.stats.recentWhales.length > this.maxRecentWhales) {
        this.stats.recentWhales.pop();
      }

      // Emit alert
      this.whaleCallbacks.forEach((cb) => {
        try {
          cb(alert);
        } catch (error) {
          console.error("[WhaleDetector] Error in whale alert callback:", error);
        }
      });
    }
  }
}

/**
 * Price tracker for monitoring market prices
 */
export class PriceTracker {
  private ws: PolymarketWebSocket;
  private prices: Map<string, TrackedPrice> = new Map();
  private maxHistoryLength = 100;

  constructor(wsInstance?: PolymarketWebSocket) {
    this.ws = wsInstance || new PolymarketWebSocket();

    // Subscribe to price updates
    this.ws.onPriceUpdate((update) => {
      this.updatePrice(update);
    });
  }

  /**
   * Get current price for a token
   */
  getPrice(tokenId: string): number | null {
    const tracked = this.prices.get(tokenId);
    return tracked ? tracked.currentPrice : null;
  }

  /**
   * Get price change (in percentage)
   */
  getPriceChange(tokenId: string): number | null {
    const tracked = this.prices.get(tokenId);
    if (!tracked || tracked.previousPrice === 0) {
      return null;
    }
    return ((tracked.currentPrice - tracked.previousPrice) / tracked.previousPrice) * 100;
  }

  /**
   * Get 24h volatility (standard deviation of price changes)
   */
  getVolatility(tokenId: string): number | null {
    const tracked = this.prices.get(tokenId);
    if (!tracked || tracked.priceHistory.length < 2) {
      return null;
    }

    const history = tracked.priceHistory;
    const changes: number[] = [];

    for (let i = 1; i < history.length; i++) {
      const change = (history[i].price - history[i - 1].price) / history[i - 1].price;
      changes.push(change);
    }

    if (changes.length === 0) {
      return 0;
    }

    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance =
      changes.reduce((sum, change) => sum + Math.pow(change - mean, 2), 0) / changes.length;
    return Math.sqrt(variance) * 100; // Return as percentage
  }

  /**
   * Get price history for a token
   */
  getPriceHistory(tokenId: string): PriceHistoryEntry[] | null {
    const tracked = this.prices.get(tokenId);
    return tracked ? [...tracked.priceHistory] : null;
  }

  /**
   * Get all tracked prices
   */
  getAllPrices(): Record<string, number> {
    const result: Record<string, number> = {};
    this.prices.forEach((tracked, tokenId) => {
      result[tokenId] = tracked.currentPrice;
    });
    return result;
  }

  /**
   * Get high/low 24h for a token
   */
  get24hRange(tokenId: string): { high: number; low: number } | null {
    const tracked = this.prices.get(tokenId);
    return tracked ? { high: tracked.high24h, low: tracked.low24h } : null;
  }

  /**
   * Connect to WebSocket
   */
  async connect(): Promise<void> {
    return this.ws.connect();
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.ws.disconnect();
  }

  /**
   * Subscribe to tokens
   */
  subscribe(tokenIds: string[]): void {
    this.ws.subscribe(tokenIds);
  }

  /**
   * Unsubscribe from tokens
   */
  unsubscribe(tokenIds: string[]): void {
    this.ws.unsubscribe(tokenIds);
  }

  // Private methods

  private updatePrice(update: PriceUpdate): void {
    let tracked = this.prices.get(update.tokenId);

    if (!tracked) {
      tracked = {
        currentPrice: update.newPrice,
        previousPrice: update.oldPrice || update.newPrice,
        high24h: update.newPrice,
        low24h: update.newPrice,
        priceHistory: [],
      };
    }

    tracked.previousPrice = tracked.currentPrice;
    tracked.currentPrice = update.newPrice;
    tracked.high24h = Math.max(tracked.high24h, update.newPrice);
    tracked.low24h = Math.min(tracked.low24h, update.newPrice);

    // Add to history
    tracked.priceHistory.push({
      price: update.newPrice,
      timestamp: update.timestamp,
    });

    // Keep only last N entries
    if (tracked.priceHistory.length > this.maxHistoryLength) {
      tracked.priceHistory.shift();
    }

    this.prices.set(update.tokenId, tracked);
  }
}
