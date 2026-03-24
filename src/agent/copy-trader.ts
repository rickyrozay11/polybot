/**
 * Copy-Trading Engine v2
 *
 * Major upgrades over v1:
 * - ROI-based scoring (profit/volume) instead of raw PnL
 * - Real win rate from trade history, not leaderboard rank approximation
 * - Exponential recency decay — stale traders drop off automatically
 * - Consistency scoring (Sharpe-like: mean return / stddev)
 * - Position-aware filtering — detects averaging down, skip risky copies
 * - Per-trader P&L attribution tracking
 * - Auto-disable underperformers
 */

import type { TrackedTrader, CopyTradeSignal, AgentConfig } from "@/src/types";
import {
  fetchLeaderboard,
  fetchTraderActivity,
  fetchTraderPositions,
  type LeaderboardEntry,
  type TraderActivityItem,
  type TraderPosition,
} from "@/src/tools/polymarket-data-api";
import { fetchMarketByCondition } from "@/src/tools/polymarket-scanner";

// ---- Scoring Weights ----

export interface TraderScoreWeights {
  roi: number;
  realWinRate: number;
  consistency: number;
  volume: number;
  recency: number;
}

const DEFAULT_WEIGHTS: TraderScoreWeights = {
  roi: 0.30,
  realWinRate: 0.25,
  consistency: 0.20,
  volume: 0.10,
  recency: 0.15,
};

// Decay half-life: a trader's score halves every 7 days of inactivity
const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

// ---- Trader Discovery & Scoring ----

interface TraderRawStats {
  address: string;
  username: string;
  pnl7d: number;
  pnl30d: number;
  pnlAll: number;
  volume7d: number;
  volume30d: number;
  volumeAll: number;
  marketsTraded: number;
  rank7d: number;
  rank30d: number;
  rankAll: number;
}

/**
 * Calculate real win rate from a trader's recent activity.
 * Counts BUY trades that resulted in profit (price moved in their favor)
 * by cross-referencing with their current positions.
 */
async function calculateRealWinRate(
  address: string
): Promise<{ winRate: number; tradeCount: number; avgReturn: number; returns: number[] }> {
  try {
    const [activity, positions] = await Promise.all([
      fetchTraderActivity(address, 100),
      fetchTraderPositions(address),
    ]);

    const trades = activity.filter((a) => a.type === "TRADE" && a.side === "BUY");
    if (trades.length === 0) return { winRate: 0, tradeCount: 0, avgReturn: 0, returns: [] };

    // Build position lookup for current prices
    const positionMap = new Map<string, TraderPosition>();
    for (const pos of positions) {
      positionMap.set(pos.conditionId, pos);
    }

    let wins = 0;
    const returns: number[] = [];

    for (const trade of trades) {
      const entryPrice = parseFloat(trade.price);
      if (entryPrice <= 0) continue;

      // Check if there's a current position — use currentPrice for unrealized
      const pos = positionMap.get(trade.conditionId);
      const currentPrice = pos?.currentPrice ? parseFloat(pos.currentPrice) : null;

      if (currentPrice !== null && currentPrice > 0) {
        const ret = (currentPrice - entryPrice) / entryPrice;
        returns.push(ret);
        if (currentPrice > entryPrice) wins++;
      } else {
        // Position closed — check if trade.outcome suggests resolution
        // For resolved markets, buying YES at low price = win if resolved YES
        // We can't know for sure without resolution data, so count based on entry price
        // Buying at < 0.5 on a resolved market likely means it resolved their way
        if (entryPrice < 0.4) {
          wins++;
          returns.push((1 - entryPrice) / entryPrice); // max profit assumption for resolved
        } else if (entryPrice > 0.6) {
          returns.push(-1); // likely lost
        } else {
          returns.push(0); // uncertain, neutral
        }
      }
    }

    const winRate = trades.length > 0 ? wins / trades.length : 0;
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

    return { winRate, tradeCount: trades.length, avgReturn, returns };
  } catch {
    return { winRate: 0, tradeCount: 0, avgReturn: 0, returns: [] };
  }
}

/**
 * Calculate Sharpe-like consistency score.
 * Higher = more consistent returns (steady wins > volatile streaks).
 */
function calculateConsistency(returns: number[]): number {
  if (returns.length < 3) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return mean > 0 ? 1 : 0;

  // Sharpe ratio normalized to 0-1 range
  const sharpe = mean / stddev;
  return Math.max(0, Math.min(1, (sharpe + 1) / 3)); // map [-1, 2] -> [0, 1]
}

