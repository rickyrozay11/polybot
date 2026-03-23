"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  TrendingUp,
  Signal,
  Trophy,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

function formatUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
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

export default function CopyTradePage() {
  const traders = useQuery(api.trackedTraders.listTraders);
  const signals = useQuery(api.trackedTraders.listSignals, { status: undefined });
  const recentActivity = useQuery(api.trackedTraders.recentTraderActivity, { limit: 30 });
  const toggleTrader = useMutation(api.trackedTraders.toggleTrader);
  const removeTrader = useMutation(api.trackedTraders.removeTrader);

  const [tab, setTab] = useState<"traders" | "signals" | "activity">("traders");

  const enabledCount = traders?.filter((t) => t.enabled).length ?? 0;
  const executedSignals = signals?.filter((s) => s.status === "executed").length ?? 0;
  const pendingSignals = signals?.filter((s) => s.status === "pending").length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          Copy Trading
        </h1>
        <Badge variant="outline" className="text-sm">
          Powered by Grok 4.20
        </Badge>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Tracked Traders</p>
            </div>
            <p className="text-2xl font-bold tabular-nums">{traders?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">{enabledCount} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Signal className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Signals</p>
            </div>
            <p className="text-2xl font-bold tabular-nums">{signals?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">{pendingSignals} pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Executed</p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-green-400">{executedSignals}</p>
            <p className="text-xs text-muted-foreground">copy trades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Top Score</p>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {traders && traders.length > 0 ? traders[0].compositeScore.toFixed(3) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {traders && traders.length > 0 ? traders[0].username : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["traders", "signals", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Traders Tab */}
      {tab === "traders" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Tracked Traders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!traders ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : traders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No traders tracked yet.</p>
                <p className="text-sm mt-1">
                  Enable the bot and it will automatically discover top traders from the Polymarket leaderboard.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 px-2">Rank</th>
                      <th className="text-left py-2 px-2">Trader</th>
                      <th className="text-right py-2 px-2">Score</th>
                      <th className="text-right py-2 px-2">PnL</th>
                      <th className="text-right py-2 px-2">Volume</th>
                      <th className="text-right py-2 px-2">Win Rate</th>
                      <th className="text-right py-2 px-2">Source</th>
                      <th className="text-right py-2 px-2">Updated</th>
                      <th className="text-right py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traders.map((trader, idx) => (
                      <tr key={trader.address} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-3 px-2 text-muted-foreground">#{idx + 1}</td>
                        <td className="py-3 px-2">
                          <div>
                            <span className="font-medium">{trader.username}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                            </span>
                          </div>
                        </td>
                        <td className={`py-3 px-2 text-right font-mono font-bold ${scoreColor(trader.compositeScore)}`}>
                          {trader.compositeScore.toFixed(3)}
                        </td>
                        <td className={`py-3 px-2 text-right ${trader.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {formatUSD(trader.pnl)}
                        </td>
                        <td className="py-3 px-2 text-right text-muted-foreground">{formatUSD(trader.volume)}</td>
                        <td className="py-3 px-2 text-right">
                          {(trader.winRate * 100).toFixed(0)}%
                        </td>
                        <td className="py-3 px-2 text-right">
                          <Badge variant="outline" className="text-xs">{trader.source}</Badge>
                        </td>
                        <td className="py-3 px-2 text-right text-xs text-muted-foreground">
                          {timeAgo(trader.lastUpdated)}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => toggleTrader({ address: trader.address, enabled: !trader.enabled })}
                              className="p-1.5 rounded hover:bg-muted transition-colors"
                              title={trader.enabled ? "Disable tracking" : "Enable tracking"}
                            >
                              {trader.enabled ? (
                                <Eye className="h-4 w-4 text-green-400" />
                              ) : (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              )}
                            </button>
                            <button
                              onClick={() => removeTrader({ address: trader.address })}
                              className="p-1.5 rounded hover:bg-muted transition-colors"
                              title="Remove trader"
                            >
                              <Trash2 className="h-4 w-4 text-red-400" />
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
            <CardTitle className="text-lg flex items-center gap-2">
              <Signal className="h-5 w-5" />
              Copy-Trade Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!signals ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : signals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Signal className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No signals generated yet.</p>
                <p className="text-sm mt-1">
                  Signals appear when multiple top traders buy the same side of a market.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {signals.map((signal) => (
                  <div
                    key={signal._id}
                    className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{signal.question}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className={signal.side === "buy_yes" ? "text-green-400" : "text-red-400"}>
                            {signal.side === "buy_yes" ? "YES" : "NO"}
                          </span>
                          <span>Size: {formatUSD(signal.suggestedSize)}</span>
                          <span>Price: {(signal.price * 100).toFixed(1)}%</span>
                          <span>Traders: {signal.traderCount}</span>
                          <span>Consensus: {(signal.consensus * 100).toFixed(0)}%</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">{signal.reasoning}</p>
                      </div>
                      <Badge
                        variant={
                          signal.status === "executed"
                            ? "default"
                            : signal.status === "pending"
                              ? "outline"
                              : "secondary"
                        }
                        className={`shrink-0 ${
                          signal.status === "executed" ? "bg-green-600" : ""
                        }`}
                      >
                        {signal.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {signal.createdAt ? timeAgo(signal.createdAt) : "—"}
                    </p>
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
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Trader Activity Feed
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!recentActivity ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <RefreshCw className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No trader activity detected yet.</p>
                <p className="text-sm mt-1">
                  Activity will appear when tracked traders make new trades on Polymarket.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentActivity.map((activity) => (
                  <div
                    key={activity._id}
                    className="flex items-center justify-between rounded-md border p-3 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {activity.traderAddress.slice(0, 6)}...{activity.traderAddress.slice(-4)}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            activity.side === "buy_yes" ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"
                          }`}
                        >
                          {activity.side === "buy_yes" ? "BUY YES" : "BUY NO"}
                        </Badge>
                        <span className="text-muted-foreground">{formatUSD(activity.size)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{activity.question}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {activity.copied && (
                        <Badge className="bg-green-600 text-xs">Copied</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{timeAgo(activity.detectedAt)}</span>
                    </div>
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
