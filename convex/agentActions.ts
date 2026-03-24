import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const logActionArgs = {
  type: v.union(
    v.literal("scan"),
    v.literal("filter"),
    v.literal("screen"),
    v.literal("research"),
    v.literal("trade"),
    v.literal("position_refresh"),
    v.literal("copy_trade_scan"),
    v.literal("copy_trade_execute"),
    v.literal("copy_exit"),
    v.literal("auto_exit"),
    v.literal("whale_alert"),
    v.literal("convergence_signal"),
    v.literal("ensemble_vote"),
    v.literal("error")
  ),
  summary: v.string(),
  details: v.any(),
  timestamp: v.float64(),
  cycleId: v.optional(v.string()),
};

export const logAction = mutation({
  args: logActionArgs,
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentActions", args);
  },
});

export const internalLogAction = internalMutation({
  args: logActionArgs,
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentActions", args);
  },
});

export const listActions = query({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const q = ctx.db.query("agentActions").order("desc");
    if (args.limit) {
      return await q.take(args.limit);
    }
    return await q.collect();
  },
});

export const recentActions = query({
  args: { limit: v.float64() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentActions")
      .order("desc")
      .take(args.limit);
  },
});

export const actionsByCycle = query({
  args: { cycleId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentActions")
      .withIndex("by_cycleId", (q) => q.eq("cycleId", args.cycleId))
      .order("desc")
      .collect();
  },
});

export const listCycles = query({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("agentActions").order("desc").collect();
    const cycleMap = new Map<
      string,
      {
        cycleId: string;
        startedAt: number;
        endedAt: number;
        stages: Array<{ type: string; summary: string; timestamp: number; details: any }>;
        tradeCount: number;
        hasError: boolean;
      }
    >();

    for (const action of all) {
      const cid = action.cycleId ?? "unknown";
      let cycle = cycleMap.get(cid);
      if (!cycle) {
        cycle = {
          cycleId: cid,
          startedAt: action.timestamp,
          endedAt: action.timestamp,
          stages: [],
          tradeCount: 0,
          hasError: false,
        };
        cycleMap.set(cid, cycle);
      }
      cycle.stages.push({
        type: action.type,
        summary: action.summary,
        timestamp: action.timestamp,
        details: action.details,
      });
      if (action.timestamp < cycle.startedAt) cycle.startedAt = action.timestamp;
      if (action.timestamp > cycle.endedAt) cycle.endedAt = action.timestamp;
      if (action.type === "trade") {
        const d = action.details as any;
        const isSkip = d?.decision?.action === "skip";
        if (!isSkip) cycle.tradeCount++;
      }
      if (action.type === "error") cycle.hasError = true;
    }

    const cycles = Array.from(cycleMap.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );

    return args.limit ? cycles.slice(0, args.limit) : cycles;
  },
});

export const cycleStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("agentActions").collect();
    const cycleIds = new Set<string>();
    let totalTrades = 0;
    let totalSkips = 0;
    let totalErrors = 0;

    for (const action of all) {
      if (action.cycleId) cycleIds.add(action.cycleId);
      if (action.type === "trade") {
        const d = action.details as any;
        if (d?.decision?.action === "skip") {
          totalSkips++;
        } else {
          totalTrades++;
        }
      }
      if (action.type === "error") totalErrors++;
    }

    return {
      totalCycles: cycleIds.size,
      totalTrades,
      totalSkips,
      totalErrors,
    };
  },
});

// --- Internal mutations for writing to new tables ---

export const internalRecordEnsembleVote = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ensembleVotes", args);
  },
});

export const internalRecordWhaleAlert = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("whaleAlerts", args);
  },
});

export const internalRecordConvergenceSignal = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("convergenceSignals", args);
  },
});

// --- Ensemble vote queries for the bot simulator ---

export const listEnsembleVotes = query({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const q = ctx.db.query("ensembleVotes").order("desc");
    return args.limit ? await q.take(args.limit) : await q.collect();
  },
});

export const listWhaleAlerts = query({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const q = ctx.db.query("whaleAlerts").order("desc");
    return args.limit ? await q.take(args.limit) : await q.collect();
  },
});

export const listConvergenceSignals = query({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const q = ctx.db.query("convergenceSignals").order("desc");
    return args.limit ? await q.take(args.limit) : await q.collect();
  },
});
