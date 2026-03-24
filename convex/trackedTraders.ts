import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ---- Queries ----

export const listTraders = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("trackedTraders")
      .withIndex("by_compositeScore")
      .order("desc")
      .collect();
  },
});

export const enabledTraders = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("trackedTraders")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
  },
});

export const internalEnabledTraders = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("trackedTraders")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
  },
});

export const getTrader = query({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();
  },
});

// ---- Mutations ----

export const upsertTrader = mutation({
  args: {
    address: v.string(),
    username: v.string(),
    pnl: v.float64(),
    volume: v.float64(),
    winRate: v.float64(),
    tradeCount: v.float64(),
    compositeScore: v.float64(),
    source: v.union(v.literal("leaderboard"), v.literal("whale"), v.literal("manual")),
    enabled: v.boolean(),
    roi: v.optional(v.float64()),
    realWinRate: v.optional(v.float64()),
    consistency: v.optional(v.float64()),
    copyPnl: v.optional(v.float64()),
    copyTradeCount: v.optional(v.float64()),
    copyWinCount: v.optional(v.float64()),
    decayedScore: v.optional(v.float64()),
    avgHoldTime: v.optional(v.float64()),
    lastTradeAt: v.optional(v.float64()),
    disabledReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdated: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("trackedTraders", {
      ...args,
      lastUpdated: Date.now(),
    });
  },
});

export const internalUpsertTrader = internalMutation({
  args: {
    address: v.string(),
    username: v.string(),
    pnl: v.float64(),
    volume: v.float64(),
    winRate: v.float64(),
    tradeCount: v.float64(),
    compositeScore: v.float64(),
    source: v.union(v.literal("leaderboard"), v.literal("whale"), v.literal("manual")),
    enabled: v.boolean(),
    roi: v.optional(v.float64()),
    realWinRate: v.optional(v.float64()),
    consistency: v.optional(v.float64()),
    copyPnl: v.optional(v.float64()),
    copyTradeCount: v.optional(v.float64()),
    copyWinCount: v.optional(v.float64()),
    decayedScore: v.optional(v.float64()),
    avgHoldTime: v.optional(v.float64()),
    lastTradeAt: v.optional(v.float64()),
    disabledReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdated: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("trackedTraders", {
      ...args,
      lastUpdated: Date.now(),
    });
  },
});

export const toggleTrader = mutation({
  args: { address: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const trader = await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();
    if (trader) {
      await ctx.db.patch(trader._id, { enabled: args.enabled });
    }
  },
});

export const removeTrader = mutation({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const trader = await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();
    if (trader) {
      await ctx.db.delete(trader._id);
    }
  },
});

// ---- Copy Trade Signals ----

export const listSignals = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("copyTradeSignals")
        .withIndex("by_status", (q) => q.eq("status", args.status as any))
        .order("desc")
        .take(50);
    }
    return await ctx.db
      .query("copyTradeSignals")
      .withIndex("by_createdAt")
      .order("desc")
      .take(50);
  },
});

export const internalRecordSignal = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("copyTradeSignals", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const internalUpdateSignalStatus = internalMutation({
  args: {
    signalId: v.id("copyTradeSignals"),
    status: v.union(v.literal("pending"), v.literal("executed"), v.literal("skipped"), v.literal("expired")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signalId, {
      status: args.status,
      executedAt: args.status === "executed" ? Date.now() : undefined,
    });
  },
});

// ---- Trader Activity Log ----

export const internalLogTraderActivity = internalMutation({
  args: {
    traderAddress: v.string(),
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    size: v.float64(),
    price: v.float64(),
    copied: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("traderActivity", {
      ...args,
      detectedAt: Date.now(),
    });
  },
});

export const recentTraderActivity = query({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("traderActivity")
      .withIndex("by_detectedAt")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// ---- Trader Performance Attribution ----

export const internalRecordCopyResult = internalMutation({
  args: {
    traderAddress: v.string(),
    conditionId: v.string(),
    question: v.string(),
    side: v.union(v.literal("buy_yes"), v.literal("buy_no")),
    copySize: v.float64(),
    copyPrice: v.float64(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("traderPerformance", {
      ...args,
      status: "open",
      openedAt: Date.now(),
    });
  },
});

export const internalCloseCopyResult = internalMutation({
  args: {
    conditionId: v.string(),
    exitPrice: v.float64(),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("traderPerformance")
      .withIndex("by_conditionId", (q) => q.eq("conditionId", args.conditionId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect();

    for (const record of records) {
      const multiplier = record.side === "buy_yes" ? 1 : -1;
      const pnl = (args.exitPrice - record.copyPrice) * record.copySize * multiplier;

      await ctx.db.patch(record._id, {
        exitPrice: args.exitPrice,
        pnl,
        status: "closed",
        closedAt: Date.now(),
      });

      // Update the trader's aggregate copy P&L
      const trader = await ctx.db
        .query("trackedTraders")
        .withIndex("by_address", (q) => q.eq("address", record.traderAddress))
        .first();

      if (trader) {
        const newCopyPnl = (trader.copyPnl ?? 0) + pnl;
        const newCopyWinCount = (trader.copyWinCount ?? 0) + (pnl > 0 ? 1 : 0);
        await ctx.db.patch(trader._id, {
          copyPnl: newCopyPnl,
          copyWinCount: newCopyWinCount,
        });
      }
    }
  },
});

export const internalIncrementCopyCount = internalMutation({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const trader = await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();
    if (trader) {
      await ctx.db.patch(trader._id, {
        copyTradeCount: (trader.copyTradeCount ?? 0) + 1,
      });
    }
  },
});

export const getTraderPerformance = query({
  args: { traderAddress: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("traderPerformance")
      .withIndex("by_traderAddress", (q) => q.eq("traderAddress", args.traderAddress))
      .order("desc")
      .take(50);
  },
});

export const internalAutoDisableTrader = internalMutation({
  args: { address: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const trader = await ctx.db
      .query("trackedTraders")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();
    if (trader && trader.enabled) {
      await ctx.db.patch(trader._id, {
        enabled: false,
        disabledReason: args.reason,
      });
    }
  },
});

export const listTraderPerformance = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("traderPerformance")
      .withIndex("by_openedAt")
      .order("desc")
      .take(100);
  },
});
