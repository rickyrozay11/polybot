"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const runAgentCycle = internalAction({
  args: {},
  handler: async (ctx) => {
    // Read config to check if agent is enabled
    const enabledEntry = await ctx.runQuery(
      internal.config.internalGetConfig,
      { key: "enabled" }
    );
    const isEnabled = enabledEntry ? enabledEntry.value === "true" : false;

    if (!isEnabled) {
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "scan",
        summary: "Agent cycle skipped: agent is disabled",
        details: {},
        timestamp: Date.now(),
      });
      return;
    }

    // Check wallet exists and has funds
    const wallet = await ctx.runQuery(internal.wallet.internalGetWallet);
    if (!wallet) {
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "error",
        summary: "Agent cycle skipped: no wallet initialized",
        details: { hint: "Initialize wallet from Settings page or run seed-config" },
        timestamp: Date.now(),
      });
      return;
    }

    if (wallet.balance < 0.5) {
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "scan",
        summary: `Agent cycle skipped: insufficient balance ($${wallet.balance.toFixed(2)})`,
        details: { balance: wallet.balance },
        timestamp: Date.now(),
      });
      return;
    }

    const cycleId = `cycle-${Date.now()}`;

    await ctx.runMutation(internal.agentActions.internalLogAction, {
      type: "scan",
      summary: `Agent cycle started: ${cycleId} | Balance: $${wallet.balance.toFixed(2)}`,
      details: {
        cycleId,
        walletBalance: wallet.balance,
        totalInvested: wallet.totalInvested,
        realizedPnl: wallet.realizedPnl,
      },
      timestamp: Date.now(),
      cycleId,
    });

    try {
      const { runPipeline } = await import("../src/agent/pipeline");
      const { OpenRouterProvider } = await import("../src/llm/openrouter");
      const { fetchTrendingMarkets } = await import(
        "../src/tools/polymarket-scanner"
      );
      const { initClient } = await import("../src/tools/polymarket-client");

      // Read config values
      const modelEntry = await ctx.runQuery(
        internal.config.internalGetConfig,
        { key: "modelId" }
      );
      const maxTradeSizeEntry = await ctx.runQuery(
        internal.config.internalGetConfig,
        { key: "maxTradeSize" }
      );
      const maxExposureEntry = await ctx.runQuery(
        internal.config.internalGetConfig,
        { key: "maxTotalExposure" }
      );
      const minConfidenceEntry = await ctx.runQuery(
        internal.config.internalGetConfig,
        { key: "minConfidence" }
      );
      const dryRunEntry = await ctx.runQuery(
        internal.config.internalGetConfig,
        { key: "dryRun" }
      );

      const config = {
        maxTradeSize: maxTradeSizeEntry
          ? parseFloat(maxTradeSizeEntry.value)
          : 25,
        maxTotalExposure: maxExposureEntry
          ? parseFloat(maxExposureEntry.value)
          : 500,
        minConfidence: minConfidenceEntry
          ? parseFloat(minConfidenceEntry.value)
          : 0.6,
        modelId: modelEntry?.value ?? "x-ai/grok-4.20-multi-agent-beta",
        runIntervalMinutes: 15,
        enabled: true,
        dryRun: dryRunEntry ? dryRunEntry.value === "true" : true,
        availableBalance: wallet.balance,
      };

      const llm = new OpenRouterProvider({
        apiKey: process.env.OPENROUTER_API_KEY!,
        modelId: config.modelId,
      });

      let polyClient: any = null;
      if (!config.dryRun) {
        polyClient = initClient();
      }

      const openPositions = await ctx.runQuery(
        internal.positions.internalOpenPositions,
        {}
      );
      const existingPositionIds = openPositions.map(
        (p: any) => p.conditionId
      );
      const currentExposure = openPositions.reduce(
        (sum: number, p: any) => sum + p.currentPrice * p.size,
        0
      );

      // Track balance changes within this cycle
      let cycleBalance = wallet.balance;

      await runPipeline({
        llm,
        scanner: { fetchTrendingMarkets },
        polyClient,
        toolDeps: {},
        config,
        existingPositionIds,
        currentExposure,
        logAction: async (action) => {
          await ctx.runMutation(internal.agentActions.internalLogAction, {
            ...action,
            cycleId,
          });
        },
        recordTrade: async (trade: any) => {
          // Map pipeline output to the trade mutation schema
          const side: "buy_yes" | "buy_no" =
            trade.action === "buy_yes" || trade.side === "buy_yes"
              ? "buy_yes"
              : "buy_no";
          const status: "dry_run" | "pending" = trade.dryRun
            ? "dry_run"
            : "pending";

          const tradeCost = trade.size * trade.price;

          // Deduct from wallet
          const deducted = await ctx.runMutation(
            internal.wallet.internalDeductForTrade,
            { cost: tradeCost }
          );

          if (!deducted) {
            await ctx.runMutation(internal.agentActions.internalLogAction, {
              type: "error",
              summary: `Trade rejected: insufficient wallet balance for $${tradeCost.toFixed(2)} trade`,
              details: {
                conditionId: trade.conditionId,
                tradeCost,
                walletBalance: cycleBalance,
              },
              timestamp: Date.now(),
              cycleId,
            });
            return;
          }

          cycleBalance -= tradeCost;
          // Update available balance for subsequent risk checks
          config.availableBalance = cycleBalance;

          // Record the trade
          await ctx.runMutation(internal.trades.internalRecordTrade, {
            conditionId: trade.conditionId,
            question: trade.question,
            tokenId: trade.tokenId,
            side,
            size: trade.size,
            price: trade.price,
            confidence: trade.confidence,
            reasoning: trade.reasoning,
            status,
            executedAt: Date.now(),
          });

          // Open a position
          const positionSide: "yes" | "no" =
            trade.action === "buy_yes" || trade.side === "buy_yes"
              ? "yes"
              : "no";

          await ctx.runMutation(internal.positions.internalOpenPosition, {
            conditionId: trade.conditionId,
            question: trade.question,
            tokenId: trade.tokenId,
            side: positionSide,
            size: trade.size,
            avgEntryPrice: trade.price,
            currentPrice: trade.price,
            unrealizedPnl: 0,
            openedAt: Date.now(),
            slug: trade.slug,
          });
        },
        updatePositionPrice: async (conditionId, price) => {
          const pos = await ctx.runQuery(
            internal.positions.internalGetPositionByCondition,
            { conditionId }
          );
          if (pos) {
            const unrealizedPnl =
              (price - pos.avgEntryPrice) *
              pos.size *
              (pos.side === "yes" ? 1 : -1);
            await ctx.runMutation(
              internal.positions.internalUpdatePositionPrice,
              {
                positionId: pos._id,
                currentPrice: price,
                unrealizedPnl,
              }
            );
          }
        },
        openPositions: openPositions.map((p: any) => ({
          conditionId: p.conditionId,
          tokenId: p.tokenId,
          side: p.side,
          size: p.size,
          avgEntryPrice: p.avgEntryPrice,
        })),
      });

      // Reconcile wallet totalInvested from actual open positions
      const finalPositions = await ctx.runQuery(
        internal.positions.internalOpenPositions,
        {}
      );
      const totalInvested = finalPositions.reduce(
        (sum: number, p: any) => sum + p.avgEntryPrice * p.size,
        0
      );
      await ctx.runMutation(internal.wallet.internalReconcileWallet, {
        openPositionsCost: totalInvested,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "error",
        summary: `Agent cycle failed: ${message}`,
        details: { cycleId, error: message },
        timestamp: Date.now(),
        cycleId,
      });
    }
  },
});

