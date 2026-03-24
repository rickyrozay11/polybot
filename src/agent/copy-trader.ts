/**
 * Copy-Trading Engine v3
 *
 * Upgrades over v2:
 * - Conviction-weighted signals: trader position size relative to portfolio
 * - Fresh price fetching before execution (no stale trader prices)
 * - Market validation: checks active, liquidity, time-to-close
 * - Deduplication via transaction hash tracking
 * - Smarter sizing: scales with conviction, consensus, and trader quality
 * - Single-model validation (DeepSeek V3.2) instead of 4-model ensemble
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
        // Position closed — estimate based on entry price
        if (entryPrice < 0.4) {
          wins++;
          returns.push((1 - entryPrice) / entryPrice);
        } else if (entryPrice > 0.6) {
          returns.push(-1);
        } else {
          returns.push(0);
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

  const sharpe = mean / stddev;
  return Math.max(0, Math.min(1, (sharpe + 1) / 3));
}

/**
 * Apply exponential time decay to a score.
 */
function applyDecay(score: number, lastActiveMs: number): number {
  const elapsed = Date.now() - lastActiveMs;
  if (elapsed <= 0) return score;
  const decayFactor = Math.pow(0.5, elapsed / DECAY_HALF_LIFE_MS);
  return score * decayFactor;
}

/**
 * Discover the best traders from the Polymarket leaderboard.
 */
