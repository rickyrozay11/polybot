/**
 * Copy-Trading Engine
 *
 * Strategy: Track the best traders on Polymarket and mirror their positions.
 * Uses a composite scoring system that combines:
 * - PnL (profit) — 35% weight
 * - Win rate — 25% weight
 * - Volume — 20% weight (proves conviction)
 * - Recency — 20% weight (recent performance matters more)
 *
 * Consensus-based execution: only copy trades where multiple top traders agree.
 */

import type { TrackedTrader, CopyTradeSignal, AgentConfig } from "@/src/types";
import {
  fetchLeaderboard,
  fetchTraderActivity,
  fetchTraderPositions,
  type LeaderboardEntry,
  type TraderActivityItem,
} from "@/src/tools/polymarket-data-api";
import { fetchMarketByCondition } from "@/src/tools/polymarket-scanner";

// ---- Trader Discovery & Scoring ----

export interface TraderScoreWeights {
  pnl: number;
  winRate: number;
  volume: number;
  recency: number;
}

const DEFAULT_WEIGHTS: TraderScoreWeights = {
  pnl: 0.35,
  winRate: 0.25,
  volume: 0.20,
  recency: 0.20,
};

/**
 * Discover the best traders from the Polymarket leaderboard.
 * Fetches multiple time windows and combines scores.
 */