// ============================================================
// Copy-Trading Cycle
// ============================================================

export const runCopyTradeCycle = internalAction({
  args: {},
  handler: async (ctx) => {
    // Check if agent is enabled
    const enabledEntry = await ctx.runQuery(
      internal.config.internalGetConfig,
      { key: "enabled" }
    );
    if (enabledEntry?.value !== "true") return;

    // Check wallet
    const wallet = await ctx.runQuery(internal.wallet.internalGetWallet);
    if (!wallet || wallet.balance < 0.5) return;

    const cycleId = `copy-${Date.now()}`;

    await ctx.runMutation(internal.agentActions.internalLogAction, {
      type: "copy_trade_scan",
      summary: `Copy-trade scan started: ${cycleId}`,
      details: { cycleId, balance: wallet.balance },
      timestamp: Date.now(),
      cycleId,
    });

    try {
      const { discoverTopTraders, scanTraderActivity, generateCopySignals, buildCopyTradeValidationPrompt } =
        await import("../src/agent/copy-trader");
      const { OpenRouterProvider } = await import("../src/llm/openrouter");
      const { SYSTEM_PROMPT } = await import("../src/agent/prompts");

      // Read config
      const modelEntry = await ctx.runQuery(internal.config.internalGetConfig, { key: "modelId" });
      const maxTradeSizeEntry = await ctx.runQuery(internal.config.internalGetConfig, { key: "maxTradeSize" });
      const maxExposureEntry = await ctx.runQuery(internal.config.internalGetConfig, { key: "maxTotalExposure" });
      const minConfidenceEntry = await ctx.runQuery(internal.config.internalGetConfig, { key: "minConfidence" });
      const dryRunEntry = await ctx.runQuery(internal.config.internalGetConfig, { key: "dryRun" });

      const config = {
        maxTradeSize: maxTradeSizeEntry ? parseFloat(maxTradeSizeEntry.value) : 25,
        maxTotalExposure: maxExposureEntry ? parseFloat(maxExposureEntry.value) : 500,
        minConfidence: minConfidenceEntry ? parseFloat(minConfidenceEntry.value) : 0.6,
        modelId: modelEntry?.value ?? "x-ai/grok-4.20-multi-agent-beta",
        runIntervalMinutes: 15,
        enabled: true,
        dryRun: dryRunEntry ? dryRunEntry.value === "true" : true,
        availableBalance: wallet.balance,
      };

      const llm = new OpenRouterProvider({
        apiKey: process.env.OPENROUTER_API_KEY!,
        modelId: config.modelId,
      });

      // Step 1: Get or refresh tracked traders
      let trackedTraders = await ctx.runQuery(internal.trackedTraders.internalEnabledTraders, {});

      // Refresh from leaderboard every cycle (or if no traders tracked yet)
      if (trackedTraders.length < 5) {
        const topTraders = await discoverTopTraders(20);

        for (const trader of topTraders) {
          await ctx.runMutation(internal.trackedTraders.internalUpsertTrader, {
            address: trader.address,
            username: trader.username,
            pnl: trader.pnl,
            volume: trader.volume,
            winRate: trader.winRate,
            tradeCount: trader.tradeCount,
            compositeScore: trader.compositeScore,
            source: "leaderboard",
            enabled: true,
          });
        }

        await ctx.runMutation(internal.agentActions.internalLogAction, {
          type: "copy_trade_scan",
          summary: `Discovered ${topTraders.length} top traders from leaderboard`,
          details: {
            cycleId,
            traders: topTraders.slice(0, 5).map((t) => ({
              username: t.username,
              score: t.compositeScore,
              pnl: t.pnl,
            })),
          },
          timestamp: Date.now(),
          cycleId,
        });

        // Re-fetch from DB
        trackedTraders = await ctx.runQuery(internal.trackedTraders.internalEnabledTraders, {});
      }

      if (trackedTraders.length === 0) {
        await ctx.runMutation(internal.agentActions.internalLogAction, {
          type: "copy_trade_scan",
          summary: "No tracked traders found — skipping copy-trade cycle",
          details: { cycleId },
          timestamp: Date.now(),
          cycleId,
        });
        return;
      }

      // Step 2: Scan for new activity (last 20 minutes to overlap with cron interval)
      const sinceTimestamp = Date.now() - 20 * 60 * 1000;
      const tradersForScan = trackedTraders.map((t) => ({
        address: t.address,
        username: t.username,
        pnl: t.pnl,
        volume: t.volume,
        winRate: t.winRate,
        tradeCount: t.tradeCount,
        compositeScore: t.compositeScore,
        lastUpdated: t.lastUpdated,
      }));

      const detections = await scanTraderActivity(tradersForScan, sinceTimestamp);

      if (detections.length === 0) {
        await ctx.runMutation(internal.agentActions.internalLogAction, {
          type: "copy_trade_scan",
          summary: `No new trades detected from ${trackedTraders.length} tracked traders`,
          details: { cycleId, tradersScanned: trackedTraders.length },
          timestamp: Date.now(),
          cycleId,
        });
        return;
      }

      // Log detected activity
      const totalNewTrades = detections.reduce((s, d) => s + d.trades.length, 0);
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "copy_trade_scan",
        summary: `Detected ${totalNewTrades} new trades from ${detections.length} traders`,
        details: {
          cycleId,
          detections: detections.map((d) => ({
            trader: d.traderUsername,
            tradeCount: d.trades.length,
          })),
        },
        timestamp: Date.now(),
        cycleId,
      });

      // Log individual trader activity
      for (const detection of detections) {
        for (const trade of detection.trades) {
          const side: "buy_yes" | "buy_no" =
            trade.side === "BUY"
              ? trade.outcome?.toLowerCase() === "no" ? "buy_no" : "buy_yes"
              : trade.outcome?.toLowerCase() === "no" ? "buy_yes" : "buy_no";

          await ctx.runMutation(internal.trackedTraders.internalLogTraderActivity, {
            traderAddress: detection.traderAddress,
            conditionId: trade.conditionId,
            question: trade.title ?? trade.conditionId,
            tokenId: trade.asset,
            side,
            size: parseFloat(trade.size),
            price: parseFloat(trade.price),
            copied: false,
          });
        }
      }

      // Step 3: Generate consensus signals
      const openPositions = await ctx.runQuery(internal.positions.internalOpenPositions, {});
      const existingPositionIds = openPositions.map((p: any) => p.conditionId);

      const signals = await generateCopySignals(detections, config, existingPositionIds);

      if (signals.length === 0) {
        await ctx.runMutation(internal.agentActions.internalLogAction, {
          type: "copy_trade_scan",
          summary: "No consensus signals generated (insufficient trader agreement)",
          details: { cycleId },
          timestamp: Date.now(),
          cycleId,
        });
        return;
      }

      // Step 4: LLM validation with Grok 4.20
      const validationPrompt = buildCopyTradeValidationPrompt(signals);
      const validationResponse = await llm.chat({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: validationPrompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      });

      let validations: Array<{
        index: number;
        approved: boolean;
        adjustedSize?: number;
        confidence?: number;
        reasoning?: string;
      }> = [];

      try {
        const parsed = JSON.parse(validationResponse.content ?? "{}");
        validations = parsed.validations ?? parsed.data ?? parsed.results ?? [];
      } catch {
        // If parsing fails, skip validation and approve all with default confidence
        validations = signals.map((_, i) => ({
          index: i + 1,
          approved: true,
          confidence: 0.6,
          reasoning: "LLM validation parse failed, using default approval",
        }));
      }

      // Step 5: Execute approved signals
      let executedCount = 0;
      let cycleBalance = wallet.balance;

      for (let i = 0; i < signals.length; i++) {
        const signal = signals[i];
        const validation = validations.find((v) => v.index === i + 1);

        // Record the signal
        const signalId = await ctx.runMutation(internal.trackedTraders.internalRecordSignal, {
          conditionId: signal.conditionId,
          question: signal.question,
          tokenId: signal.tokenId,
          side: signal.side,
          traderCount: new Set(detections.map((d) => d.traderAddress)).size,
          consensus: signal.consensus,
          avgTraderScore: signal.traderScore,
          suggestedSize: signal.suggestedSize,
          price: signal.price,
          status: "pending",
          reasoning: signal.reasoning,
        });

        if (!validation?.approved) {
          await ctx.runMutation(internal.trackedTraders.internalUpdateSignalStatus, {
            signalId,
            status: "skipped",
          });
          continue;
        }

        const finalSize = Math.min(
          validation.adjustedSize ?? signal.suggestedSize,
          config.maxTradeSize
        );
        const tradeCost = finalSize * signal.price;

        if (tradeCost > cycleBalance) {
          await ctx.runMutation(internal.trackedTraders.internalUpdateSignalStatus, {
            signalId,
            status: "skipped",
          });
          continue;
        }

        // Deduct from wallet
        const deducted = await ctx.runMutation(internal.wallet.internalDeductForTrade, {
          cost: tradeCost,
        });

        if (!deducted) {
          await ctx.runMutation(internal.trackedTraders.internalUpdateSignalStatus, {
            signalId,
            status: "skipped",
          });
          continue;
        }

        cycleBalance -= tradeCost;

        // Execute trade (or dry run)
        if (!config.dryRun) {
          try {
            const { initClient } = await import("../src/tools/polymarket-client");
            const { Side, OrderType } = await import("@polymarket/clob-client");
            const polyClient = await initClient();
            await polyClient.createAndPostOrder(
              {
                tokenID: signal.tokenId,
                price: signal.price,
                size: finalSize,
                side: Side.BUY,
              },
              { tickSize: "0.01", negRisk: false },
              OrderType.GTC
            );
          } catch (orderErr) {
            await ctx.runMutation(internal.agentActions.internalLogAction, {
              type: "error",
              summary: `Copy-trade order failed: ${String(orderErr)}`,
              details: { cycleId, conditionId: signal.conditionId },
              timestamp: Date.now(),
              cycleId,
            });
            continue;
          }
        }

        // Record the trade
        const status: "dry_run" | "pending" = config.dryRun ? "dry_run" : "pending";
        await ctx.runMutation(internal.trades.internalRecordTrade, {
          conditionId: signal.conditionId,
          question: signal.question,
          tokenId: signal.tokenId,
          side: signal.side,
          size: finalSize,
          price: signal.price,
          confidence: validation.confidence ?? 0.7,
          reasoning: `[COPY TRADE] ${signal.reasoning} | LLM: ${validation.reasoning ?? "approved"}`,
          status,
          executedAt: Date.now(),
        });

        // Open position
        const positionSide: "yes" | "no" = signal.side === "buy_yes" ? "yes" : "no";
        await ctx.runMutation(internal.positions.internalOpenPosition, {
          conditionId: signal.conditionId,
          question: signal.question,
          tokenId: signal.tokenId,
          side: positionSide,
          size: finalSize,
          avgEntryPrice: signal.price,
          currentPrice: signal.price,
          unrealizedPnl: 0,
          openedAt: Date.now(),
        });

        await ctx.runMutation(internal.trackedTraders.internalUpdateSignalStatus, {
          signalId,
          status: "executed",
        });

        executedCount++;
      }

      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "copy_trade_execute",
        summary: `${config.dryRun ? "[DRY RUN] " : ""}Executed ${executedCount}/${signals.length} copy-trade signals`,
        details: {
          cycleId,
          signalsGenerated: signals.length,
          signalsExecuted: executedCount,
          dryRun: config.dryRun,
        },
        timestamp: Date.now(),
        cycleId,
      });

      // Reconcile wallet
      const finalPositions = await ctx.runQuery(internal.positions.internalOpenPositions, {});
      const totalInvested = finalPositions.reduce(
        (sum: number, p: any) => sum + p.avgEntryPrice * p.size,
        0
      );
      await ctx.runMutation(internal.wallet.internalReconcileWallet, {
        openPositionsCost: totalInvested,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "error",
        summary: `Copy-trade cycle failed: ${message}`,
        details: { cycleId, error: message },
        timestamp: Date.now(),
        cycleId,
      });
    }
  },
});

