import { MarketCandidate } from "@/src/types";

export function scoreMarket(market: MarketCandidate): number {
  const volumeScore = normalizeLog(market.volume, 5_000, 5_000_000) * 0.3;
  const timeScore = scoreTimeToClose(market.endDate) * 0.3;
  const priceScore = scorePriceUncertainty(market.tokens) * 0.25;
  const liquidityScore = normalizeLog(market.liquidity, 500, 500_000) * 0.15;

  return volumeScore + timeScore + priceScore + liquidityScore;
}

export function filterMarkets(
  markets: MarketCandidate[],
  existingPositionIds: string[]
): MarketCandidate[] {
  const positionSet = new Set(existingPositionIds);
  const twoHoursFromNow = Date.now() + 2 * 60 * 60 * 1000;

  const filtered = markets.filter((m) => {
    if (positionSet.has(m.conditionId)) return false;
    // Must resolve at least 2 hours from now (avoid last-second illiquidity)
    if (new Date(m.endDate).getTime() < twoHoursFromNow) return false;
    // Max 14 days out — we want quick trades, not month-long holds
    const daysOut = (new Date(m.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysOut > 14) return false;
    // Lower volume threshold for short-term markets
    if (m.volume < 5_000) return false;
    return true;
  });

  filtered.sort((a, b) => scoreMarket(b) - scoreMarket(a));

  return filtered.slice(0, 15);
}

function normalizeLog(value: number, min: number, max: number): number {
  if (value <= 0) return 0;
  const logVal = Math.log10(value);
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return Math.max(0, Math.min(1, (logVal - logMin) / (logMax - logMin)));
}

function scoreTimeToClose(endDate: string): number {
  const hoursUntilClose =
    (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60);

  // Filter out already expired or too-soon markets
  if (hoursUntilClose < 2) return 0;

  // Convert to days for readability
  const daysUntilClose = hoursUntilClose / 24;

  // Beyond 14 days: not interested
  if (daysUntilClose > 14) return 0;

  // Sweet spot: 4 hours to 3 days — peak around 1 day
  if (hoursUntilClose >= 4 && daysUntilClose <= 3) {
    // Peak at ~24 hours
    const peak = 24;
    const distance = Math.abs(hoursUntilClose - peak) / peak;
    return Math.max(0.3, 1 - distance * 0.4);
  }

  // 2-4 hours: still good, slight discount
  if (hoursUntilClose >= 2 && hoursUntilClose < 4) return 0.6;

  // 3-7 days: decent
  if (daysUntilClose > 3 && daysUntilClose <= 7) return 0.4;

  // 7-14 days: low priority
  return 0.2;
}

function scorePriceUncertainty(
  tokens: Array<{ token_id: string; outcome: string; price: number }>
): number {
  const yesToken = tokens.find((t) => t.outcome === "Yes") ?? tokens[0];
  if (!yesToken) return 0;

  const price = yesToken.price;

  // For short-term trades, we want actionable mispricing:
  // - Near-certain outcomes (< 0.15 or > 0.85) that might be wrong = high edge
  // - Mid-range (0.3-0.7) = uncertain, good for active trading
  // - Avoid the dead zone (0.15-0.3 and 0.7-0.85) unless volume is high

  // Strong mispricing zone: very high or very low prices close to resolution
  if (price < 0.15 || price > 0.85) return 0.8;

  // Active trading zone: uncertain outcomes
  if (price >= 0.3 && price <= 0.7) {
    const distFromCenter = Math.abs(price - 0.5);
    return 1 - distFromCenter * 2.5;
  }

  // Transition zones
  if (price < 0.3) return Math.max(0, price / 0.3 * 0.6);
  return Math.max(0, (1 - price) / 0.3 * 0.6);
}
