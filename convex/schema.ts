import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  trades: defineTable({
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    size: v.float64(),
    price: v.float64(),
    confidence: v.float64(),
    reasoning: v.string(),
    orderId: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("filled"),
      v.literal("rejected"),
      v.literal("error"),
      v.literal("dry_run")
    ),
    pnl: v.optional(v.float64()),
    exitPrice: v.optional(v.float64()),
    executedAt: v.float64(),
    resolvedAt: v.optional(v.float64()),
  })
    .index("by_status", ["status"])
    .index("by_conditionId", ["conditionId"])
    .index("by_executedAt", ["executedAt"]),

  positions: defineTable({
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("yes"), v.literal("no")),
    size: v.float64(),
    avgEntryPrice: v.float64(),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    status: v.union(v.literal("open"), v.literal("closed"), v.literal("resolved")),
    openedAt: v.float64(),
    closedAt: v.optional(v.float64()),
    slug: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_conditionId", ["conditionId"]),

  trackedTraders: defineTable({
    address: v.string(),
    username: v.string(),
    pnl: v.float64(),
    volume: v.float64(),
    winRate: v.float64(),
    tradeCount: v.float64(),
    compositeScore: v.float64(),
    lastUpdated: v.float64(),
    source: v.union(v.literal("leaderboard"), v.literal("whale"), v.literal("manual")),
    enabled: v.boolean(),
  })
    .index("by_address", ["address"])
    .index("by_compositeScore", ["compositeScore"])
    .index("by_enabled", ["enabled"]),

  traderActivity: defineTable({
    traderAddress: v.string(),
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    size: v.float64(),
    price: v.float64(),
    detectedAt: v.float64(),
    copied: v.boolean(),
    copyTradeId: v.optional(v.string()),
  })
    .index("by_traderAddress", ["traderAddress"])
    .index("by_conditionId", ["conditionId"])
    .index("by_detectedAt", ["detectedAt"])
    .index("by_copied", ["copied"]),

  copyTradeSignals: defineTable({
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    traderCount: v.float64(),
    consensus: v.float64(),
    avgTraderScore: v.float64(),
    suggestedSize: v.float64(),
    price: v.float64(),
    status: v.union(v.literal("pending"), v.literal("executed"), v.literal("skipped"), v.literal("expired")),
    reasoning: v.string(),
    createdAt: v.float64(),
    executedAt: v.optional(v.float64()),
  })
    .index("by_status", ["status"])
    .index("by_conditionId", ["conditionId"])
    .index("by_createdAt", ["createdAt"]),

  agentActions: defineTable({
    type: v.union(
      v.literal("scan"),
      v.literal("filter"),
      v.literal("screen"),
      v.literal("research"),
      v.literal("trade"),
      v.literal("position_refresh"),
      v.literal("copy_trade_scan"),
      v.literal("copy_trade_execute"),
      v.literal("whale_alert"),
      v.literal("convergence_signal"),
      v.literal("ensemble_vote"),
      v.literal("error")
    ),
    summary: v.string(),
    details: v.any(),
    timestamp: v.float64(),
    cycleId: v.optional(v.string()),
  })
    .index("by_type", ["type"])
    .index("by_timestamp", ["timestamp"])
    .index("by_cycleId", ["cycleId"]),

  markets: defineTable({
    conditionId: v.string(),
    question: v.string(),
    slug: v.string(),
    volume: v.float64(),
    liquidity: v.float64(),
    endDate: v.string(),
    confidenceScore: v.optional(v.float64()),
    sentiment: v.optional(
      v.union(v.literal("bullish"), v.literal("bearish"), v.literal("neutral"), v.literal("mixed"))
    ),
    lastChecked: v.float64(),
    yesPrice: v.optional(v.float64()),
    noPrice: v.optional(v.float64()),
    negRisk: v.boolean(),
  })
    .index("by_conditionId", ["conditionId"])
    .index("by_volume", ["volume"])
    .index("by_lastChecked", ["lastChecked"]),

  analytics: defineTable({
    period: v.union(v.literal("daily"), v.literal("weekly"), v.literal("all_time")),
    date: v.string(),
    totalPnl: v.float64(),
    totalTrades: v.float64(),
    winCount: v.float64(),
    lossCount: v.float64(),
    winRate: v.float64(),
    totalVolume: v.float64(),
    portfolioValue: v.float64(),
    cumulativeReturn: v.float64(),
  })
    .index("by_period_date", ["period", "date"]),

  config: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.float64(),
  }).index("by_key", ["key"]),

  wallet: defineTable({
    balance: v.float64(),
    initialBalance: v.float64(),
    totalInvested: v.float64(),
    realizedPnl: v.float64(),
    tradeCount: v.float64(),
    updatedAt: v.float64(),
  }),

  ensembleVotes: defineTable({
    cycleId: v.string(),
    conditionId: v.string(),
    question: v.string(),
    votes: v.array(v.object({
      modelId: v.string(),
      action: v.union(v.literal("buy_yes"), v.literal("buy_no"), v.literal("skip")),
      confidence: v.float64(),
      reasoning: v.string(),
      latencyMs: v.float64(),
    })),
    consensusAction: v.union(v.literal("buy_yes"), v.literal("buy_no"), v.literal("skip")),
    consensusConfidence: v.float64(),
    agreementLevel: v.union(v.literal("full"), v.literal("majority"), v.literal("weak"), v.literal("none")),
    modelWeights: v.optional(v.any()),
    createdAt: v.float64(),
  })
    .index("by_cycleId", ["cycleId"])
    .index("by_conditionId", ["conditionId"])
    .index("by_createdAt", ["createdAt"]),

  whaleAlerts: defineTable({
    traderAddress: v.string(),
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    size: v.float64(),
    price: v.float64(),
    totalValue: v.float64(),
    isInsider: v.boolean(),
    marketSlug: v.optional(v.string()),
    detectedAt: v.float64(),
    actedOn: v.boolean(),
    actionTaken: v.optional(v.string()),
  })
    .index("by_detectedAt", ["detectedAt"])
    .index("by_conditionId", ["conditionId"])
    .index("by_traderAddress", ["traderAddress"])
    .index("by_totalValue", ["totalValue"]),

  convergenceSignals: defineTable({
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    exchange: v.string(),
    symbol: v.string(),
    cexPrice: v.float64(),
    polymarketPrice: v.float64(),
    expectedPolyPrice: v.float64(),
    priceLagPercent: v.float64(),
    confidence: v.float64(),
    suggestedSize: v.float64(),
    reasoning: v.string(),
    status: v.union(v.literal("pending"), v.literal("executed"), v.literal("expired"), v.literal("skipped")),
    detectedAt: v.float64(),
    executedAt: v.optional(v.float64()),
  })
    .index("by_status", ["status"])
    .index("by_conditionId", ["conditionId"])
    .index("by_detectedAt", ["detectedAt"])
    .index("by_exchange", ["exchange"]),
});