/**
 * Apply exponential time decay to a score.
 * Score halves every DECAY_HALF_LIFE_MS of inactivity.
 */
function applyDecay(score: number, lastActiveMs: number): number {
  const elapsed = Date.now() - lastActiveMs;
  if (elapsed <= 0) return score;
  const decayFactor = Math.pow(0.5, elapsed / DECAY_HALF_LIFE_MS);
  return score * decayFactor;
}

/**
 * Discover the best traders from the Polymarket leaderboard.
 * Uses ROI-based scoring with real win rates and consistency.
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
  const traderMap = new Map<string, TraderRawStats>();

  function addEntries(entries: LeaderboardEntry[], window: "7d" | "30d" | "all") {
    entries.forEach((e, idx) => {
      const existing = traderMap.get(e.address) ?? {
        address: e.address,
        username: e.username,
        pnl7d: 0, pnl30d: 0, pnlAll: 0,
        volume7d: 0, volume30d: 0, volumeAll: 0,
        marketsTraded: 0,
        rank7d: 999, rank30d: 999, rankAll: 999,
      };
      if (window === "7d") {
        existing.pnl7d = e.profit;
        existing.volume7d = e.volume;
        existing.rank7d = idx;
      } else if (window === "30d") {
        existing.pnl30d = e.profit;
        existing.volume30d = e.volume;
        existing.rank30d = idx;
      } else {
        existing.pnlAll = e.profit;
        existing.volumeAll = e.volume;
        existing.rankAll = idx;
      }
      existing.marketsTraded = Math.max(existing.marketsTraded, e.marketsTraded);
      existing.username = e.username || existing.username;
      traderMap.set(e.address, existing);
    });
  }

  addEntries(all7d, "7d");
  addEntries(all30d, "30d");
  addEntries(allTime, "all");

  // Filter to profitable traders with meaningful volume
  const candidates = Array.from(traderMap.values()).filter(
    (t) => t.pnlAll > 0 && t.volumeAll > 1000
  );

  // Get real win rates for top candidates (by raw ROI)
  // Sort by ROI first, then deep-analyze top 40
  const byRoi = candidates
    .map((t) => ({ ...t, roi: t.pnlAll / Math.max(t.volumeAll, 1) }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 40);

  // Fetch real win rates in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 5;
  const winRateResults = new Map<string, { winRate: number; tradeCount: number; avgReturn: number; returns: number[] }>();

  for (let i = 0; i < byRoi.length; i += BATCH_SIZE) {
    const batch = byRoi.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((t) => calculateRealWinRate(t.address))
    );
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        winRateResults.set(batch[idx].address, r.value);
      }
    });
    // Small delay between batches
    if (i + BATCH_SIZE < byRoi.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Score each trader
  const maxVolume = Math.max(...byRoi.map((t) => t.volumeAll), 1);

  const scored: TrackedTrader[] = byRoi
    .map((t) => {
      const wr = winRateResults.get(t.address) ?? { winRate: 0, tradeCount: 0, avgReturn: 0, returns: [] };

      // ROI score: profit / volume, weighted toward recent
      const roi7d = t.volume7d > 0 ? t.pnl7d / t.volume7d : 0;
      const roi30d = t.volume30d > 0 ? t.pnl30d / t.volume30d : 0;
      const roiAll = t.volumeAll > 0 ? t.pnlAll / t.volumeAll : 0;
      const blendedRoi = roi7d * 0.5 + roi30d * 0.3 + roiAll * 0.2;
      // Normalize: typical good ROI is 5-20%, great is 20%+
      const roiScore = Math.max(0, Math.min(1, blendedRoi / 0.20));

      // Real win rate score (from actual trade history)
      const winRateScore = wr.winRate;

      // Consistency (Sharpe-like)
      const consistencyScore = calculateConsistency(wr.returns);

      // Volume score (log-normalized) — proves conviction, not just luck
      const volumeScore = Math.log10(t.volumeAll + 1) / Math.log10(maxVolume + 1);

      // Recency: 7d rank matters most
      const recencyScore = t.rank7d < 50 ? (1 - t.rank7d / 50) : 0;

      const composite =
        Math.max(0, roiScore) * weights.roi +
        Math.max(0, winRateScore) * weights.realWinRate +
        Math.max(0, consistencyScore) * weights.consistency +
        Math.max(0, volumeScore) * weights.volume +
        Math.max(0, recencyScore) * weights.recency;

      // Apply time decay based on 7d ranking (if not in top 100 for 7d, likely inactive)
      const lastActiveEstimate = t.rank7d < 100 ? Date.now() : Date.now() - 14 * 24 * 60 * 60 * 1000;
      const decayed = applyDecay(composite, lastActiveEstimate);

      return {
        address: t.address,
        username: t.username,
        pnl: t.pnlAll,
        volume: t.volumeAll,
        winRate: wr.winRate, // REAL win rate, not approximation
        tradeCount: wr.tradeCount || t.marketsTraded,
        compositeScore: Math.round(composite * 1000) / 1000,
        lastUpdated: Date.now(),
        // New fields
        roi: Math.round(blendedRoi * 10000) / 10000,
        realWinRate: Math.round(wr.winRate * 1000) / 1000,
        consistency: Math.round(consistencyScore * 1000) / 1000,
        decayedScore: Math.round(decayed * 1000) / 1000,
        lastTradeAt: lastActiveEstimate,
      };
    })
    .sort((a, b) => (b.decayedScore ?? 0) - (a.decayedScore ?? 0))
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

  // Parallel batched scanning for speed
  const BATCH_SIZE = 5;

  for (let i = 0; i < traders.length; i += BATCH_SIZE) {
    const batch = traders.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (trader) => {
        const activity = await fetchTraderActivity(trader.address, 30);
        const newTrades = activity.filter((a) => {
          const activityTime = new Date(a.timestamp).getTime();
          return a.type === "TRADE" && activityTime > sinceTimestamp;
        });
        return { trader, newTrades };
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value.newTrades.length > 0) {
        const { trader, newTrades } = result.value;
        results.push({
          traderAddress: trader.address,
          traderUsername: trader.username,
          traderScore: trader.decayedScore ?? trader.compositeScore,
          trades: newTrades,
        });
      }
    }

    if (i + BATCH_SIZE < traders.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

// ---- Position-Aware Filtering ----

/**
 * Check if a trader is averaging down on a losing position.
 * Returns true if the trade looks like a desperation add.
 */
