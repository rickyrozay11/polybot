import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const openPosition = mutation({
  args: {
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("yes"), v.literal("no")),
    size: v.float64(),
    avgEntryPrice: v.float64(),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    openedAt: v.float64(),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("positions", {
      ...args,
      status: "open",
    });
  },
});

export const updatePositionPrice = mutation({
  args: {
    positionId: v.id("positions"),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
  },
  handler: async (ctx, args) => {
    const { positionId, ...fields } = args;
    await ctx.db.patch(positionId, fields);
  },
});

export const closePosition = mutation({
  args: {
    positionId: v.id("positions"),
    status: v.union(v.literal("closed"), v.literal("resolved")),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    closedAt: v.float64(),
  },
  handler: async (ctx, args) => {
    const { positionId, ...fields } = args;
    await ctx.db.patch(positionId, fields);
  },
});

export const listPositions = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("positions").order("desc").collect();
  },
});

export const openPositions = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
  },
});

export const getPositionByCondition = query({
  args: { conditionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_conditionId", (q) => q.eq("conditionId", args.conditionId))
      .first();
  },
});

// --- Internal versions for agentRun.ts ---

export const internalOpenPositions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
  },
});

export const internalGetPositionByCondition = internalQuery({
  args: { conditionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_conditionId", (q) => q.eq("conditionId", args.conditionId))
      .first();
  },
});

export const internalOpenPosition = internalMutation({
  args: {
    conditionId: v.string(),
    question: v.string(),
    tokenId: v.string(),
    side: v.union(v.literal("yes"), v.literal("no")),
    size: v.float64(),
    avgEntryPrice: v.float64(),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    openedAt: v.float64(),
    slug: v.optional(v.string()),
    takeProfitPrice: v.optional(v.float64()),
    stopLossPrice: v.optional(v.float64()),
    copiedFrom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("positions", {
      ...args,
      status: "open",
    });
  },
});

export const internalUpdatePositionPrice = internalMutation({
  args: {
    positionId: v.id("positions"),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
  },
  handler: async (ctx, args) => {
    const { positionId, ...fields } = args;
    await ctx.db.patch(positionId, fields);
  },
});

export const internalClosePosition = internalMutation({
  args: {
    positionId: v.id("positions"),
    status: v.union(v.literal("closed"), v.literal("resolved")),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    closedAt: v.float64(),
    exitReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { positionId, ...fields } = args;
    await ctx.db.patch(positionId, fields);
  },
});
