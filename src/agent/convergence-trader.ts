import { withRetry } from "@/src/lib/retry";

/**
 * Types for CEX convergence trading strategy
 */
export interface CEXPriceFeed {
  exchange: "binance" | "coinbase";
  symbol: string;
  price: number;
  timestamp: number;
  volume24h: number;
}

export interface ConvergenceSignal {
  conditionId: string;
  question: string;
  tokenId: string;
  side: "buy_yes" | "buy_no";
  confidence: number;
  reasoning: string;
  cexPrice: number;
  polymarketPrice: number;
  expectedPolyPrice: number;
  priceLagPercent: number;
  suggestedSize: number;
  exchange: string;
  symbol: string;
}

export interface CryptoMarketMapping {
  symbol: string; // e.g., "BTC", "ETH"
  conditionId: string;
  question: string;
  tokenId: string;
  threshold: number; // e.g., 100000 for "Will BTC hit $100K?"
  direction: "above" | "below";
}

/**
 * Binance WebSocket price feed
 */
export class BinancePriceFeed {
  private ws: WebSocket | null = null;
  private prices: Map<string, CEXPriceFeed> = new Map();
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private onPriceUpdate: ((price: CEXPriceFeed) => void) | null = null;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket("wss://stream.binance.com:9443/ws");

        this.ws.onopen = () => {
          console.log("[BinancePriceFeed] Connected");
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            this._handleTickerMessage(data);
          } catch (e) {
            console.error("[BinancePriceFeed] Parse error:", e);
          }
        };

        this.ws.onerror = (error: Event) => {
          console.error("[BinancePriceFeed] WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("[BinancePriceFeed] Disconnected");
          this._reconnect();
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  async subscribe(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[BinancePriceFeed] WebSocket not ready");
      return;
    }

    const streams = symbols
      .map((symbol) => `${symbol.toLowerCase()}@ticker`)
      .filter((stream) => !this.subscriptions.has(stream));

    if (streams.length === 0) {
      return;
    }

    const message = {
      method: "SUBSCRIBE",
      params: streams,
      id: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
    streams.forEach((stream) => this.subscriptions.add(stream));
    console.log(`[BinancePriceFeed] Subscribed to ${streams.length} streams`);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getPrice(symbol: string): CEXPriceFeed | null {
    return this.prices.get(symbol.toUpperCase()) || null;
  }

  onPrice(callback: (price: CEXPriceFeed) => void): void {
    this.onPriceUpdate = callback;
  }

  private _handleTickerMessage(data: any): void {
    // Binance ticker format: s=symbol, c=close price, v=volume
    if (!data.s || data.c === undefined) {
      return;
    }

    const symbol = data.s.replace("USDT", "").toUpperCase();
    const price: CEXPriceFeed = {
      exchange: "binance",
      symbol,
      price: parseFloat(data.c),
      timestamp: data.E || Date.now(),
      volume24h: parseFloat(data.v),
    };

    this.prices.set(symbol, price);
    this.onPriceUpdate?.(price);
  }

  private _reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[BinancePriceFeed] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[BinancePriceFeed] Reconnecting in ${delay}ms...`);

    setTimeout(() => {
      this.connect().catch((e) =>
        console.error("[BinancePriceFeed] Reconnection failed:", e)
      );
    }, delay);
  }
}

/**
 * Coinbase WebSocket price feed
 */
export class CoinbasePriceFeed {
  private ws: WebSocket | null = null;
  private prices: Map<string, CEXPriceFeed> = new Map();
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private onPriceUpdate: ((price: CEXPriceFeed) => void) | null = null;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

        this.ws.onopen = () => {
          console.log("[CoinbasePriceFeed] Connected");
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            this._handleTickerMessage(data);
          } catch (e) {
            console.error("[CoinbasePriceFeed] Parse error:", e);
          }
        };

        this.ws.onerror = (error: Event) => {
          console.error("[CoinbasePriceFeed] WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("[CoinbasePriceFeed] Disconnected");
          this._reconnect();
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  async subscribe(productIds: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[CoinbasePriceFeed] WebSocket not ready");
      return;
    }

    const newProductIds = productIds.filter(
      (id) => !this.subscriptions.has(id)
    );

    if (newProductIds.length === 0) {
      return;
    }

    const message = {
      type: "subscribe",
      channels: [
        {
          name: "ticker",
          product_ids: newProductIds,
        },
      ],
    };

    this.ws.send(JSON.stringify(message));
    newProductIds.forEach((id) => this.subscriptions.add(id));
    console.log(`[CoinbasePriceFeed] Subscribed to ${newProductIds.length} products`);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getPrice(symbol: string): CEXPriceFeed | null {
    // Coinbase uses "BTC-USD" format
    const productId = symbol.includes("-") ? symbol : `${symbol}-USD`;
    return this.prices.get(productId) || null;
  }

  onPrice(callback: (price: CEXPriceFeed) => void): void {
    this.onPriceUpdate = callback;
  }

  private _handleTickerMessage(data: any): void {
    // Coinbase ticker format: product_id, price, volume_24h
    if (data.type !== "ticker" || !data.product_id || data.price === undefined) {
      return;
    }

    const symbol = data.product_id.replace("-USD", "");
    const price: CEXPriceFeed = {
      exchange: "coinbase",
      symbol,
      price: parseFloat(data.price),
      timestamp: new Date(data.time).getTime(),
      volume24h: parseFloat(data.volume_24h) || 0,
    };

    this.prices.set(data.product_id, price);
    this.onPriceUpdate?.(price);
  }

  private _reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[CoinbasePriceFeed] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[CoinbasePriceFeed] Reconnecting in ${delay}ms...`);

    setTimeout(() => {
      this.connect().catch((e) =>
        console.error("[CoinbasePriceFeed] Reconnection failed:", e)
      );
    }, delay);
  }
}

