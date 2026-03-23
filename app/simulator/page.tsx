"use client";

import { useEffect, useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn, formatUSD, formatPercent, timeAgo, truncate } from "@/src/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  Zap,
  Play,
  Pause,
  Square,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  Clock,
  Power,
} from "lucide-react";

export default function SimulatorPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [expandedVote, setExpandedVote] = useState<string | null>(null);
  const [alertTab, setAlertTab] = useState<"whales" | "convergence">("whales");

  // Convex queries
  const botStatus = useQuery(api.botSimulator.getBotStatus);
  const recentTradesData = useQuery(api.trades.recentTrades, { limit: 50 });
  const ensembleVotesData = useQuery(api.agentActions.listEnsembleVotes, {
    limit: 20,
  });
  const whaleAlertsData = useQuery(api.agentActions.listWhaleAlerts, {
    limit: 20,
  });
  const convergenceSignalsData = useQuery(api.agentActions.listConvergenceSignals, {
    limit: 20,
  });
  const analyticsData = useQuery(api.analytics.dailyAnalytics, { limit: 30 });

  // Read enabled config (real-time)
  const enabledConfig = useQuery(api.config.getConfig, { key: "enabled" });
  const botEnabled = enabledConfig?.value === "true";

  // Convex actions & mutations
  const triggerAgentCycleAction = useAction(api.botSimulator.triggerAgentCycle);
  const triggerCopyTradeCycleAction = useAction(api.botSimulator.triggerCopyTradeCycle);
  const setConfig = useMutation(api.config.setConfig);

  // Toggle bot on/off — this enables/disables the Convex crons (server-side, runs 24/7)
  const handleToggleBot = async () => {
    await setConfig({ key: "enabled", value: botEnabled ? "false" : "true" });
  };

  // Handle one-off agent cycle trigger
  const handleTriggerAgentCycle = async () => {
    setIsRunning(true);
    try {
      await triggerAgentCycleAction({});
    } catch (error) {
      console.error("Failed to trigger agent cycle:", error);
    } finally {
      setIsRunning(false);
    }
  };

  // Handle one-off copy-trade cycle trigger
  const handleTriggerCopyTradeCycle = async () => {
    setIsRunning(true);
    try {
      await triggerCopyTradeCycleAction({});
    } catch (error) {
      console.error("Failed to trigger copy-trade cycle:", error);
    } finally {
      setIsRunning(false);
    }
  };

  // Render P&L Chart
  const renderChart = () => {
    if (!analyticsData || analyticsData.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <span>No analytics data yet. Run a cycle to get started.</span>
        </div>
      );
    }

    // Sort by date ascending for chart
    const sortedData = [...analyticsData].reverse();
    const minPnl = Math.min(...sortedData.map((d) => d.cumulativeReturn));
    const maxPnl = Math.max(...sortedData.map((d) => d.cumulativeReturn));
    const range = maxPnl - minPnl || 1;
    const paddedMin = minPnl - range * 0.1;
    const paddedMax = maxPnl + range * 0.1;
    const chartRange = paddedMax - paddedMin;

    const width = 100;
    const height = 200;
    const chartWidth = width - 20;
    const chartHeight = height - 40;
    const pointSpacing = chartWidth / (sortedData.length - 1 || 1);

    // Generate SVG path
    const points = sortedData.map((d, i) => {
      const x = 10 + i * pointSpacing;
      const y =
        height - 20 - ((d.cumulativeReturn - paddedMin) / chartRange) * chartHeight;
      return `${x},${y}`;
    });

    const pathD = `M ${points.join(" L ")}`;
    const isPositive = sortedData[sortedData.length - 1]?.cumulativeReturn ?? 0 >= 0;

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = 20 + pct * chartHeight;
          const value = paddedMin + pct * chartRange;
          return (
            <g key={i}>
              <line
                x1="10"
                y1={y}
                x2={width - 10}
                y2={y}
                stroke="hsl(216, 34%, 17%)"
                strokeWidth="1"
              />
              <text
                x="5"
                y={y + 3}
                fontSize="10"
                fill="hsl(215.4, 16.3%, 56.9%)"
                textAnchor="end"
              >
                {formatUSD(value)}
              </text>
            </g>
          );
        })}

        {/* Area under curve */}
        <defs>
          <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop
              offset="0%"
              stopColor={isPositive ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)"}
            />
            <stop
              offset="100%"
              stopColor={isPositive ? "rgba(34, 197, 94, 0.0)" : "rgba(239, 68, 68, 0.0)"}
            />
          </linearGradient>
        </defs>
        <path
          d={`${pathD} L ${width - 10},${height - 20} L 10,${height - 20} Z`}
          fill="url(#areaGradient)"
        />

        {/* Line */}
        <path
          d={pathD}
          stroke={isPositive ? "#22c55e" : "#ef4444"}
          strokeWidth="2"
          fill="none"
        />

        {/* Points */}
        {points.map((point, i) => {
          const [x, y] = point.split(",").map(Number);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill={isPositive ? "#22c55e" : "#ef4444"}
            />
          );
        })}
      </svg>
    );
  };

  const currentReturn =
    analyticsData && analyticsData.length > 0
      ? analyticsData[0]?.cumulativeReturn ?? 0
      : 0;
  const returnPercent =
    (botStatus?.wallet?.initialBalance ?? 0) > 0
      ? (currentReturn / (botStatus?.wallet?.initialBalance ?? 1)) * 100
      : 0;

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Zap className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Bot Simulator</h1>
            {botEnabled && (
              <Badge variant="default" className="bg-green-600 text-white animate-pulse">
                LIVE
              </Badge>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Start/Stop Bot — toggles Convex crons (server-side, runs 24/7) */}
            <Button
              onClick={handleToggleBot}
              variant={botEnabled ? "destructive" : "default"}
              className="w-full sm:w-auto"
            >
              {botEnabled ? (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Stop Bot
                </>
              ) : (
                <>
                  <Power className="h-4 w-4 mr-2" />
                  Start Bot 24/7
                </>
              )}
            </Button>

            {/* Manual one-off triggers */}
            <div className="relative group">
              <Button
                disabled={isRunning}
                className="w-full sm:w-auto"
                variant="outline"
              >
                <ChevronDown className="h-4 w-4 mr-2" />
                {isRunning ? "Running..." : "Run Now"}
              </Button>
              <div className="absolute right-0 mt-2 w-48 rounded-lg border bg-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                <button
                  onClick={handleTriggerAgentCycle}
                  disabled={isRunning}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-accent rounded-t-lg"
                >
                  Run Agent Cycle
                </button>
                <button
                  onClick={handleTriggerCopyTradeCycle}
                  disabled={isRunning}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-accent rounded-b-lg border-t"
                >
                  Run Copy-Trade Cycle
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bot status info */}
        {botEnabled && (
          <div className="text-sm text-muted-foreground bg-green-950/20 border border-green-900/30 rounded-lg px-4 py-2">
            Bot is running 24/7 server-side. Agent cycle every 15 min, copy-trade every 10 min, positions refresh every 5 min. You can close this page.
          </div>
        )}

        {/* Status KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-6">
              <div>
                <span className="text-xs text-muted-foreground">Balance</span>
                <div className="text-2xl font-bold font-mono">
                  {botStatus?.wallet
                    ? formatUSD(botStatus.wallet.balance)
                    : "--"}
                </div>
                <span className="text-xs text-muted-foreground">
                  {botStatus?.wallet?.initialBalance
                    ? `of ${formatUSD(botStatus.wallet.initialBalance)}`
                    : ""}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div>
                <span className="text-xs text-muted-foreground">
                  Open Positions
                </span>
                <div className="text-2xl font-bold font-mono">
                  {botStatus?.openPositions ?? "--"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div>
                <span className="text-xs text-muted-foreground">
                  Today's Trades
                </span>
                <div className="text-2xl font-bold font-mono">
                  {botStatus?.todayTrades ?? "--"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div>
                <span className="text-xs text-muted-foreground">
                  Total Dry-Run
                </span>
                <div className="text-2xl font-bold font-mono">
                  {botStatus?.dryRunTrades ?? "--"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div>
                <span className="text-xs text-muted-foreground">
                  Ensemble Votes
                </span>
                <div className="text-2xl font-bold font-mono">
                  {botStatus?.ensembleVoteCount ?? "--"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div>
                <span className="text-xs text-muted-foreground">
                  Whale Alerts
                </span>
                <div className="text-2xl font-bold font-mono">
                  {botStatus?.whaleAlertCount ?? "--"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main 2-column layout */}
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          {/* Left column - Live Trade Feed */}
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Live Trade Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-[600px]">
              {!recentTradesData ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Loading trades...
                </div>
              ) : recentTradesData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No trades yet
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTradesData.map((trade, idx) => (
                    <div
                      key={`${trade._id}-${idx}`}
                      className={cn(
                        "border rounded-lg p-3 transition-colors cursor-pointer hover:bg-accent/50",
                        expandedTrade === trade._id ? "border-primary bg-accent/30" : ""
                      )}
                      onClick={() =>
                        setExpandedTrade(
                          expandedTrade === trade._id ? null : String(trade._id)
                        )
                      }
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            {timeAgo(trade.executedAt)}
                          </span>
                          <span className="text-sm text-muted-foreground truncate">
                            {truncate(trade.question, 40)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge
                          variant={
                            trade.side === "buy_yes" ? "default" : "secondary"
                          }
                          className={cn(
                            trade.side === "buy_yes"
                              ? "bg-green-600 hover:bg-green-700"
                              : "bg-red-600 hover:bg-red-700"
                          )}
                        >
                          {trade.side === "buy_yes" ? "BUY YES" : "BUY NO"}
                        </Badge>
                        <span className="text-sm font-mono">
                          {formatUSD(trade.size)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          @ {formatPercent(trade.price)}
                        </span>
                        <span className="text-xs font-semibold text-yellow-400">
                          {formatPercent(trade.confidence)} conf
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            trade.status === "dry_run"
                              ? "border-blue-500 text-blue-400"
                              : trade.status === "filled"
                                ? "border-green-500 text-green-400"
                                : "border-orange-500 text-orange-400"
                          )}
                        >
                          {trade.status}
                        </Badge>
                      </div>

                      {expandedTrade === trade._id && (
                        <div className="mt-3 pt-3 border-t text-xs space-y-1 text-muted-foreground">
                          <div>
                            <span className="font-semibold">Reasoning:</span>{" "}
                            {trade.reasoning}
                          </div>
                          <div>
                            <span className="font-semibold">Token:</span>{" "}
                            {trade.tokenId}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right column - Ensemble Vote Viewer */}
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Ensemble Votes
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-[600px]">
              {!ensembleVotesData ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Loading votes...
                </div>
              ) : ensembleVotesData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No ensemble votes yet
                </div>
              ) : (
                <div className="space-y-3">
                  {ensembleVotesData.map((vote) => (
                    <div
                      key={vote._id}
                      className={cn(
                        "border rounded-lg p-3 transition-colors cursor-pointer hover:bg-accent/50",
                        expandedVote === vote._id ? "border-primary bg-accent/30" : ""
                      )}
                      onClick={() =>
                        setExpandedVote(
                          expandedVote === vote._id ? null : String(vote._id)
                        )
                      }
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            {timeAgo(vote.createdAt)}
                          </span>
                          <span className="text-sm text-muted-foreground truncate">
                            {truncate(vote.question, 35)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge
                          variant={
                            vote.agreementLevel === "full"
                              ? "default"
                              : vote.agreementLevel === "majority"
                                ? "secondary"
                                : "outline"
                          }
                          className={cn(
                            vote.agreementLevel === "full"
                              ? "bg-green-600"
                              : vote.agreementLevel === "majority"
                                ? "bg-yellow-600"
                                : vote.agreementLevel === "weak"
                                  ? "bg-orange-600"
                                  : "bg-red-600"
                          )}
                        >
                          {vote.agreementLevel.toUpperCase()}
                        </Badge>
                        <span className="text-sm font-mono">
                          {vote.consensusAction === "skip"
                            ? "SKIP"
                            : vote.consensusAction === "buy_yes"
                              ? "BUY YES"
                              : "BUY NO"}
                        </span>
                        <span className="text-xs font-semibold text-yellow-400">
                          {formatPercent(vote.consensusConfidence)} conf
                        </span>
                      </div>

                      {expandedVote === vote._id && vote.votes.length > 0 && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <span className="text-xs font-semibold text-muted-foreground">
                            Model Votes:
                          </span>
                          {vote.votes.map((v, i) => (
                            <div
                              key={i}
                              className="text-xs bg-muted/50 rounded p-2"
                            >
                              <div className="flex justify-between">
                                <span className="font-mono text-xs">
                                  {v.modelId}
                                </span>
                                <span className="text-muted-foreground">
                                  {v.action} ({formatPercent(v.confidence)})
                                </span>
                              </div>
                              <div className="text-muted-foreground text-xs mt-1">
                                {v.reasoning}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {v.latencyMs}ms
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom 2-column layout */}
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          {/* Left column - P&L Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Portfolio Performance
                </span>
                {currentReturn !== 0 && (
                  <span
                    className={cn(
                      "text-lg font-mono",
                      currentReturn >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    )}
                  >
                    {currentReturn >= 0 ? "+" : ""}
                    {returnPercent.toFixed(1)}%
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>{renderChart()}</CardContent>
          </Card>

          {/* Right column - Whale & Convergence Alerts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Whale & Convergence Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Tabs */}
              <div className="flex gap-2 mb-4 border-b">
                <button
                  onClick={() => setAlertTab("whales")}
                  className={cn(
                    "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                    alertTab === "whales"
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Whales ({whaleAlertsData?.length ?? 0})
                </button>
                <button
                  onClick={() => setAlertTab("convergence")}
                  className={cn(
                    "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                    alertTab === "convergence"
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Convergence ({convergenceSignalsData?.length ?? 0})
                </button>
              </div>

              {/* Tab Content */}
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {alertTab === "whales" && (
                  <>
                    {!whaleAlertsData ? (
                      <div className="text-muted-foreground text-sm text-center py-8">
                        Loading whales...
                      </div>
                    ) : whaleAlertsData.length === 0 ? (
                      <div className="text-muted-foreground text-sm text-center py-8">
                        No whale alerts
                      </div>
                    ) : (
                      whaleAlertsData.map((whale) => (
                        <div key={whale._id} className="border rounded-lg p-3 text-sm">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="font-mono text-xs truncate">
                                {whale.traderAddress.slice(0, 10)}...
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {truncate(whale.question, 40)}
                              </div>
                            </div>
                            {whale.isInsider && (
                              <Badge className="bg-red-600 whitespace-nowrap">
                                INSIDER
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                whale.side === "buy_yes"
                                  ? "default"
                                  : "secondary"
                              }
                              className={cn(
                                whale.side === "buy_yes"
                                  ? "bg-green-600 hover:bg-green-700"
                                  : "bg-red-600 hover:bg-red-700"
                              )}
                            >
                              {whale.side === "buy_yes" ? "YES" : "NO"}
                            </Badge>
                            <span className="font-mono text-xs">
                              {formatUSD(whale.totalValue)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {timeAgo(whale.detectedAt)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}

                {alertTab === "convergence" && (
                  <>
                    {!convergenceSignalsData ? (
                      <div className="text-muted-foreground text-sm text-center py-8">
                        Loading convergence signals...
                      </div>
                    ) : convergenceSignalsData.length === 0 ? (
                      <div className="text-muted-foreground text-sm text-center py-8">
                        No convergence signals
                      </div>
                    ) : (
                      convergenceSignalsData.map((signal) => (
                        <div key={signal._id} className="border rounded-lg p-3 text-sm">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="font-semibold">
                                {signal.exchange} {signal.symbol}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {truncate(signal.question, 40)}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                signal.side === "buy_yes"
                                  ? "default"
                                  : "secondary"
                              }
                              className={cn(
                                signal.side === "buy_yes"
                                  ? "bg-green-600 hover:bg-green-700"
                                  : "bg-red-600 hover:bg-red-700"
                              )}
                            >
                              {signal.side === "buy_yes" ? "YES" : "NO"}
                            </Badge>
                            <span className="font-mono text-xs">
                              {formatPercent(signal.priceLagPercent)} lag
                            </span>
                            <span className="text-xs font-semibold text-yellow-400">
                              {formatPercent(signal.confidence)} conf
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                signal.status === "executed"
                                  ? "border-green-500 text-green-400"
                                  : signal.status === "pending"
                                    ? "border-yellow-500 text-yellow-400"
                                    : "border-muted-foreground"
                              )}
                            >
                              {signal.status}
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
