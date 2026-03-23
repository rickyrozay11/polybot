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