// Refresh tracked traders from leaderboard (runs less frequently)
export const refreshTrackedTraders = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const { discoverTopTraders } = await import("../src/agent/copy-trader");
      const topTraders = await discoverTopTraders(30);

      for (const trader of topTraders) {
        await ctx.runMutation(internal.trackedTraders.internalUpsertTrader, {
          address: trader.address,
          username: trader.username,
          pnl: trader.pnl,
          volume: trader.volume,
          winRate: trader.winRate,
          tradeCount: trader.tradeCount,
          compositeScore: trader.compositeScore,
          source: "leaderboard",
          enabled: true,
        });
      }

      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "copy_trade_scan",
        summary: `Refreshed ${topTraders.length} tracked traders from leaderboard`,
        details: {
          count: topTraders.length,
          top5: topTraders.slice(0, 5).map((t) => ({
            username: t.username,
            score: t.compositeScore,
            pnl: t.pnl,
          })),
        },
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.agentActions.internalLogAction, {
        type: "error",
        summary: `Trader refresh failed: ${message}`,
        details: { error: message },
        timestamp: Date.now(),
      });
    }
  },
});

export const refreshPositions = internalAction({
  args: {},
  handler: async (ctx) => {
    const openPositions = await ctx.runQuery(
      internal.positions.internalOpenPositions,
      {}
    );

    for (const position of openPositions) {
      try {
        // Fetch current price from Polymarket API
        const res = await fetch(
          `https://clob.polymarket.com/midpoint?token_id=${position.tokenId}`
        );
        if (!res.ok) continue;

        const data = (await res.json()) as { mid: string };
        const currentPrice = parseFloat(data.mid);
        if (isNaN(currentPrice)) continue;

        const unrealizedPnl =
          (currentPrice - position.avgEntryPrice) *
          position.size *
          (position.side === "yes" ? 1 : -1);

        await ctx.runMutation(
          internal.positions.internalUpdatePositionPrice,
          {
            positionId: position._id,
            currentPrice,
            unrealizedPnl,
          }
        );
      } catch {
        // Skip positions that fail to update
      }
    }

    await ctx.runMutation(internal.agentActions.internalLogAction, {
      type: "position_refresh",
      summary: `Refreshed ${openPositions.length} open positions`,
      details: { count: openPositions.length },
      timestamp: Date.now(),
    });

    // Update daily analytics snapshot so the P&L chart stays current
    try {
      await ctx.runAction(internal.agentRun.computeDailyAnalytics, {});
    } catch {
      // Analytics update is non-critical — don't fail the refresh cycle
    }
  },
});

