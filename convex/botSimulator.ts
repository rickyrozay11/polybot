import { action, internalAction, query } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Trigger an on-demand agent cycle from the UI.
 * Runs the full pipeline (real APIs, paper trades) and returns the cycle ID.
 */
export const triggerAgentCycle = action({
  args: {},
  handler: async (ctx) => {
    // Run the internal agent cycle action
    await ctx.runAction(internal.agentRun.runAgentCycle, {});
    return { success: true, triggeredAt: Date.now() };
  },
});

/**
 * Trigger an on-demand copy-trade cycle from the UI.
 */
export const triggerCopyTradeCycle = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runAction(internal.agentRun.runCopyTradeCycle, {});
    return { success: true, triggeredAt: Date.now() };
  },
});

/**
 * Get a summary of the bot's current state for the simulator dashboard.
 */
export const getBotStatus = query({
  args: {},
  handler: async (ctx) => {
    // Get wallet
    const wallets = await ctx.db.query("wallet").collect();
    const wallet = wallets[0] ?? null;

    // Get open positions count
    const positions = await ctx.db
      .query("positions")
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect();

    // Get last 5 actions to determine recent activity
    const recentActions = await ctx.db
      .query("agentActions")
      .order("desc")
      .take(5);

    // Get trade counts
    const allTrades = await ctx.db.query("trades").collect();
    const dryRunTrades = allTrades.filter((t) => t.status === "dry_run");
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const todayTrades = allTrades.filter((t) => t.executedAt >= todayStart);

    // Get ensemble vote count
    const ensembleVotes = await ctx.db.query("ensembleVotes").collect();

    // Get whale alerts count
    const whaleAlerts = await ctx.db.query("whaleAlerts").collect();

    // Get convergence signals count
    const convergenceSignals = await ctx.db.query("convergenceSignals").collect();

    const lastAction = recentActions[0];

    return {
      wallet: wallet
        ? {
            balance: wallet.balance,
            initialBalance: wallet.initialBalance,
            totalInvested: wallet.totalInvested,
            realizedPnl: wallet.realizedPnl,
            tradeCount: wallet.tradeCount,
          }
        : null,
      openPositions: positions.length,
      totalTrades: allTrades.length,
      dryRunTrades: dryRunTrades.length,
      todayTrades: todayTrades.length,
      ensembleVoteCount: ensembleVotes.length,
      whaleAlertCount: whaleAlerts.length,
      convergenceSignalCount: convergenceSignals.length,
      lastActivityAt: lastAction?.timestamp ?? null,
      lastActivityType: lastAction?.type ?? null,
      lastActivitySummary: lastAction?.summary ?? null,
    };
  },
});