/**
 * Estimate Polymarket probability based on CEX price
 */
export function estimateProbability(
  currentPrice: number,
  threshold: number,
  direction: "above" | "below",
  volatility: number = 0.05
): number {
  if (direction === "above") {
    if (currentPrice <= threshold * 0.95) {
      return 0.05; // Very unlikely
    }
    if (currentPrice >= threshold * 1.05) {
      return 0.95; // Very likely
    }
    // Linear interpolation between threshold ± 5%
    const priceRatio = (currentPrice - threshold * 0.95) / (threshold * 0.1);
    return Math.min(0.95, Math.max(0.05, priceRatio * 0.9 + 0.05));
  } else {
    // "below" direction: invert the logic
    if (currentPrice >= threshold * 1.05) {
      return 0.05; // Unlikely to stay below
    }
    if (currentPrice <= threshold * 0.95) {
      return 0.95; // Very likely to stay below
    }
    const priceRatio = (threshold * 1.05 - currentPrice) / (threshold * 0.1);
    return Math.min(0.95, Math.max(0.05, priceRatio * 0.9 + 0.05));
  }
}

/**
 * CEX Convergence Trading Engine
 */
export class ConvergenceTrader {
  private binance: BinancePriceFeed;
  private coinbase: CoinbasePriceFeed;
  private mappings: CryptoMarketMapping[] = [];
  private baseSize = 10; // $10 base trade size

  constructor(
    binance: BinancePriceFeed,
    coinbase: CoinbasePriceFeed,
    mappings: CryptoMarketMapping[] = []
  ) {
    this.binance = binance;
    this.coinbase = coinbase;
    this.mappings = mappings;
  }

  addMapping(mapping: CryptoMarketMapping): void {
    // Avoid duplicates
    if (!this.mappings.find((m) => m.tokenId === mapping.tokenId)) {
      this.mappings.push(mapping);
    }
  }

  async checkConvergence(): Promise<ConvergenceSignal[]> {
    const signals: ConvergenceSignal[] = [];

    for (const mapping of this.mappings) {
      try {
        const signal = await this._checkSingleConvergence(mapping);
        if (signal) {
          signals.push(signal);
        }
      } catch (e) {
        console.error(
          `[ConvergenceTrader] Error checking ${mapping.symbol}:`,
          e
        );
      }
    }

    return signals;
  }