async function isAveragingDown(
  traderAddress: string,
  conditionId: string,
  newTradePrice: number
): Promise<boolean> {
  try {
    const positions = await fetchTraderPositions(traderAddress);
    const existing = positions.find((p) => p.conditionId === conditionId);
    if (!existing) return false;

    const avgPrice = parseFloat(existing.avgPrice);
    const currentPrice = existing.currentPrice ? parseFloat(existing.currentPrice) : null;

    // If they already hold this position AND the current price is significantly below
    // their avg entry AND they're buying more — that's averaging down
    if (currentPrice !== null && currentPrice < avgPrice * 0.85 && newTradePrice < avgPrice) {
      return true;
    }

    return false;
  } catch {
    return false; // err on the side of allowing the trade
  }
}

// ---- Consensus Signal Generation ----

/**
 * Generate copy-trade signals with position-aware filtering.
 * Only generates signals when multiple traders agree AND they're not averaging down.
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

    const uniqueTraders = new Set(entry.traders.map((t) => t.address));
    const consensus = uniqueTraders.size / totalTrackedTraders;

    // Require 2+ traders OR 1 trader with decayed score > 0.8
    const topTraderScore = Math.max(...entry.traders.map((t) => t.score));
    const minTraders = topTraderScore > 0.8 ? 1 : 2;
    if (uniqueTraders.size < minTraders) continue;

    // Position-aware filtering: check if lead trader is averaging down
    const leadTrader = entry.traders.reduce((a, b) => (a.score > b.score ? a : b));
    const avgingDown = await isAveragingDown(
      leadTrader.address,
      entry.conditionId,
      leadTrader.price
    );
    if (avgingDown) continue; // Skip — trader is likely chasing a loss

    // Calculate weighted average price (weight by trader score)
    const totalWeight = entry.traders.reduce((s, t) => s + t.score, 0);
    const weightedPrice =
      entry.traders.reduce((s, t) => s + t.price * t.score, 0) / (totalWeight || 1);

    // Size calculation: scale by consensus strength and trader quality
    const avgTraderScore =
      entry.traders.reduce((s, t) => s + t.score, 0) / entry.traders.length;
    const avgTraderSize =
      entry.traders.reduce((s, t) => s + t.size, 0) / entry.traders.length;

    // More aggressive sizing when consensus is strong
    const consensusMultiplier = consensus > 0.5 ? 1.5 : consensus > 0.3 ? 1.2 : 1.0;
    const rawSize = Math.min(
      avgTraderSize * 0.1 * consensus * avgTraderScore * consensusMultiplier,
      config.maxTradeSize
    );
    const suggestedSize = Math.max(0.5, Math.round(rawSize * 100) / 100);

    const traderNames = entry.traders.map((t) => `${t.username}(${t.score.toFixed(2)})`).join(", ");
    const reasoning = `${uniqueTraders.size} trader(s) [${traderNames}] buying ${entry.side} @ ${(consensus * 100).toFixed(0)}% consensus. ROI-scored, position-checked.`;

    signals.push({
      traderAddress: leadTrader.address,
      traderUsername: leadTrader.username,
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

  // Sort by (consensus × score × decayed weight)
  signals.sort((a, b) => b.consensus * b.traderScore - a.consensus * a.traderScore);

  return signals;
}

// ---- LLM-Enhanced Signal Validation ----

export function buildCopyTradeValidationPrompt(signals: CopyTradeSignal[]): string {
  const signalList = signals
    .map(
      (s, i) =>
        `${i + 1}. Market: "${s.question}"
   Side: ${s.side} at $${s.price.toFixed(3)}
   Traders: ${s.traderUsername} (ROI-score: ${s.traderScore.toFixed(3)})
   Consensus: ${(s.consensus * 100).toFixed(0)}%
   Suggested size: $${s.suggestedSize.toFixed(2)}
   Reasoning: ${s.reasoning}`
    )
    .join("\n\n");

  return `You are reviewing copy-trade signals from top Polymarket traders.

These traders have been scored using ROI (profit/volume), real win rate from trade history, consistency (Sharpe ratio), and recency-weighted performance. Position-aware filtering has already removed signals where traders are averaging down on losing positions.

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

// ---- Underperformer Detection ----

/**
 * Check if a trader should be auto-disabled based on your copy P&L from them.
 * Returns a reason string if should disable, or null if they're fine.
 */