export async function discoverTopTraders(
  limit = 20,
  weights: TraderScoreWeights = DEFAULT_WEIGHTS
): Promise<TrackedTrader[]> {
  // Fetch leaderboards across multiple windows
  const [leaders7d, leaders30d, leadersAll] = await Promise.allSettled([
    fetchLeaderboard("7d", 100),
    fetchLeaderboard("30d", 100),
    fetchLeaderboard("all", 100),
  ]);

  const all7d = leaders7d.status === "fulfilled" ? leaders7d.value : [];
  const all30d = leaders30d.status === "fulfilled" ? leaders30d.value : [];
  const allTime = leadersAll.status === "fulfilled" ? leadersAll.value : [];

  // Build a map: address -> aggregated stats
  const traderMap = new Map<
    string,
    {
      address: string;
      username: string;
      pnl7d: number;
      pnl30d: number;
      pnlAll: number;
      volume: number;
      marketsTraded: number;
      rank7d: number;
      rank30d: number;
      rankAll: number;
    }
  >();

  function addEntries(entries: LeaderboardEntry[], window: "7d" | "30d" | "all") {
    entries.forEach((e, idx) => {
      const existing = traderMap.get(e.address) ?? {
        address: e.address,
        username: e.username,
        pnl7d: 0,
        pnl30d: 0,
        pnlAll: 0,
        volume: 0,
        marketsTraded: 0,
        rank7d: 999,
        rank30d: 999,
        rankAll: 999,
      };
      if (window === "7d") {
        existing.pnl7d = e.profit;
        existing.rank7d = idx;
      } else if (window === "30d") {
        existing.pnl30d = e.profit;
        existing.rank30d = idx;
      } else {
        existing.pnlAll = e.profit;
        existing.rankAll = idx;
      }
      existing.volume = Math.max(existing.volume, e.volume);
      existing.marketsTraded = Math.max(existing.marketsTraded, e.marketsTraded);
      existing.username = e.username || existing.username;
      traderMap.set(e.address, existing);
    });
  }

  addEntries(all7d, "7d");
  addEntries(all30d, "30d");
  addEntries(allTime, "all");

  // Score each trader
  const allTraders = Array.from(traderMap.values());

  // Normalize metrics for scoring
  const maxPnl = Math.max(...allTraders.map((t) => Math.abs(t.pnlAll)), 1);
  const maxVolume = Math.max(...allTraders.map((t) => t.volume), 1);
  const maxMarkets = Math.max(...allTraders.map((t) => t.marketsTraded), 1);

  const scored: TrackedTrader[] = allTraders
    .filter((t) => t.pnlAll > 0) // Only profitable traders
    .map((t) => {
      // PnL score: weighted toward recent performance
      const pnlScore =
        (t.pnl7d / maxPnl) * 0.5 + // Recent PnL weighted 50%
        (t.pnl30d / maxPnl) * 0.3 + // 30d PnL weighted 30%
        (t.pnlAll / maxPnl) * 0.2; // All-time weighted 20%

      // Win rate estimated from ranking consistency
      // Traders ranked top-20 in multiple windows are more consistent
      const consistencyScore =
        (1 - t.rank7d / 100) * 0.5 +
        (1 - t.rank30d / 100) * 0.3 +
        (1 - t.rankAll / 100) * 0.2;

      // Volume score (log-normalized)
      const volumeScore = Math.log10(t.volume + 1) / Math.log10(maxVolume + 1);

      // Recency: 7d rank matters most
      const recencyScore = t.rank7d < 50 ? (1 - t.rank7d / 50) : 0;

      const composite =
        Math.max(0, pnlScore) * weights.pnl +
        Math.max(0, consistencyScore) * weights.winRate +
        Math.max(0, volumeScore) * weights.volume +
        Math.max(0, recencyScore) * weights.recency;

      return {
        address: t.address,
        username: t.username,
        pnl: t.pnlAll,
        volume: t.volume,
        winRate: Math.max(0, Math.min(1, consistencyScore)), // approximation
        tradeCount: t.marketsTraded,
        compositeScore: Math.round(composite * 1000) / 1000,
        lastUpdated: Date.now(),
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, limit);

  return scored;
}

// ---- Activity Monitoring ----

export interface NewTradeDetection {
  traderAddress: string;
  traderUsername: string;
  traderScore: number;
  trades: TraderActivityItem[];
}

/**
 * Scan tracked traders for new activity since `sinceTimestamp`.
 * Returns only new TRADE actions (not splits/merges/redemptions).
 */
export async function scanTraderActivity(
  traders: TrackedTrader[],
  sinceTimestamp: number
): Promise<NewTradeDetection[]> {
  const results: NewTradeDetection[] = [];

  // Batch requests with a small delay to respect rate limits
  for (const trader of traders) {
    try {
      const activity = await fetchTraderActivity(trader.address, 30);

      // Filter to new trades only
      const newTrades = activity.filter((a) => {
        const activityTime = new Date(a.timestamp).getTime();
        return a.type === "TRADE" && activityTime > sinceTimestamp;
      });

      if (newTrades.length > 0) {
        results.push({
          traderAddress: trader.address,
          traderUsername: trader.username,
          traderScore: trader.compositeScore,
          trades: newTrades,
        });
      }

      // Small delay between traders to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.warn(`[copy-trader] Failed to fetch activity for ${trader.username}: ${err}`);
    }
  }

  return results;
}

// ---- Consensus Signal Generation ----

/**
 * Analyze new trades from multiple top traders and generate copy-trade signals.
 * Only generates signals when multiple traders are buying the same side of a market
 * (consensus-based approach outperforms single-trader copying).
 */
export async function generateCopySignals(
  detections: NewTradeDetection[],
  config: AgentConfig,
  existingPositionIds: string[]
): Promise<CopyTradeSignal[]> {
  // Group trades by conditionId + side
  const marketSideMap = new Map<
    string,
    {
      conditionId: string;
      question: string;
      tokenId: string;
      side: "buy_yes" | "buy_no";
      traders: Array<{
        address: string;
        username: string;
        score: number;
        size: number;
        price: number;
      }>;
    }
  >();

  for (const detection of detections) {
    for (const trade of detection.trades) {
      // Determine side from the trade
      const side: "buy_yes" | "buy_no" =
        trade.side === "BUY"
          ? trade.outcome?.toLowerCase() === "no"
            ? "buy_no"
            : "buy_yes"
          : trade.outcome?.toLowerCase() === "no"
            ? "buy_yes"
            : "buy_no";

      const key = `${trade.conditionId}:${side}`;

      if (!marketSideMap.has(key)) {
        marketSideMap.set(key, {
          conditionId: trade.conditionId,
          question: trade.title ?? trade.conditionId,
          tokenId: trade.asset,
          side,
          traders: [],
        });
      }

      marketSideMap.get(key)!.traders.push({
        address: detection.traderAddress,
        username: detection.traderUsername,
        score: detection.traderScore,
        size: parseFloat(trade.size),
        price: parseFloat(trade.price),
      });
    }
  }

  const signals: CopyTradeSignal[] = [];
  const totalTrackedTraders = detections.length || 1;

  for (const [, entry] of marketSideMap) {
    // Skip markets we already have a position in
    if (existingPositionIds.includes(entry.conditionId)) continue;

    // Calculate consensus
    const uniqueTraders = new Set(entry.traders.map((t) => t.address));
    const consensus = uniqueTraders.size / totalTrackedTraders;

    // Require at least 2 traders OR 1 trader with very high score
    const minTraders = entry.traders[0]?.score > 0.8 ? 1 : 2;
    if (uniqueTraders.size < minTraders) continue;

    // Calculate weighted average price
    const totalWeight = entry.traders.reduce((s, t) => s + t.score, 0);
    const weightedPrice =
      entry.traders.reduce((s, t) => s + t.price * t.score, 0) / (totalWeight || 1);

    // Calculate suggested size — proportional to consensus and trader quality
    const avgTraderScore =
      entry.traders.reduce((s, t) => s + t.score, 0) / entry.traders.length;
    const avgTraderSize =
      entry.traders.reduce((s, t) => s + t.size, 0) / entry.traders.length;

    // Scale: use a fraction of the average trader size, scaled by config
    const rawSize = Math.min(
      avgTraderSize * 0.1 * consensus * avgTraderScore, // proportional sizing
      config.maxTradeSize
    );
    const suggestedSize = Math.max(0.5, Math.round(rawSize * 100) / 100);

    const traderNames = entry.traders.map((t) => t.username).join(", ");
    const reasoning = `${uniqueTraders.size} top trader(s) (${traderNames}) buying ${entry.side} with ${(consensus * 100).toFixed(0)}% consensus. Avg trader score: ${avgTraderScore.toFixed(3)}.`;

    signals.push({
      traderAddress: entry.traders[0].address,
      traderUsername: entry.traders[0].username,
      traderScore: avgTraderScore,
      conditionId: entry.conditionId,
      question: entry.question,
      tokenId: entry.tokenId,
      side: entry.side,
      traderSize: avgTraderSize,
      suggestedSize,
      price: weightedPrice,
      consensus,
      reasoning,
    });
  }

  // Sort by consensus × avgScore (best signals first)
  signals.sort((a, b) => b.consensus * b.traderScore - a.consensus * a.traderScore);

  return signals;
}

// ---- LLM-Enhanced Signal Validation ----

/**
 * Use Grok to validate copy-trade signals before execution.
 * The LLM adds an intelligence layer on top of pure copy-trading.
 */
export function buildCopyTradeValidationPrompt(signals: CopyTradeSignal[]): string {
  const signalList = signals
    .map(
      (s, i) =>
        `${i + 1}. Market: "${s.question}"
   Side: ${s.side} at $${s.price.toFixed(3)}
   Traders: ${s.traderUsername} (score: ${s.traderScore.toFixed(3)})
   Consensus: ${(s.consensus * 100).toFixed(0)}%
   Suggested size: $${s.suggestedSize.toFixed(2)}
   Reasoning: ${s.reasoning}`
    )
    .join("\n\n");

  return `You are reviewing copy-trade signals from top Polymarket traders.

These traders have been identified as the most profitable on the platform based on PnL, win rate, volume, and consistency.

## Signals to Validate

${signalList}

For each signal, assess:
1. Does the market question make sense to trade right now?
2. Is the price reasonable given your knowledge of current events?
3. Are there any obvious red flags (market about to close, extreme pricing, etc.)?
4. Should we copy this trade?

Respond with JSON:
{
  "validations": [
    {
      "index": 1,
      "approved": true,
      "adjustedSize": 5.00,
      "confidence": 0.75,
      "reasoning": "..."
    }
  ]
}

Be conservative — only approve signals where the consensus is strong and the market makes sense. Reject anything that looks like noise or manipulation.`;
}