export const computeDailyAnalytics = internalAction({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];

    // Get all filled/dry_run trades
    const filledTrades = await ctx.runQuery(
      internal.trades.internalGetTradesByStatus,
      { status: "filled" }
    );
    const dryRunTrades = await ctx.runQuery(
      internal.trades.internalGetTradesByStatus,
      { status: "dry_run" }
    );
    const allTrades = [...filledTrades, ...dryRunTrades];

    // Filter to today's trades
    const startOfDay = new Date(today).getTime();
    const endOfDay = startOfDay + 86400000;
    const todayTrades = allTrades.filter(
      (t) => t.executedAt >= startOfDay && t.executedAt < endOfDay
    );

    const totalTrades = todayTrades.length;
    const tradesWithPnl = todayTrades.filter((t) => t.pnl !== undefined);
    const winCount = tradesWithPnl.filter((t) => (t.pnl ?? 0) > 0).length;
    const lossCount = tradesWithPnl.filter(
      (t) => (t.pnl ?? 0) <= 0
    ).length;
    const totalPnl = tradesWithPnl.reduce(
      (sum, t) => sum + (t.pnl ?? 0),
      0
    );
    const totalVolume = todayTrades.reduce(
      (sum, t) => sum + t.size * t.price,
      0
    );
    const winRate =
      tradesWithPnl.length > 0 ? winCount / tradesWithPnl.length : 0;

    // Get wallet for portfolio value
    const wallet = await ctx.runQuery(internal.wallet.internalGetWallet);
    const openPositions = await ctx.runQuery(
      internal.positions.internalOpenPositions,
      {}
    );
    const positionsValue = openPositions.reduce(
      (sum, p) => sum + p.currentPrice * p.size,
      0
    );
    const portfolioValue = (wallet?.balance ?? 0) + positionsValue;
    const cumulativeReturn = wallet
      ? ((portfolioValue - wallet.initialBalance) / wallet.initialBalance) * 100
      : 0;

    await ctx.runMutation(internal.analytics.internalUpsertAnalytics, {
      period: "daily",
      date: today,
      totalPnl,
      totalTrades,
      winCount,
      lossCount,
      winRate,
      totalVolume,
      portfolioValue,
      cumulativeReturn,
    });

    await ctx.runMutation(internal.agentActions.internalLogAction, {
      type: "scan",
      summary: `Daily analytics computed for ${today}`,
      details: { date: today, totalTrades, totalPnl, winRate, portfolioValue },
      timestamp: Date.now(),
    });
  },
});
