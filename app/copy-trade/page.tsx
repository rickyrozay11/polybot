"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  TrendingUp,
  TrendingDown,
  Signal,
  Trophy,
  Eye,
  EyeOff,
  Trash2,
  Activity,
  Wallet,
  CircleDot,
  Clock,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useState } from "react";

function formatUSD(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function scoreColor(score: number) {
  if (score > 0.7) return "text-green-400";
  if (score > 0.4) return "text-yellow-400";
  return "text-muted-foreground";
}

function pnlColor(n: number) {
  if (n > 0) return "text-green-400";
  if (n < 0) return "text-red-400";
  return "text-muted-foreground";
}

export default function CopyTradePage() {
  const traders = useQuery(api.trackedTraders.listTraders);
  const signals = useQuery(api.trackedTraders.listSignals, { status: undefined });
  const recentActivity = useQuery(api.trackedTraders.recentTraderActivity, { limit: 50 });
  const traderPerformance = useQuery(api.trackedTraders.listTraderPerformance);
  const positions = useQuery(api.positions.openPositions);
  const wallet = useQuery(api.wallet.getWallet);
  const allConfig = useQuery(api.config.getAllConfig);
  const actions = useQuery(api.agentActions.recentActions, { limit: 30 });

  const toggleTrader = useMutation(api.trackedTraders.toggleTrader);
  const removeTrader = useMutation(api.trackedTraders.removeTrader);
  const setConfig = useMutation(api.config.setConfig);

  const [tab, setTab] = useState<"overview" | "traders" | "signals" | "activity" | "log">("overview");

  // Derived data
  const configMap: Record<string, string> = {};
  if (allConfig) {
    for (const entry of allConfig) configMap[entry.key] = entry.value;
  }
  const isEnabled = configMap["enabled"] === "true";
  const isCopyOnly = configMap["copyTradeOnly"] === "true";
  const is247 = configMap["copyTrade247"] === "true";
  const isDryRun = configMap["dryRun"] === "true";

  const enabledTraders = traders?.filter((t) => t.enabled) ?? [];
  const disabledTraders = traders?.filter((t) => !t.enabled) ?? [];
  const copyPositions = positions?.filter((p) => (p as any).copiedFrom) ?? [];
  const totalUnrealizedPnl = copyPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

  const executedSignals = signals?.filter((s) => s.status === "executed") ?? [];
  const skippedSignals = signals?.filter((s) => s.status === "skipped") ?? [];

  // Copy P&L from closed performance records
  const closedPerf = traderPerformance?.filter((p) => p.status === "closed") ?? [];
  const totalCopyPnl = closedPerf.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const copyWins = closedPerf.filter((p) => (p.pnl ?? 0) > 0).length;
  const copyWinRate = closedPerf.length > 0 ? copyWins / closedPerf.length : 0;

  // Copy-trade-specific agent actions
  const copyActions = actions?.filter(
    (a) =>
      a.type === "copy_trade_scan" ||
      a.type === "copy_trade_execute" ||
      a.type === "copy_exit" ||
      a.type === "error"
  ) ?? [];

  const tabs = [
    { key: "overview" as const, label: "Overview", icon: Activity },
    { key: "traders" as const, label: "Traders", icon: Users },
    { key: "signals" as const, label: "Signals", icon: Signal },
    { key: "activity" as const, label: "Activity", icon: Zap },
    { key: "log" as const, label: "Bot Log", icon: Clock },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          Copy Trade Bot
        </h1>
        <div className="flex items-center gap-2">
          {isDryRun && (
            <Badge variant="outline" className="text-yellow-400 border-yellow-400/30">
              DRY RUN
            </Badge>
          )}
          {is247 && (
            <Badge variant="outline" className="text-purple-400 border-purple-400/30">
              24/7
            </Badge>
          )}
          {isCopyOnly && (
            <Badge variant="outline" className="text-blue-400 border-blue-400/30">
              COPY ONLY
            </Badge>
          )}
          <Badge
            variant={isEnabled ? "default" : "secondary"}
            className={isEnabled ? "bg-green-600" : ""}
          >
            {isEnabled ? "LIVE" : "PAUSED"}
          </Badge>
        </div>
      </div>

      {/* Quick Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={isEnabled ? "destructive" : "default"}
          size="sm"
          onClick={() => setConfig({ key: "enabled", value: isEnabled ? "false" : "true" })}
        >
          {isEnabled ? "Pause Bot" : "Start Bot"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfig({ key: "copyTradeOnly", value: isCopyOnly ? "false" : "true" })}
          className={isCopyOnly ? "border-blue-400/50 text-blue-400" : ""}
        >
          {isCopyOnly ? "Copy Only: ON" : "Copy Only: OFF"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfig({ key: "copyTrade247", value: is247 ? "false" : "true" })}
          className={is247 ? "border-purple-400/50 text-purple-400" : ""}
        >
          {is247 ? "24/7: ON (30s)" : "24/7: OFF (3min)"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfig({ key: "dryRun", value: isDryRun ? "false" : "true" })}
          className={isDryRun ? "border-yellow-400/50 text-yellow-400" : "border-green-400/50 text-green-400"}
        >
          {isDryRun ? "Dry Run: ON" : "LIVE TRADING"}
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Balance</p>
            </div>
            <p className="text-xl font-bold tabular-nums text-green-400">
              {wallet ? formatUSD(wallet.balance) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Realized P&L</p>
            </div>
            <p className={`text-xl font-bold tabular-nums ${pnlColor(totalCopyPnl)}`}>
              {totalCopyPnl >= 0 ? "+" : ""}{formatUSD(totalCopyPnl)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Open Copies</p>
            </div>
            <p className="text-xl font-bold tabular-nums">{copyPositions.length}</p>
            <p className={`text-xs ${pnlColor(totalUnrealizedPnl)}`}>
              {totalUnrealizedPnl >= 0 ? "+" : ""}{formatUSD(totalUnrealizedPnl)} unrealized
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
            <p className={`text-xl font-bold tabular-nums ${copyWinRate >= 0.5 ? "text-green-400" : copyWinRate > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
              {closedPerf.length > 0 ? `${(copyWinRate * 100).toFixed(0)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">{closedPerf.length} closed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Traders</p>
            </div>
            <p className="text-xl font-bold tabular-nums">{enabledTraders.length}</p>
            <p className="text-xs text-muted-foreground">{disabledTraders.length} disabled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <Signal className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Signals</p>
            </div>
            <p className="text-xl font-bold tabular-nums text-green-400">{executedSignals.length}</p>
            <p className="text-xs text-muted-foreground">{skippedSignals.length} skipped</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Open Copy Positions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CircleDot className="h-4 w-4" />
                Open Copy Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!positions ? (
                <LoadingSkeleton count={3} />
              ) : copyPositions.length === 0 ? (
                <EmptyState icon={CircleDot} message="No open copy positions" />
              ) : (
                <div className="space-y-2">
                  {copyPositions.map((pos) => (
                    <div key={pos._id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{pos.question}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Badge
                              variant="outline"
                              className={`text-xs ${pos.side === "yes" ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}`}
                            >
                              {pos.side.toUpperCase()}
                            </Badge>
                            <span>{formatUSD(pos.size)} @ {(pos.avgEntryPrice * 100).toFixed(1)}c</span>
                            <span>Now: {(pos.currentPrice * 100).toFixed(1)}c</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`font-mono font-bold text-sm ${pnlColor(pos.unrealizedPnl)}`}>
                            {pos.unrealizedPnl >= 0 ? "+" : ""}{formatUSD(pos.unrealizedPnl)}
                          </p>
                          <p className="text-xs text-muted-foreground">{timeAgo(pos.openedAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Bot Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!actions ? (
                <LoadingSkeleton count={5} />
              ) : copyActions.length === 0 ? (
                <EmptyState icon={Activity} message="No copy trade activity yet" />
              ) : (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {copyActions.slice(0, 15).map((action) => (
                    <div key={action._id} className="flex items-start gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                      <ActionIcon type={action.type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{action.summary}</p>
                        <p className="text-muted-foreground">{timeAgo(action.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Performing Traders (by your copy P&L) */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                Trader Copy Performance (Your P&L)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!traders ? (
                <LoadingSkeleton count={3} />
              ) : (
                <TraderPerfTable traders={enabledTraders} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Traders Tab */}
      {tab === "traders" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              All Tracked Traders ({traders?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!traders ? (
              <LoadingSkeleton count={8} />
            ) : traders.length === 0 ? (
              <EmptyState icon={Users} message="No traders tracked yet. Enable the bot to discover top traders from the Polymarket leaderboard." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 px-2">#</th>
                      <th className="text-left py-2 px-2">Trader</th>
                      <th className="text-right py-2 px-2">Score</th>
                      <th className="text-right py-2 px-2">ROI</th>
                      <th className="text-right py-2 px-2">Win Rate</th>
                      <th className="text-right py-2 px-2">Consistency</th>
                      <th className="text-right py-2 px-2">PnL</th>
                      <th className="text-right py-2 px-2">Volume</th>
                      <th className="text-right py-2 px-2">Copy P&L</th>
                      <th className="text-right py-2 px-2">Copies</th>
                      <th className="text-right py-2 px-2">Status</th>
                      <th className="text-right py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traders.map((trader, idx) => (
                      <tr key={trader.address} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2.5 px-2 text-muted-foreground text-xs">#{idx + 1}</td>
                        <td className="py-2.5 px-2">
                          <div>
                            <span className="font-medium">{trader.username}</span>
                            <span className="text-xs text-muted-foreground ml-1.5">
                              {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                            </span>
                          </div>
                        </td>
                        <td className={`py-2.5 px-2 text-right font-mono font-bold ${scoreColor(trader.decayedScore ?? trader.compositeScore)}`}>
                          {(trader.decayedScore ?? trader.compositeScore).toFixed(3)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono">
                          {trader.roi != null ? `${(trader.roi * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono">
                          {trader.realWinRate != null ? `${(trader.realWinRate * 100).toFixed(0)}%` : `${(trader.winRate * 100).toFixed(0)}%`}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono">
                          {trader.consistency != null ? trader.consistency.toFixed(2) : "—"}
                        </td>
                        <td className={`py-2.5 px-2 text-right ${pnlColor(trader.pnl)}`}>
                          {formatUSD(trader.pnl)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-muted-foreground">{formatUSD(trader.volume)}</td>
                        <td className={`py-2.5 px-2 text-right font-mono font-bold ${pnlColor(trader.copyPnl ?? 0)}`}>
                          {trader.copyPnl != null ? `${trader.copyPnl >= 0 ? "+" : ""}${formatUSD(trader.copyPnl)}` : "—"}
                        </td>
                        <td className="py-2.5 px-2 text-right text-muted-foreground">
                          {trader.copyTradeCount ?? 0}
                          {trader.copyWinCount != null && trader.copyTradeCount ? (
                            <span className="text-xs ml-0.5">
                              ({((trader.copyWinCount / trader.copyTradeCount) * 100).toFixed(0)}%W)
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {trader.enabled ? (
                            <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">
                              {trader.disabledReason ? trader.disabledReason.slice(0, 15) : "disabled"}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => toggleTrader({ address: trader.address, enabled: !trader.enabled })}
                              className="p-1 rounded hover:bg-muted transition-colors"
                              title={trader.enabled ? "Disable" : "Enable"}
                            >
                              {trader.enabled ? (
                                <Eye className="h-3.5 w-3.5 text-green-400" />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                            <button
                              onClick={() => removeTrader({ address: trader.address })}
                              className="p-1 rounded hover:bg-muted transition-colors"
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Signals Tab */}
      {tab === "signals" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Signal className="h-5 w-5" />
              Copy-Trade Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!signals ? (
              <LoadingSkeleton count={5} />
            ) : signals.length === 0 ? (
              <EmptyState icon={Signal} message="No signals yet. Signals appear when top traders buy the same side of a market." />
            ) : (
              <div className="space-y-2">
                {signals.map((signal) => (
                  <div
                    key={signal._id}
                    className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{signal.question}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs">
                          <Badge
                            variant="outline"
                            className={`text-xs ${signal.side === "buy_yes" ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}`}
                          >
                            {signal.side === "buy_yes" ? "BUY YES" : "BUY NO"}
                          </Badge>
                          <span className="text-muted-foreground">
                            {formatUSD(signal.suggestedSize)} @ {(signal.price * 100).toFixed(1)}c
                          </span>
                          <span className="text-muted-foreground">
                            {signal.traderCount} trader{signal.traderCount !== 1 ? "s" : ""}
                          </span>
                          <span className="text-muted-foreground">
                            {(signal.consensus * 100).toFixed(0)}% consensus
                          </span>
                          <span className="text-muted-foreground">
                            score: {signal.avgTraderScore.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{signal.reasoning}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <SignalStatusBadge status={signal.status} />
                        <p className="text-xs text-muted-foreground mt-1">
                          {signal.createdAt ? timeAgo(signal.createdAt) : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Activity Tab */}
      {tab === "activity" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Trader Activity Feed
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!recentActivity ? (
              <LoadingSkeleton count={8} />
            ) : recentActivity.length === 0 ? (
              <EmptyState icon={Zap} message="No trader activity detected yet." />
            ) : (
              <div className="space-y-1.5">
                {recentActivity.map((act) => (
                  <div
                    key={act._id}
                    className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {act.traderAddress.slice(0, 6)}...{act.traderAddress.slice(-4)}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            act.side === "buy_yes" ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"
                          }`}
                        >
                          {act.side === "buy_yes" ? "BUY YES" : "BUY NO"}
                        </Badge>
                        <span className="text-muted-foreground text-xs">{formatUSD(act.size)}</span>
                        <span className="text-muted-foreground text-xs">@ {(act.price * 100).toFixed(1)}c</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{act.question}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {act.copied && (
                        <Badge className="bg-green-600 text-xs">Copied</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{timeAgo(act.detectedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bot Log Tab */}
      {tab === "log" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Copy Trade Bot Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!actions ? (
              <LoadingSkeleton count={10} />
            ) : copyActions.length === 0 ? (
              <EmptyState icon={Clock} message="No bot activity logged yet." />
            ) : (
              <div className="space-y-1">
                {copyActions.map((action) => (
                  <div
                    key={action._id}
                    className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0 text-sm"
                  >
                    <ActionIcon type={action.type} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{action.summary}</p>
                      {action.cycleId && (
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{action.cycleId}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(action.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Sub-components ----

function LoadingSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ComponentType<{ className?: string }>; message: string }) {
  return (
    <div className="text-center py-10 text-muted-foreground">
      <Icon className="h-10 w-10 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ActionIcon({ type }: { type: string }) {
  switch (type) {
    case "copy_trade_execute":
      return <CheckCircle className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />;
    case "copy_exit":
      return <ArrowUpRight className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />;
    case "error":
      return <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />;
    default:
      return <CircleDot className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
  }
}

function SignalStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "executed":
      return <Badge className="bg-green-600 text-xs">Executed</Badge>;
    case "pending":
      return <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 text-xs">Pending</Badge>;
    case "skipped":
      return <Badge variant="secondary" className="text-xs">Skipped</Badge>;
    case "expired":
      return <Badge variant="secondary" className="text-muted-foreground text-xs">Expired</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function TraderPerfTable({ traders }: { traders: any[] }) {
  // Sort by copy P&L descending
  const sorted = [...traders]
    .filter((t) => (t.copyTradeCount ?? 0) > 0)
    .sort((a, b) => (b.copyPnl ?? 0) - (a.copyPnl ?? 0));

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No copy trade data yet. Performance will appear after the bot executes copy trades.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground text-xs">
            <th className="text-left py-2 px-2">Trader</th>
            <th className="text-right py-2 px-2">Your Copy P&L</th>
            <th className="text-right py-2 px-2">Copy Trades</th>
            <th className="text-right py-2 px-2">Copy Win Rate</th>
            <th className="text-right py-2 px-2">Trader Score</th>
            <th className="text-right py-2 px-2">Trader ROI</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const copyWR = t.copyTradeCount > 0 ? (t.copyWinCount ?? 0) / t.copyTradeCount : 0;
            return (
              <tr key={t.address} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2.5 px-2 font-medium">{t.username}</td>
                <td className={`py-2.5 px-2 text-right font-mono font-bold ${pnlColor(t.copyPnl ?? 0)}`}>
                  {(t.copyPnl ?? 0) >= 0 ? "+" : ""}{formatUSD(t.copyPnl ?? 0)}
                </td>
                <td className="py-2.5 px-2 text-right">{t.copyTradeCount ?? 0}</td>
                <td className={`py-2.5 px-2 text-right ${copyWR >= 0.5 ? "text-green-400" : "text-red-400"}`}>
                  {(copyWR * 100).toFixed(0)}%
                </td>
                <td className={`py-2.5 px-2 text-right font-mono ${scoreColor(t.decayedScore ?? t.compositeScore)}`}>
                  {(t.decayedScore ?? t.compositeScore).toFixed(3)}
                </td>
                <td className="py-2.5 px-2 text-right font-mono">
                  {t.roi != null ? `${(t.roi * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