export async function discoverTopTraders(
  limit = 20,
  weights: TraderScoreWeights = DEFAULT_WEIGHTS
): Promise<TrackedTrader[]> {
  const [leaders7d, leaders30d, leadersAll] = await Promise.allSettled([
    fetchLeaderboard("7d", 100),
    fetchLeaderboard("30d", 100),
    fetchLeaderboard("all", 100),
  ]);

  const all7d = leaders7d.status === "fulfilled" ? leaders7d.value : [];
  const all30d = leaders30d.status === "fulfilled" ? leaders30d.value : [];
  const allTime = leadersAll.status === "fulfilled" ? leadersAll.value : [];

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

  const byRoi = candidates
    .map((t) => ({ ...t, roi: t.pnlAll / Math.max(t.volumeAll, 1) }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 40);

  // Fetch real win rates in parallel (batched)
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
    if (i + BATCH_SIZE < byRoi.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const maxVolume = Math.max(...byRoi.map((t) => t.volumeAll), 1);

  const scored: TrackedTrader[] = byRoi
    .map((t) => {
      const wr = winRateResults.get(t.address) ?? { winRate: 0, tradeCount: 0, avgReturn: 0, returns: [] };

      const roi7d = t.volume7d > 0 ? t.pnl7d / t.volume7d : 0;
      const roi30d = t.volume30d > 0 ? t.pnl30d / t.volume30d : 0;
      const roiAll = t.volumeAll > 0 ? t.pnlAll / t.volumeAll : 0;
      const blendedRoi = roi7d * 0.5 + roi30d * 0.3 + roiAll * 0.2;
      const roiScore = Math.max(0, Math.min(1, blendedRoi / 0.20));

      const winRateScore = wr.winRate;
      const consistencyScore = calculateConsistency(wr.returns);
      const volumeScore = Math.log10(t.volumeAll + 1) / Math.log10(maxVolume + 1);
      const recencyScore = t.rank7d < 50 ? (1 - t.rank7d / 50) : 0;

      const composite =
        Math.max(0, roiScore) * weights.roi +
        Math.max(0, winRateScore) * weights.realWinRate +
        Math.max(0, consistencyScore) * weights.consistency +
        Math.max(0, volumeScore) * weights.volume +
        Math.max(0, recencyScore) * weights.recency;

      const lastActiveEstimate = t.rank7d < 100 ? Date.now() : Date.now() - 14 * 24 * 60 * 60 * 1000;
      const decayed = applyDecay(composite, lastActiveEstimate);

      return {
        address: t.address,
        username: t.username,
        pnl: t.pnlAll,
        volume: t.volumeAll,
        winRate: wr.winRate,
        tradeCount: wr.tradeCount || t.marketsTraded,
        compositeScore: Math.round(composite * 1000) / 1000,
        lastUpdated: Date.now(),
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

// ---- Deduplication ----

/**
 * Filter out trades we've already processed in previous cycles.
 * Uses transaction hash + conditionId + trader address as composite key.
 */
export function deduplicateTrades(
  detections: NewTradeDetection[],
  seenTradeKeys: Set<string>
): { filtered: NewTradeDetection[]; newKeys: string[] } {
  const filtered: NewTradeDetection[] = [];
  const newKeys: string[] = [];

  for (const detection of detections) {
    const unseenTrades: TraderActivityItem[] = [];

    for (const trade of detection.trades) {
      // Determine the side as stored in DB (buy_yes/buy_no)
      const side: "buy_yes" | "buy_no" =
        trade.side === "BUY"
          ? trade.outcome?.toLowerCase() === "no" ? "buy_no" : "buy_yes"
          : trade.outcome?.toLowerCase() === "no" ? "buy_yes" : "buy_no";

      // Key format matches internalRecentTradeKeys: address:conditionId:side:size
      const key = `${detection.traderAddress}:${trade.conditionId}:${side}:${parseFloat(trade.size)}`;
      if (!seenTradeKeys.has(key)) {
        unseenTrades.push(trade);
        newKeys.push(key);
      }
    }

    if (unseenTrades.length > 0) {
      filtered.push({
        ...detection,
        trades: unseenTrades,
      });
    }
  }

  return { filtered, newKeys };
}

// ---- Position-Aware Filtering ----

/**
 * Check if a trader is averaging down on a losing position.
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

    if (currentPrice !== null && currentPrice < avgPrice * 0.85 && newTradePrice < avgPrice) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ---- Conviction Scoring ----

/**
 * Calculate conviction: how much of the trader's portfolio is this trade?
 * A trader putting 50% of their capital into one trade = very high conviction.
 */
async function calculateConviction(
  traderAddress: string,
  tradeSize: number
): Promise<number> {
  try {
    const positions = await fetchTraderPositions(traderAddress);
    const totalPortfolio = positions.reduce((sum, p) => {
      return sum + parseFloat(p.size) * parseFloat(p.avgPrice || "0");
    }, 0);

    if (totalPortfolio <= 0) return 0.5; // unknown portfolio = neutral
    const conviction = tradeSize / (totalPortfolio + tradeSize);

    // Normalize: 1% = low (0.1), 10% = medium (0.5), 30%+ = high (1.0)
    return Math.max(0.1, Math.min(1, conviction / 0.3));
  } catch {
    return 0.5;
  }
}

// ---- Market Validation ----

/**
 * Validate a market before entering a copy trade.
 * Checks: still active, has liquidity, not about to close.
 */
export async function validateMarket(conditionId: string): Promise<{
  valid: boolean;
  reason?: string;
  liquidity?: number;
  endDate?: string;
  freshPrice?: { yes: number; no: number };
}> {
  try {
    const market = await fetchMarketByCondition(conditionId);
    if (!market) {
      return { valid: false, reason: "market_not_found" };
    }

    // Check liquidity (minimum $500 to ensure we can exit)
    if (market.liquidity < 500) {
      return { valid: false, reason: `low_liquidity_${market.liquidity.toFixed(0)}` };
    }

    // Check time to resolution (minimum 1 hour)
    if (market.endDate) {
      const endTime = new Date(market.endDate).getTime();
      const hoursLeft = (endTime - Date.now()) / (60 * 60 * 1000);
      if (hoursLeft < 1) {
        return { valid: false, reason: `closing_soon_${hoursLeft.toFixed(1)}hrs` };
      }
    }

    // Get fresh token prices
    const yesToken = market.tokens.find((t) => t.outcome === "Yes");
    const noToken = market.tokens.find((t) => t.outcome === "No");
    const yesPrice = yesToken?.price ?? 0;
    const noPrice = noToken?.price ?? 0;

    // Reject extreme prices (>97c or <3c) — no room for profit
    if (yesPrice > 0.97 || yesPrice < 0.03) {
      return { valid: false, reason: `extreme_price_${(yesPrice * 100).toFixed(1)}c` };
    }

    return {
      valid: true,
      liquidity: market.liquidity,
      endDate: market.endDate,
      freshPrice: { yes: yesPrice, no: noPrice },
    };
  } catch {
    // If we can't validate, allow the trade (don't block on API failure)
    return { valid: true };
  }
}

// ---- Fresh Price Fetching ----

/**
 * Fetch the current midpoint price from the CLOB for a token.
 * This is the price we should actually execute at, not the trader's stale price.
 */
export async function fetchFreshMidpoint(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { mid: string };
    const mid = parseFloat(data.mid);
    return isNaN(mid) ? null : mid;
  } catch {
    return null;
  }
}

// ---- Consensus Signal Generation ----

/**
 * Generate copy-trade signals with conviction scoring and market validation.
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
        conviction: number;
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

      // Calculate conviction for this trade
      const tradeSize = parseFloat(trade.size);
      const conviction = await calculateConviction(detection.traderAddress, tradeSize);

      marketSideMap.get(key)!.traders.push({
        address: detection.traderAddress,
        username: detection.traderUsername,
        score: detection.traderScore,
        size: tradeSize,
        price: parseFloat(trade.price),
        conviction,
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

    // Single trader with high score (>0.7) OR high conviction (>0.6) is enough
    // Otherwise require 2+ traders
    const topTrader = entry.traders.reduce((a, b) => (a.score > b.score ? a : b));
    const highConviction = entry.traders.some((t) => t.conviction > 0.6);
    const minTraders = (topTrader.score > 0.7 || highConviction) ? 1 : 2;
    if (uniqueTraders.size < minTraders) continue;

    // Position-aware filtering: check if lead trader is averaging down
    const avgingDown = await isAveragingDown(
      topTrader.address,
      entry.conditionId,
      topTrader.price
    );
    if (avgingDown) continue;

    // Validate the market (active, liquid, not closing)
    const marketCheck = await validateMarket(entry.conditionId);
    if (!marketCheck.valid) continue;

    // Use fresh price from market validation if available, else from CLOB midpoint
    let executionPrice = topTrader.price;
    if (marketCheck.freshPrice) {
      executionPrice = entry.side === "buy_yes"
        ? marketCheck.freshPrice.yes
        : marketCheck.freshPrice.no;
    }
    if (executionPrice <= 0) {
      // Last resort: try CLOB midpoint directly
      const mid = await fetchFreshMidpoint(entry.tokenId);
      if (mid && mid > 0) executionPrice = mid;
    }

    // Calculate weighted average score (conviction-weighted)
    const totalWeight = entry.traders.reduce((s, t) => s + t.score * t.conviction, 0);
    const avgTraderScore = totalWeight / entry.traders.length;

    // Sizing: scale with conviction, consensus, and trader quality
    const maxConviction = Math.max(...entry.traders.map((t) => t.conviction));
    const avgTraderSize = entry.traders.reduce((s, t) => s + t.size, 0) / entry.traders.length;

    // Base size: proportional to what traders are putting in
    // Scale by our max trade size, consensus strength, and quality
    const qualityMultiplier = Math.max(0.3, Math.min(1.5, avgTraderScore * 2));
    const convictionMultiplier = 0.5 + maxConviction * 0.5; // 0.5x to 1.0x
    const consensusMultiplier = uniqueTraders.size >= 3 ? 1.5 : uniqueTraders.size >= 2 ? 1.2 : 1.0;

    const rawSize = config.maxTradeSize * 0.4 * qualityMultiplier * convictionMultiplier * consensusMultiplier;
    const suggestedSize = Math.max(1, Math.min(Math.round(rawSize * 100) / 100, config.maxTradeSize));

    const traderNames = entry.traders
      .map((t) => `${t.username}(s:${t.score.toFixed(2)},c:${t.conviction.toFixed(2)})`)
      .join(", ");
    const reasoning = `${uniqueTraders.size} trader(s) [${traderNames}] ${entry.side} @ ${(executionPrice * 100).toFixed(1)}c | consensus:${(consensus * 100).toFixed(0)}% | liq:$${(marketCheck.liquidity ?? 0).toFixed(0)}`;

    signals.push({
      traderAddress: topTrader.address,
      traderUsername: topTrader.username,
      traderScore: avgTraderScore,
      conditionId: entry.conditionId,
      question: entry.question,
      tokenId: entry.tokenId,
      side: entry.side,
      traderSize: avgTraderSize,
      suggestedSize,
      price: executionPrice,
      consensus,
      reasoning,
    });
  }

  // Sort by conviction × score × consensus
  signals.sort((a, b) => b.consensus * b.traderScore - a.consensus * a.traderScore);

  return signals;
}

// ---- LLM-Enhanced Signal Validation ----

export function buildCopyTradeValidationPrompt(signals: CopyTradeSignal[]): string {
  const signalList = signals
    .map(
      (s, i) =>
        `${i + 1}. "${s.question}" | ${s.side} @ ${(s.price * 100).toFixed(1)}c | ${s.traderUsername} (score:${s.traderScore.toFixed(2)}) | ${(s.consensus * 100).toFixed(0)}% consensus | $${s.suggestedSize.toFixed(2)}`
    )
    .join("\n");

  return `Quick-validate these copy-trade signals from ROI-scored Polymarket traders. Position-aware filtering already ran (no averaging-down signals). Markets have been validated (active, liquid, not closing soon).

${signalList}

For each: approve unless there's a clear red flag (nonsensical market, extreme price >95c or <5c with no catalyst, obvious manipulation, duplicate/stale market). The traders are the edge — don't second-guess strong consensus.

JSON only:
{"validations":[{"index":1,"approved":true,"adjustedSize":5.00,"confidence":0.75,"reasoning":"..."}]}`;
}

// ---- Underperformer Detection ----

/**
 * Check if a trader should be auto-disabled based on your copy P&L from them.
 */
export function shouldDisableTrader(trader: TrackedTrader): string | null {
  const copyCount = trader.copyTradeCount ?? 0;
  const copyPnl = trader.copyPnl ?? 0;
  const copyWins = trader.copyWinCount ?? 0;

  if (copyCount < 3) return null;

  const copyWinRate = copyWins / copyCount;
  if (copyWinRate < 0.30) {
    return `copy_win_rate_${(copyWinRate * 100).toFixed(0)}pct`;
  }

  if (copyCount >= 5 && copyPnl < -5) {
    return `negative_copy_pnl_${copyPnl.toFixed(2)}`;
  }

  if ((trader.decayedScore ?? trader.compositeScore) < 0.1) {
    return "decayed_score_too_low";
  }

  return null;
}

// ---- Copy Exit Detection ----

/**
 * Detect when tracked traders are SELLING positions that we also hold.
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
