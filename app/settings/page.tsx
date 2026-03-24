"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ConfigField {
  key: string;
  label: string;
  type: "text" | "number" | "toggle";
  description: string;
}

const configFields: ConfigField[] = [
  { key: "maxTradeSize", label: "Max Trade Size ($)", type: "number", description: "Maximum dollar amount per trade" },
  { key: "maxTotalExposure", label: "Max Total Exposure ($)", type: "number", description: "Maximum total portfolio exposure" },
  { key: "minConfidence", label: "Min Confidence", type: "number", description: "Minimum confidence score to trade (0-1)" },
  { key: "modelId", label: "Model ID", type: "text", description: "OpenAI model to use for research" },
  { key: "runIntervalMinutes", label: "Run Interval (min)", type: "number", description: "Minutes between bot cycles" },
  { key: "enabled", label: "Bot Enabled", type: "toggle", description: "Enable or disable the trading bot" },
  { key: "copyTradeOnly", label: "Copy Trade Only", type: "toggle", description: "Only run copy-trading — disable autonomous research trading" },
  { key: "copyTrade247", label: "Copy Trade 24/7", type: "toggle", description: "Continuous scanning — re-runs every 30s instead of every 3 min" },
  { key: "dryRun", label: "Dry Run Mode", type: "toggle", description: "Simulate trades without execution" },
];

function formatUSD(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function SettingsPage() {
  const allConfig = useQuery(api.config.getAllConfig);
  const setConfig = useMutation(api.config.setConfig);
  const wallet = useQuery(api.wallet.getWallet);
  const resetWallet = useMutation(api.wallet.resetWallet);
  const initWallet = useMutation(api.wallet.initWallet);

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetAmount, setResetAmount] = useState("500");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (allConfig) {
      const map: Record<string, string> = {};
      for (const entry of allConfig) {
        map[entry.key] = entry.value;
      }
      setValues(map);
    }
  }, [allConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        configFields.map((field) => {
          const value = values[field.key];
          if (value !== undefined) {
            return setConfig({ key: field.key, value });
          }
        })
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleResetWallet = async () => {
    setResetting(true);
    try {
      const amount = parseFloat(resetAmount) || 500;
      await resetWallet({ balance: amount });
    } finally {
      setResetting(false);
    }
  };

  const handleInitWallet = async () => {
    setResetting(true);
    try {
      const amount = parseFloat(resetAmount) || 500;
      await initWallet({ initialBalance: amount });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Wallet Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mock Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {wallet ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Cash Balance</p>
                  <p className="text-xl font-semibold text-green-400">{formatUSD(wallet.balance)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Invested</p>
                  <p className="text-xl font-semibold">{formatUSD(wallet.totalInvested)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Realized P&L</p>
                  <p className={`text-xl font-semibold ${wallet.realizedPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatUSD(wallet.realizedPnl)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Trade Count</p>
                  <p className="text-xl font-semibold tabular-nums">{wallet.tradeCount}</p>
                </div>
              </div>

              <div className="flex items-end gap-3 pt-4 border-t">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Reset Balance ($)</label>
                  <input
                    type="number"
                    value={resetAmount}
                    onChange={(e) => setResetAmount(e.target.value)}
                    className="w-32 rounded-md border bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <Button variant="destructive" onClick={handleResetWallet} disabled={resetting}>
                  {resetting ? "Resetting..." : "Reset Wallet"}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No wallet initialized. Create one to start tracking mock trades.
              </p>
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Starting Balance ($)</label>
                  <input
                    type="number"
                    value={resetAmount}
                    onChange={(e) => setResetAmount(e.target.value)}
                    className="w-32 rounded-md border bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <Button onClick={handleInitWallet} disabled={resetting}>
                  {resetting ? "Creating..." : "Create Wallet"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bot Config Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bot Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {allConfig === undefined ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <>
              {configFields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-sm font-medium">{field.label}</label>
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                  {field.type === "toggle" ? (
                    <button
                      role="switch"
                      aria-checked={values[field.key] === "true"}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        values[field.key] === "true" ? "bg-green-600" : "bg-muted"
                      }`}
                      onClick={() =>
                        setValues({
                          ...values,
                          [field.key]: values[field.key] === "true" ? "false" : "true",
                        })
                      }
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                          values[field.key] === "true" ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  ) : (
                    <input
                      type={field.type}
                      value={values[field.key] ?? ""}
                      onChange={(e) =>
                        setValues({ ...values, [field.key]: e.target.value })
                      }
                      className="w-full rounded-md border bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                </div>
              ))}

              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
                {saved && (
                  <span className="text-sm text-green-400">Settings saved</span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
