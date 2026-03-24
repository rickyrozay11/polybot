export const SYSTEM_PROMPT = `You are an autonomous prediction market trading agent on Polymarket, powered by a multi-model ensemble.

Your PRIMARY strategy is COPY-TRADING: mirroring the positions of the best traders on Polymarket, entering and exiting when they do.

Your SECONDARY strategy is short-term autonomous trading: finding mispriced markets through research and capitalizing on price movements.

You are NOT waiting for markets to resolve. You TRADE THE PRICE — buy when the price is moving in your favor, sell when you've hit your target or when the trade goes against you. Think of prediction markets like a stock: buy low, sell high, don't hold to expiry.

Key principles:
- COPY TRADING IS KING. When top traders are buying, you buy. When they sell, you sell. Their edge is your edge.
- Trade the price movement, not the outcome. A market at 60% that moves to 70% is a 16.7% return — you don't need to wait for resolution.
- Take profits aggressively. A 10-15% gain in hours is excellent. Don't get greedy waiting for resolution.
- Cut losses fast. If a position drops 10% from entry, exit. Capital preservation beats being right eventually.
- Favor high-volume, high-liquidity markets where you can enter and exit quickly.
- Speed matters. Copy trades within minutes of detection, not hours.
- For autonomous trades: look for news-driven momentum, not long-term thesis plays.
- Multiple top traders buying the same side = strongest signal. One trader alone = weaker but still actionable if their score is high.`;

export function screeningPrompt(
  markets: Array<{
    conditionId: string;
    question: string;
    yesPrice: number;
    volume: number;
  }>
): string {
  const marketList = markets
    .map(
      (m, i) =>
        `${i + 1}. [${m.conditionId}] "${m.question}" — YES: ${(m.yesPrice * 100).toFixed(1)}% — Volume: $${m.volume.toLocaleString()}`
    )
    .join("\n");

  return `Here are active prediction markets. You're looking for SHORT-TERM price trading opportunities — NOT long-term resolution bets.

${marketList}

Pick the top 3-5 markets where you see an opportunity to TRADE THE PRICE (buy now, sell soon at a profit):
- Is there news or momentum that will move the price in the next hours/days?
- Is the market liquid enough to enter and exit quickly?
- Is the price at an inflection point (about to move sharply)?
- Are top traders active in this market?

Respond with JSON:
{"markets": [{"conditionId": "0x...", "preliminaryConfidence": 0.65, "reasoning": "..."}]}

Confidence reflects how likely the price will move in your predicted direction SOON, not whether you know the final outcome.`;
}

export function researchSynthesisPrompt(
  question: string,
  webResults: string,
  socialSentiment: string,
  perplexityAnalysis: string,
  orderbook: string
): string {
  return `Research this market for a SHORT-TERM price trade (not a resolution bet):

"${question}"

## Web Search Results
${webResults || "No results available."}

## Social Sentiment
${socialSentiment || "No data available."}

## AI Analysis (Perplexity)
${perplexityAnalysis || "No analysis available."}

## Orderbook Data
${orderbook || "No orderbook data available."}

Focus on:
1. What recent news/events could move the price in the next hours-days?
2. Which direction is the price likely to move? By how much?
3. What's the current market sentiment — is momentum building?
4. Is there enough liquidity to enter AND exit?
5. Your confidence (0-1) that the price will move in your predicted direction within 1-3 days.

Use tools to find the LATEST developments. Stale info = losing trades.`;
}

export function tradeDecisionPrompt(
  question: string,
  currentYesPrice: number,
  currentNoPrice: number,
  researchSynthesis: string,
  tokenIds: { yes: string; no: string }
): string {
  return `Make a trading decision. You're TRADING THE PRICE, not betting on resolution.

Question: "${question}"
Current YES price: ${(currentYesPrice * 100).toFixed(1)}% ($${currentYesPrice.toFixed(2)})
Current NO price: ${(currentNoPrice * 100).toFixed(1)}% ($${currentNoPrice.toFixed(2)})
YES token ID: ${tokenIds.yes}
NO token ID: ${tokenIds.no}

## Research
${researchSynthesis}

Respond with JSON only:
{
  "action": "buy_yes" | "buy_no" | "skip",
  "tokenId": "<token ID to buy, or empty string if skip>",
  "confidence": <0.0-1.0>,
  "reasoning": "<what will move the price and when?>",
  "suggestedSize": <USD, max $25>,
  "suggestedPrice": <current price of token you're buying>,
  "takeProfitPct": <target gain % to auto-exit, e.g. 0.15 for 15%>,
  "stopLossPct": <max loss % to auto-exit, e.g. 0.10 for 10%>
}

Rules:
- Only trade if confidence > 0.55 and you see near-term price momentum.
- "buy_yes" = you think YES price will GO UP soon.
- "buy_no" = you think YES price will GO DOWN soon (NO price goes up).
- Set takeProfitPct between 0.08-0.20 (8-20% gain target).
- Set stopLossPct between 0.08-0.15 (8-15% max loss).
- Size by confidence: high (>0.8) = $15-25, medium (0.6-0.8) = $5-15, low = $2-5.
- Skip if no clear short-term catalyst.`;
}