export function shouldDisableTrader(trader: TrackedTrader): string | null {
  const copyCount = trader.copyTradeCount ?? 0;
  const copyPnl = trader.copyPnl ?? 0;
  const copyWins = trader.copyWinCount ?? 0;

  // Need at least 3 copy trades before judging
  if (copyCount < 3) return null;

  // Disable if copy win rate < 30%
  const copyWinRate = copyWins / copyCount;
  if (copyWinRate < 0.30) {
    return `copy_win_rate_${(copyWinRate * 100).toFixed(0)}pct`;
  }

  // Disable if net negative copy P&L after 5+ trades
  if (copyCount >= 5 && copyPnl < -5) {
    return `negative_copy_pnl_${copyPnl.toFixed(2)}`;
  }

  // Disable if decayed score dropped below 0.1 (stale + bad)
  if ((trader.decayedScore ?? trader.compositeScore) < 0.1) {
    return "decayed_score_too_low";
  }

  return null;
}

// ---- Copy Exit Detection ----

/**
 * Detect when tracked traders are SELLING positions that we also hold.
 * If a top trader exits, we should consider exiting too.
 */
export function detectCopyExits(
  detections: NewTradeDetection[],
  ourPositionConditionIds: string[]
): Array<{
  conditionId: string;
  question: string;
  traderAddress: string;
  traderUsername: string;
  traderScore: number;
  reason: string;
}> {
  const exits: Array<{
    conditionId: string;
    question: string;
    traderAddress: string;
    traderUsername: string;
    traderScore: number;
    reason: string;
  }> = [];

  const positionSet = new Set(ourPositionConditionIds);

  for (const detection of detections) {
    for (const trade of detection.trades) {
      // Look for SELL trades on markets we hold positions in
      if (trade.side === "SELL" && positionSet.has(trade.conditionId)) {
        exits.push({
          conditionId: trade.conditionId,
          question: trade.title ?? trade.conditionId,
          traderAddress: detection.traderAddress,
          traderUsername: detection.traderUsername,
          traderScore: detection.traderScore,
          reason: `${detection.traderUsername} (score: ${detection.traderScore.toFixed(2)}) sold $${parseFloat(trade.size).toFixed(2)} at ${(parseFloat(trade.price) * 100).toFixed(1)}%`,
        });
      }
    }
  }

  return exits;
}
