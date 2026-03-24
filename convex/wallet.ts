import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// --- Public queries (dashboard) ---

export const getWallet = query({
  args: {},
  handler: async (ctx) => {
    const wallets = await ctx.db.query("wallet").collect();
    return wallets[0] ?? null;
  },
});

// --- Internal queries (agentRun) ---

export const internalGetWallet = internalQuery({
  args: {},
  handler: async (ctx) => {
    const wallets = await ctx.db.query("wallet").collect();
    return wallets[0] ?? null;
  },
});

// --- Public mutations (settings/dashboard) ---

export const initWallet = mutation({
  args: { initialBalance: v.float64() },
  handler: async (ctx, args) => {
    // Delete any existing wallet
    const existing = await ctx.db.query("wallet").collect();
    for (const w of existing) {
      await ctx.db.delete(w._id);
    }

    return await ctx.db.insert("wallet", {
      balance: args.initialBalance,
      initialBalance: args.initialBalance,
      totalInvested: 0,
      realizedPnl: 0,
      tradeCount: 0,
      updatedAt: Date.now(),
    });
  },
});

export const resetWallet = mutation({
  args: { balance: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const wallets = await ctx.db.query("wallet").collect();
    const newBalance = args.balance ?? 500;

    if (wallets.length > 0) {
      await ctx.db.patch(wallets[0]._id, {
        balance: newBalance,
        initialBalance: newBalance,
        totalInvested: 0,
        realizedPnl: 0,
        tradeCount: 0,
        updatedAt: Date.now(),
      });
      return wallets[0]._id;
    }

    return await ctx.db.insert("wallet", {
      balance: newBalance,
      initialBalance: newBalance,
      totalInvested: 0,
      realizedPnl: 0,
      tradeCount: 0,
      updatedAt: Date.now(),
    });
  },
});

// --- Internal mutations (agentRun) ---

export const internalDeductForTrade = internalMutation({
  args: {
    cost: v.float64(),
  },
  handler: async (ctx, args) => {
    const wallets = await ctx.db.query("wallet").collect();
    if (wallets.length === 0) return false;

    const wallet = wallets[0];
    if (wallet.balance < args.cost) return false;

    await ctx.db.patch(wallet._id, {
      balance: Math.round((wallet.balance - args.cost) * 100) / 100,
      totalInvested: Math.round((wallet.totalInvested + args.cost) * 100) / 100,
      tradeCount: wallet.tradeCount + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const internalCreditForClose = internalMutation({
  args: {
    originalCost: v.float64(),
    payout: v.float64(),
  },
  handler: async (ctx, args) => {
    const wallets = await ctx.db.query("wallet").collect();
    if (wallets.length === 0) return;

    const wallet = wallets[0];
    const pnl = args.payout - args.originalCost;

    await ctx.db.patch(wallet._id, {
      balance: Math.round((wallet.balance + args.payout) * 100) / 100,
      totalInvested: Math.max(0, Math.round((wallet.totalInvested - args.originalCost) * 100) / 100),
      realizedPnl: Math.round((wallet.realizedPnl + pnl) * 100) / 100,
      updatedAt: Date.now(),
    });
  },
});

export const internalCreditFromExit = internalMutation({
  args: {
    amount: v.float64(),
  },
  handler: async (ctx, args) => {
    const wallets = await ctx.db.query("wallet").collect();
    if (wallets.length === 0) return;

    const wallet = wallets[0];
    await ctx.db.patch(wallet._id, {
      balance: Math.round((wallet.balance + args.amount) * 100) / 100,
      updatedAt: Date.now(),
    });
  },
});

// Recalculate totalInvested from open positions (self-healing)
export const internalReconcileWallet = internalMutation({
  args: {
    openPositionsCost: v.float64(),
  },
  handler: async (ctx, args) => {
    const wallets = await ctx.db.query("wallet").collect();
    if (wallets.length === 0) return;

    await ctx.db.patch(wallets[0]._id, {
      totalInvested: Math.round(args.openPositionsCost * 100) / 100,
      updatedAt: Date.now(),
    });
  },
});
