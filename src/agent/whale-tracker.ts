/**
 * Whale Tracker System for Polymarket
 * Monitors large trades by whale accounts and detects significant market movements
 * for early signal generation and insider activity detection.
 */

import {
  fetchRecentTrades,
  fetchTraderActivity,
  fetchTraderPositions,
} from "@/src/tools/polymarket-data-api";
import { withRetry } from "@/src/lib/retry";

/**
 * Alert triggered by a large whale trade
 */
export interface WhaleTradeAlert {
  traderAddress: string;
  conditionId: string;
  question: string;
  tokenId: string;
  side: "buy_yes" | "buy_no";
  size: number;
  price: number;
  timestamp: number;
  totalValue: number;
  isInsider: boolean;
  marketSlug?: string;
}

/**
 * Detected volume spike on a market
 */
export interface VolumeSpike {
  conditionId: string;
  question: string;
  normalVolume: number;
  currentVolume: number;
  spikeMultiplier: number;
  timestamp: number;
  direction: "bullish" | "bearish" | "mixed";
}

/**
 * Comprehensive profile of a whale trader
 */
export interface WhaleProfile {
  address: string;
  username: string;
  totalVolume: number;
  avgTradeSize: number;
  largestTrade: number;
  recentTrades: WhaleTradeAlert[];
  winRate: number;
  firstSeen: number;
  lastSeen: number;
  isTracked: boolean;
}

/**
 * Configuration for whale tracking behavior
 */
export interface WhaleTrackerConfig {
  minTradeSize: number;
  volumeSpikeMultiplier: number;
  maxTrackedWhales: number;
  alertCooldownMs: number;
}

/**
 * Consensus analysis result from whale trades
 */
export interface WhaleConsensusResult {
  side: "buy_yes" | "buy_no" | "mixed";
  whaleCount: number;
  totalVolume: number;
  avgPrice: number;
  confidence: number;
}

/**
 * Whale-specific trading signal
 */
export interface WhaleSignal {
  conditionId: string;
  question: string;
  marketSlug?: string;
  side: "buy_yes" | "buy_no";
  confidence: number;
  whaleCount: number;
  totalWhaleVolume: number;
  avgWhalePrice: number;
  alerts: WhaleTradeAlert[];
  timestamp: number;
}

/**
 * WhaleTracker: Monitors and analyzes whale trading activity
 */
export class WhaleTracker {
  private config: WhaleTrackerConfig;
  private whaleProfiles: Map<string, WhaleProfile>;
  private recentAlerts: WhaleTradeAlert[];
  private volumeHistory: Map<string, number[]>;
  private lastAlertTime: Map<string, number>;

  constructor(config: Partial<WhaleTrackerConfig> = {}) {
    this.config = {
      minTradeSize: config.minTradeSize ?? 10000,
      volumeSpikeMultiplier: config.volumeSpikeMultiplier ?? 3,
      maxTrackedWhales: config.maxTrackedWhales ?? 50,
      alertCooldownMs: config.alertCooldownMs ?? 300000,
    };

    this.whaleProfiles = new Map();
    this.recentAlerts = [];
    this.volumeHistory = new Map();
    this.lastAlertTime = new Map();
  }