  private async _checkSingleConvergence(
    mapping: CryptoMarketMapping
  ): Promise<ConvergenceSignal | null> {
    // Get current CEX price (try Binance first, then Coinbase)
    let cexPrice = this.binance.getPrice(mapping.symbol)?.price;
    let exchange = "binance";

    if (!cexPrice) {
      const coinbasePrice = this.coinbase.getPrice(mapping.symbol);
      if (coinbasePrice) {
        cexPrice = coinbasePrice.price;
        exchange = "coinbase";
      }
    }

    if (!cexPrice) {
      console.warn(
        `[ConvergenceTrader] No price available for ${mapping.symbol}`
      );
      return null;
    }

    // Calculate expected Polymarket probability based on CEX price
    const expectedPolyPrice = estimateProbability(
      cexPrice,
      mapping.threshold,
      mapping.direction
    );

    // Fetch current Polymarket price
    const currentPolyPrice = await this._getPolymarketPrice(mapping.tokenId);
    if (currentPolyPrice === null) {
      console.warn(
        `[ConvergenceTrader] Could not fetch Polymarket price for ${mapping.tokenId}`
      );
      return null;
    }

    // Calculate price lag percentage
    const priceLagPercent = Math.abs(expectedPolyPrice - currentPolyPrice) / expectedPolyPrice;

    // Only generate signal if lag is significant (> 5%)
    if (priceLagPercent < 0.05) {
      return null;
    }

    // Determine side: if CEX expects higher prob, buy YES; otherwise buy NO
    const side = expectedPolyPrice > currentPolyPrice ? "buy_yes" : "buy_no";

    // Calculate confidence: bigger lag = higher confidence (capped at 0.95)
    const confidence = Math.min(0.95, priceLagPercent / 0.2);

    // Suggested size scales with confidence
    const suggestedSize = this.baseSize * confidence * 2;

    const reasoning =
      `CEX price ${cexPrice} suggests Polymarket should be at ${(expectedPolyPrice * 100).toFixed(1)}%, ` +
      `but is at ${(currentPolyPrice * 100).toFixed(1)}%. Lag of ${(priceLagPercent * 100).toFixed(1)}% detected.`;

    return {
      conditionId: mapping.conditionId,
      question: mapping.question,
      tokenId: mapping.tokenId,
      side,
      confidence,
      reasoning,
      cexPrice,
      polymarketPrice: currentPolyPrice,
      expectedPolyPrice,
      priceLagPercent,
      suggestedSize,
      exchange,
      symbol: mapping.symbol,
    };
  }

  private async _getPolymarketPrice(tokenId: string): Promise<number | null> {
    try {
      const response = await withRetry(
        async () => {
          const res = await fetch(
            `https://clob.polymarket.com/midpoint?token_id=${tokenId}`
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        { maxRetries: 3, baseDelayMs: 500 }
      );

      // CLOB API returns { "mid": price_string }
      if (response.mid) {
        return parseFloat(response.mid);
      }
      return null;
    } catch (e) {
      console.error(`[ConvergenceTrader] Failed to fetch midpoint for ${tokenId}:`, e);
      return null;
    }
  }
}

/**
 * Factory function to create a ConvergenceTrader with both feeds
 */
export interface ConvergenceTraderConfig {
  binanceSymbols?: string[]; // e.g., ["BTCUSDT", "ETHUSDT"]
  coinbaseProductIds?: string[]; // e.g., ["BTC-USD", "ETH-USD"]
  cryptoMappings?: CryptoMarketMapping[];
}

export async function createConvergenceTrader(
  config: ConvergenceTraderConfig
): Promise<ConvergenceTrader> {
  const binance = new BinancePriceFeed();
  const coinbase = new CoinbasePriceFeed();

  // Connect both feeds
  await Promise.all([binance.connect(), coinbase.connect()]);

  // Subscribe to symbols
  if (config.binanceSymbols && config.binanceSymbols.length > 0) {
    await binance.subscribe(config.binanceSymbols);
  }

  if (config.coinbaseProductIds && config.coinbaseProductIds.length > 0) {
    await coinbase.subscribe(config.coinbaseProductIds);
  }

  // Create trader instance
  const trader = new ConvergenceTrader(
    binance,
    coinbase,
    config.cryptoMappings || []
  );

  return trader;
}
