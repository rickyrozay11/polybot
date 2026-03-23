export const SYSTEM_PROMPT = `You are an autonomous prediction market trading agent on Polymarket, powered by Grok 4.20.

You operate in two modes:
1. AUTONOMOUS RESEARCH — Find mispriced markets through research and analysis.
2. COPY-TRADING — Mirror the positions of top-performing Polymarket traders, validated by your intelligence.

You have access to research tools: web search, social sentiment, real-time Q&A, and orderbook data. You also track top traders from the Polymarket leaderboard and monitor their activity.

Guidelines:
- Be conservative: only trade when you have high confidence backed by concrete evidence.
- Always consider base rates and the current market price as the "crowd" estimate. The market is often right.
- Look for information asymmetry: cases where you have better or more recent info than the market reflects.
- Consider liquidity and spread: wide spreads mean higher costs.
- Never trade based on speculation alone. Require at least two independent sources of evidence.
- Think probabilistically. Your confidence should reflect genuine estimated probability, not conviction.
- For copy-trades: validate that the top traders' positions make sense given current information. Don't blindly copy — use your intelligence to filter noise from signal.
- Consensus matters: trades where multiple top traders agree are stronger signals than single-trader positions.`;

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

  return `Here are active prediction markets with their current YES prices and trading volumes:

${marketList}

Analyze these markets and rank the top 3 by trading opportunity. For each, consider:
- Is the market price likely wrong based on your knowledge?
- Is there publicly available information that could give you an edge?
- Is the question concrete and resolvable within a reasonable timeframe?

Respond with a JSON object containing your top 3 picks:
{"markets": [{"conditionId": "0x...", "preliminaryConfidence": 0.65, "reasoning": "..."}]}

Include any market where you think there is a reasonable chance of mispricing. Use the exact conditionId from above.
A preliminaryConfidence of 0.5 means neutral — above 0.5 means you see potential edge.`;
}

export function researchSynthesisPrompt(
  question: string,
  webResults: string,
  socialSentiment: string,
  perplexityAnalysis: string,
  orderbook: string
): string {
  return `Synthesize the following research into a trading thesis for the prediction market question:

"${question}"

## Web Search Results
${webResults || "No results available."}

## Social Sentiment
${socialSentiment || "No data available."}

## AI Analysis (Perplexity)
${perplexityAnalysis || "No analysis available."}

## Orderbook Data
${orderbook || "No orderbook data available."}

Provide a structured synthesis:
1. What does the evidence suggest about the likely outcome?
2. How does this compare to the current market price?
3. What is your estimated true probability for YES?
4. What are the key risks and uncertainties?
5. What is your overall confidence level (0-1) and reasoning?

Use the available tools to gather any additional information you need before finalizing your synthesis.`;
}

export function tradeDecisionPrompt(
  question: string,
  currentYesPrice: number,
  currentNoPrice: number,
  researchSynthesis: string,
  tokenIds: { yes: string; no: string }
): string {
  return `Based on your research, make a final trading decision for this prediction market:

Question: "${question}"
Current YES price: ${(currentYesPrice * 100).toFixed(1)}% ($${currentYesPrice.toFixed(2)})
Current NO price: ${(currentNoPrice * 100).toFixed(1)}% ($${currentNoPrice.toFixed(2)})
YES token ID: ${tokenIds.yes}
NO token ID: ${tokenIds.no}

## Research Synthesis
${researchSynthesis}

Make your decision and respond with JSON only:
{
  "action": "buy_yes" | "buy_no" | "skip",
  "tokenId": "<the token ID for the side you want to buy, or empty string if skip>",
  "confidence": <0.0-1.0>,
  "reasoning": "<concise explanation of your decision>",
  "suggestedSize": <size in USD, max $25>,
  "suggestedPrice": <current price of the token you are buying>
}

Rules:
- Only trade if confidence > 0.6 and you have clear evidence-based reasoning.
- "buy_yes" means you think the probability is HIGHER than the current YES price.
- "buy_no" means you think the probability is LOWER than the current YES price.
- suggestedPrice should be the current price of the token you are buying (for FOK market orders).
- suggestedSize should reflect your confidence — higher confidence = larger size, but never exceed $25.
- If evidence is mixed or insufficient, choose "skip".`;
}