  /**
   * Scans for large trades across active markets
   * Fetches recent large trades and identifies whale accounts
   */
  async scanForWhales(): Promise<WhaleTradeAlert[]> {
    try {
      const alerts: WhaleTradeAlert[] = [];

      // Fetch leaderboard to identify top traders
      const leaderboardData = await withRetry(
        () =>
          fetch(
            "https://data-api.polymarket.com/v1/leaderboard?timePeriod=WEEK&orderBy=PNL&limit=50&category=OVERALL"
          ).then((r) => r.json()),
        { maxRetries: 3, label: "fetch-leaderboard-whales" }
      );

      const topTraders =
        leaderboardData.leaderboard || leaderboardData.data || [];

      // Scan each top trader's recent activity
      for (const trader of topTraders.slice(0, 20)) {
        try {
          const activity = await withRetry(
            () =>
              fetchTraderActivity(
                trader.addressOrUsername || trader.address,
                50
              ),
            { maxRetries: 2, label: `fetch-activity-${trader.address.slice(0, 8)}` }
          );

          if (!activity || !Array.isArray(activity)) continue;

          // Process each trade
          for (const trade of activity) {
            const size = parseFloat(trade.size || "0");
            const price = parseFloat(trade.price || "0");
            const tradeValue = size * price;

            if (tradeValue >= this.config.minTradeSize) {
              const alert: WhaleTradeAlert = {
                traderAddress: trader.addressOrUsername || trader.address,
                conditionId: trade.conditionId || "",
                question: trade.title || "Unknown Market",
                tokenId: trade.asset || "",
                side: this.determineSide(trade),
                size,
                price,
                timestamp: parseInt(trade.timestamp || String(Date.now())),
                totalValue: tradeValue,
                isInsider: false,
                marketSlug: trade.slug || undefined,
              };

              // Check for insider activity
              alert.isInsider = await this.isInsiderActivity(
                alert.traderAddress,
                alert.conditionId,
                alert.price,
                alert.timestamp
              );

              alerts.push(alert);
              this.recentAlerts.push(alert);

              // Update whale profile
              this.updateWhaleProfile(trader, alert);
            }
          }
        } catch (error) {
          console.error(
            `Error scanning whale ${trader.address}:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      // Keep only recent alerts (last 24 hours)
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      this.recentAlerts = this.recentAlerts.filter((a) => a.timestamp > oneDayAgo);

      return alerts;
    } catch (error) {
      console.error(
        "Error in scanForWhales:",
        error instanceof Error ? error.message : error
      );
      return [];
    }
  }

  /**
   * Detects volume spikes by comparing current volume to rolling average
   */
  detectVolumeSpikesByMarket(
    markets: Array<{ conditionId: string; question: string; tokenId: string; volume: number }>
  ): VolumeSpike[] {
    const spikes: VolumeSpike[] = [];

    for (const market of markets) {
      const key = market.conditionId;
      const history = this.volumeHistory.get(key) || [];

      // Add current volume to history
      history.push(market.volume);

      // Keep last 100 measurements
      if (history.length > 100) {
        history.shift();
      }

      this.volumeHistory.set(key, history);

      if (history.length < 2) continue;

      // Calculate rolling average (excluding current)
      const avg =
        history.slice(0, -1).reduce((a, b) => a + b, 0) /
        (history.length - 1);
      const current = market.volume;
      const multiplier = current / (avg + 1); // +1 to avoid division by zero

      if (multiplier >= this.config.volumeSpikeMultiplier) {
        // Determine direction based on whale trades on this market
        const whaleTradesOnMarket = this.recentAlerts.filter(
          (a) => a.conditionId === market.conditionId
        );

        let yesBuys = 0;
        let noBuys = 0;
        for (const trade of whaleTradesOnMarket) {
          if (trade.side === "buy_yes") yesBuys++;
          else noBuys++;
        }

        let direction: "bullish" | "bearish" | "mixed" = "mixed";
        if (yesBuys > noBuys * 1.5) direction = "bullish";
        else if (noBuys > yesBuys * 1.5) direction = "bearish";

        spikes.push({
          conditionId: market.conditionId,
          question: market.question,
          normalVolume: avg,
          currentVolume: current,
          spikeMultiplier: multiplier,
          timestamp: Date.now(),
          direction,
        });
      }
    }

    return spikes;
  }

  /**
   * Build or retrieve a whale's trading profile
   */
  getWhaleProfile(address: string): WhaleProfile {
    if (this.whaleProfiles.has(address)) {
      return this.whaleProfiles.get(address)!;
    }

    const tradesForWhale = this.recentAlerts.filter(
      (a) => a.traderAddress === address
    );

    const profile: WhaleProfile = {
      address,
      username: address.slice(0, 10) + "...",
      totalVolume: tradesForWhale.reduce((sum, t) => sum + t.totalValue, 0),
      avgTradeSize:
        tradesForWhale.length > 0
          ? tradesForWhale.reduce((sum, t) => sum + t.totalValue, 0) /
            tradesForWhale.length
          : 0,
      largestTrade: tradesForWhale.length > 0 ? Math.max(...tradesForWhale.map((t) => t.totalValue)) : 0,
      recentTrades: tradesForWhale.slice(-10),
      winRate: 0, // Would need historical price data
      firstSeen: tradesForWhale.length > 0 ? Math.min(...tradesForWhale.map((t) => t.timestamp)) : Date.now(),
      lastSeen: tradesForWhale.length > 0 ? Math.max(...tradesForWhale.map((t) => t.timestamp)) : Date.now(),
      isTracked: this.whaleProfiles.size < this.config.maxTrackedWhales,
    };

    this.whaleProfiles.set(address, profile);
    return profile;
  }

  /**
   * Retrieve recent whale alerts within specified timeframe
   */
  getRecentAlerts(minutes: number): WhaleTradeAlert[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.recentAlerts.filter((a) => a.timestamp > cutoff);
  }

  /**
   * Heuristic check for insider activity
   * Flags trades that occur before significant price moves
   */
  private async isInsiderActivity(
    address: string,
    conditionId: string,
    tradePrice: number,
    tradeTime: number
  ): Promise<boolean> {
    try {
      // Check if this trader has cooled down for alerts
      const cooldownKey = `${address}_${conditionId}`;
      const lastAlert = this.lastAlertTime.get(cooldownKey) || 0;

      if (Date.now() - lastAlert < this.config.alertCooldownMs) {
        return false;
      }

      // Fetch trader positions to see if they're holding a significant position
      const positions = await withRetry(
        () => fetchTraderPositions(address),
        { maxRetries: 2, label: `fetch-positions-${address.slice(0, 8)}` }
      );

      if (!positions || !Array.isArray(positions)) return false;

      const positionOnMarket = positions.find((p) => p.conditionId === conditionId);

      // If they have a large position on this market, it could indicate insider knowledge
      const hasLargePosition = positionOnMarket && (parseFloat(positionOnMarket.size || "0")) > this.config.minTradeSize;

      if (hasLargePosition) {
        this.lastAlertTime.set(cooldownKey, Date.now());
        return true;
      }

      return false;
    } catch (error) {
      console.error(
        "Error checking insider activity:",
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  /**
   * Update or create a whale profile based on a trade
   */
  private updateWhaleProfile(trader: any, alert: WhaleTradeAlert): void {
    const profile = this.getWhaleProfile(alert.traderAddress);
    profile.username = trader.username || trader.display_name || trader.name || profile.username;
    profile.lastSeen = Math.max(profile.lastSeen, alert.timestamp);
  }

  /**
   * Determine trade side from trade object
   */
  private determineSide(trade: any): "buy_yes" | "buy_no" {
    if (
      trade.side === "buy" ||
      trade.side === "long" ||
      trade.token === "YES" ||
      trade.tokenId === "1"
    ) {
      return "buy_yes";
    }
    return "buy_no";
  }
}

/**
 * WhaleConsensusAnalyzer: Analyzes consensus among whale trades
 */
export class WhaleConsensusAnalyzer {
  /**
   * Analyze consensus on a specific market from whale trades
   */
  analyzeConsensus(
    conditionId: string,
    alerts: WhaleTradeAlert[]
  ): WhaleConsensusResult {
    const marketAlerts = alerts.filter((a) => a.conditionId === conditionId);

    if (marketAlerts.length === 0) {
      return {
        side: "mixed",
        whaleCount: 0,
        totalVolume: 0,
        avgPrice: 0,
        confidence: 0,
      };
    }

    const yesBuys = marketAlerts.filter((a) => a.side === "buy_yes");
    const noBuys = marketAlerts.filter((a) => a.side === "buy_no");

    const yesVolume = yesBuys.reduce((sum, a) => sum + a.totalValue, 0);
    const noVolume = noBuys.reduce((sum, a) => sum + a.totalValue, 0);

    // Determine dominant side
    let side: "buy_yes" | "buy_no" | "mixed" = "mixed";
    let dominantAlerts = marketAlerts;

    if (yesVolume > noVolume * 1.5) {
      side = "buy_yes";
      dominantAlerts = yesBuys;
    } else if (noVolume > yesVolume * 1.5) {
      side = "buy_no";
      dominantAlerts = noBuys;
    }

    const totalVolume = yesVolume + noVolume;
    const avgPrice =
      dominantAlerts.length > 0
        ? dominantAlerts.reduce((sum, a) => sum + a.price, 0) /
          dominantAlerts.length
        : 0;

    // Get unique whale addresses
    const uniqueWhales = new Set(marketAlerts.map((a) => a.traderAddress));
    const whaleCount = uniqueWhales.size;

    // Calculate consistency (percentage of whales agreeing on dominant side)
    const consistency =
      side === "mixed" ? 0.5 : (dominantAlerts.length / marketAlerts.length);

    // Confidence calculation:
    // 50% from whale count (up to 5), 30% from volume, 20% from consistency
    const confidence = Math.min(
      0.95,
      (Math.min(whaleCount, 5) / 5) * 0.5 +
        (Math.min(totalVolume, 100000) / 100000) * 0.3 +
        consistency * 0.2
    );

    return {
      side,
      whaleCount,
      totalVolume,
      avgPrice,
      confidence,
    };
  }
}

/**
 * Generate trading signals from whale activity
 * Groups trades by market and side, filters by volume threshold
 */
export function generateWhaleSignals(
  alerts: WhaleTradeAlert[],
  existingPositionIds: string[] = []
): WhaleSignal[] {
  const signals: WhaleSignal[] = [];
  const groupedByMarketAndSide = new Map<string, WhaleTradeAlert[]>();

  // Group alerts by conditionId + side
  for (const alert of alerts) {
    const key = `${alert.conditionId}_${alert.side}`;
    if (!groupedByMarketAndSide.has(key)) {
      groupedByMarketAndSide.set(key, []);
    }
    groupedByMarketAndSide.get(key)!.push(alert);
  }

  // Generate signals for groups above volume threshold
  for (const [key, groupAlerts] of groupedByMarketAndSide.entries()) {
    const [conditionId, side] = key.split("_");

    // Skip if already in portfolio
    if (existingPositionIds.includes(conditionId)) {
      continue;
    }

    const totalVolume = groupAlerts.reduce((sum, a) => sum + a.totalValue, 0);

    // Only generate signal if total whale volume > $25K
    if (totalVolume >= 25000) {
      const avgPrice =
        groupAlerts.reduce((sum, a) => sum + a.price, 0) / groupAlerts.length;
      const uniqueWhales = new Set(groupAlerts.map((a) => a.traderAddress));

      // Confidence: weighted by whale count (up to 5) and volume (up to $100K)
      const whaleConfidence = (Math.min(uniqueWhales.size, 5) / 5) * 0.7;
      const volumeConfidence = (Math.min(totalVolume, 100000) / 100000) * 0.3;
      const confidence = Math.min(0.95, whaleConfidence + volumeConfidence);

      signals.push({
        conditionId,
        question: groupAlerts[0].question,
        marketSlug: groupAlerts[0].marketSlug,
        side: side as "buy_yes" | "buy_no",
        confidence,
        whaleCount: uniqueWhales.size,
        totalWhaleVolume: totalVolume,
        avgWhalePrice: avgPrice,
        alerts: groupAlerts,
        timestamp: Math.max(...groupAlerts.map((a) => a.timestamp)),
      });
    }
  }

  // Sort by confidence descending
  signals.sort((a, b) => b.confidence - a.confidence);

  return signals;
}
