/**
 * Polymarket Data API client — for leaderboard, trader activity, and position tracking.
 * Base URL: https://data-api.polymarket.com
 *
 * This is the best API for copy-trading because it exposes:
 * - Leaderboard rankings (PnL, volume, win rate)
 * - Individual trader activity (trades, splits, merges, redemptions)
 * - Trader positions
 */

import { withRetry } from "@/src/lib/retry";

const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

// ----- Types -----

export interface LeaderboardEntry {
  address: string;
  username: string;
  profileImage?: string;
  profit: number;
  volume: number;
  marketsTraded: number;
  positions: number;
}

export interface TraderActivityItem {
  conditionId: string;
  asset: string; // token ID
  side: "BUY" | "SELL";
  size: string;
  price: string;
  type: "TRADE" | "SPLIT" | "MERGE" | "REDEEM";
  timestamp: string;
  transactionHash?: string;
  title?: string;
  slug?: string;
  outcome?: string;
}

export interface TraderPosition {
  conditionId: string;
  asset: string;
  size: string;
  avgPrice: string;
  currentPrice?: string;
  title?: string;
  outcome?: string;
  side?: string;
}

// ----- Leaderboard -----

export async function fetchLeaderboard(
  period: "1d" | "7d" | "30d" | "all" = "7d",
  limit = 50
): Promise<LeaderboardEntry[]> {
  // Map old period format to new API format
  const timePeriodMap: Record<string, string> = {
    "1d": "DAY",
    "7d": "WEEK",
    "30d": "MONTH",
    "all": "ALL",
  };
  const timePeriod = timePeriodMap[period] ?? "WEEK";

  // Try multiple endpoint formats (Polymarket changes these)
  const urls = [
    `${DATA_API_BASE}/v1/leaderboard?timePeriod=${timePeriod}&orderBy=PNL&limit=${limit}&category=OVERALL`,
    `${DATA_API_BASE}/leaderboard?timePeriod=${timePeriod}&orderBy=PNL&limit=${limit}`,
    `${DATA_API_BASE}/ranked?window=${period}&limit=${limit}`,
    `${DATA_API_BASE}/leaderboard?window=${period}&limit=${limit}&sortBy=profit`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const parsed = parseLeaderboardResponse(data);
      if (parsed.length > 0) return parsed;
    } catch {
      continue;
    }
  }

  // All endpoints failed
  console.warn("[polymarket-data-api] All leaderboard endpoints failed");
  return [];
}

function parseLeaderboardResponse(data: any): LeaderboardEntry[] {
  // The API returns different shapes depending on endpoint version
  const entries: any[] = Array.isArray(data)
    ? data
    : data?.leaderboard ?? data?.rankings ?? data?.data ?? data?.results ?? data?.traders ?? [];

  return entries.map((e: any) => ({
    address: e.proxyWallet ?? e.address ?? e.wallet ?? "",
    username: e.userName ?? e.username ?? e.displayName ?? e.name ?? truncateAddress(e.proxyWallet ?? e.address ?? ""),
    profileImage: e.profileImage ?? e.avatar ?? undefined,
    profit: parseFloat(e.pnl ?? e.profit ?? e.totalProfit ?? "0"),
    volume: parseFloat(e.vol ?? e.volume ?? e.totalVolume ?? "0"),
    marketsTraded: parseInt(e.marketsTraded ?? e.numMarkets ?? "0"),
    positions: parseInt(e.positions ?? e.numPositions ?? "0"),
  }));
}

// ----- Trader Activity -----

export async function fetchTraderActivity(
  address: string,
  limit = 50
): Promise<TraderActivityItem[]> {
  return withRetry(
    async () => {
      const url = `${DATA_API_BASE}/activity?user=${address}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Activity API error: ${res.status}`);

      const data = await res.json();
      const items: any[] = Array.isArray(data) ? data : data?.activity ?? data?.data ?? [];

      return items.map((item: any) => ({
        conditionId: item.conditionId ?? item.condition_id ?? "",
        asset: item.asset ?? item.tokenId ?? item.token_id ?? "",
        side: item.side ?? "BUY",
        size: String(item.size ?? item.amount ?? "0"),
        price: String(item.price ?? "0"),
        type: item.type ?? "TRADE",
        timestamp: item.timestamp ?? item.createdAt ?? new Date().toISOString(),
        transactionHash: item.transactionHash ?? item.txHash,
        title: item.title ?? item.question ?? item.marketTitle,
        slug: item.slug,
        outcome: item.outcome,
      }));
    },
    { label: `fetch-activity-${address.slice(0, 8)}`, maxRetries: 2 }
  );
}

// ----- Trader Positions -----

export async function fetchTraderPositions(address: string): Promise<TraderPosition[]> {
  return withRetry(
    async () => {
      const url = `${DATA_API_BASE}/positions?user=${address}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Positions API error: ${res.status}`);

      const data = await res.json();
      const positions: any[] = Array.isArray(data) ? data : data?.positions ?? data?.data ?? [];

      return positions
        .filter((p: any) => parseFloat(p.size ?? p.amount ?? "0") > 0)
        .map((p: any) => ({
          conditionId: p.conditionId ?? p.condition_id ?? "",
          asset: p.asset ?? p.tokenId ?? p.token_id ?? "",
          size: String(p.size ?? p.amount ?? "0"),
          avgPrice: String(p.avgPrice ?? p.averagePrice ?? "0"),
          currentPrice: p.currentPrice ?? p.curPrice,
          title: p.title ?? p.question,
          outcome: p.outcome,
          side: p.side,
        }));
    },
    { label: `fetch-positions-${address.slice(0, 8)}`, maxRetries: 2 }
  );
}

// ----- CLOB Recent Trades (for whale detection) -----

export async function fetchRecentTrades(
  tokenId: string,
  limit = 100
): Promise<Array<{ side: string; size: number; price: number; timestamp: string }>> {
  return withRetry(
    async () => {
      const url = `${CLOB_BASE}/trades?token_id=${tokenId}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`CLOB trades API error: ${res.status}`);

      const data = await res.json();
      const trades: any[] = Array.isArray(data) ? data : data?.trades ?? data?.data ?? [];

      return trades.map((t: any) => ({
        side: t.side ?? "BUY",
        size: parseFloat(t.size ?? "0"),
        price: parseFloat(t.price ?? "0"),
        timestamp: t.timestamp ?? t.match_time ?? new Date().toISOString(),
      }));
    },
    { label: `fetch-recent-trades-${tokenId.slice(0, 8)}`, maxRetries: 2 }
  );
}

// ----- Helpers -----

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
