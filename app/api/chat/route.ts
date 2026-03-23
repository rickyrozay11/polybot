import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, UIMessage, convertToModelMessages, tool } from "ai";
import { z } from "zod";

export const maxDuration = 60;

const openrouter = createOpenAICompatible({
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
});

// Multi-model chat routing
const FAST_MODEL = "x-ai/grok-4.20-beta";
const HEAVY_MODEL = "anthropic/claude-opus-4-6";

function classifyComplexity(message: string): "fast" | "heavy" {
  const lower = message.toLowerCase();
  const fastPatterns = [
    /\bprice\b/, /\btrending\b/, /\bleaderboard\b/, /\bhow much\b/,
    /\bwhat is\b.*\btrading\b/, /\bget\b.*\bmarket/, /\bshow\b.*\bmarket/,
    /\blist\b/, /\btop\b.*\bmarkets/, /\borderbook\b/, /\bmidpoint\b/,
  ];
  const heavyPatterns = [
    /\bshould i\b/, /\banalyze\b/, /\banalysis\b/, /\bstrategy\b/,
    /\bwhy\b.*\b(price|market|odds)\b/, /\bcompare\b/, /\bexplain\b/,
    /\bsentiment\b/, /\brisk\b/, /\bportfolio\b/, /\bthink\b/,
    /\bpredict\b/, /\bforecast\b/, /\bedge\b/, /\bmispriced\b/,
    /\bcopy.?trad/, /\bwhale\b/, /\binsider\b/,
  ];

  if (heavyPatterns.some(p => p.test(lower))) return "heavy";
  if (fastPatterns.some(p => p.test(lower))) return "fast";
  return message.split(/\s+/).length > 20 ? "heavy" : "fast";
}

// ---- Polymarket API helpers ----

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";

async function fetchJSON(url: string): Promise<any> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { __error: true, message: `API error ${res.status}: ${url} — ${text.slice(0, 200)}` };
    }
    return await res.json();
  } catch (err: any) {
    return { __error: true, message: `Network error: ${err.message}` };
  }
}

function isApiError(data: any): data is { __error: true; message: string } {
  return data && data.__error === true;
}

export async function POST(req: Request) {
  try {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Determine which model to use based on message complexity
  const lastMessage = messages[messages.length - 1];
  let lastMessageText = '';
  if (lastMessage) {
    if (typeof lastMessage === 'string') {
      lastMessageText = lastMessage;
    } else if (typeof lastMessage === 'object' && lastMessage.parts) {
      lastMessageText = (lastMessage.parts as any[])
        .map((p: any) => (typeof p === 'string' ? p : p.text || ''))
        .join(' ');
    } else if (typeof lastMessage === 'object' && (lastMessage as any).text) {
      lastMessageText = (lastMessage as any).text;
    }
  }
  const complexity = classifyComplexity(lastMessageText);
  const selectedModel = complexity === "heavy" ? HEAVY_MODEL : FAST_MODEL;
  console.log(`[chat] Routing to ${complexity} model: ${selectedModel}`);

  const result = streamText({
    model: openrouter(selectedModel),
    system: `You are a Polymarket copy-trading assistant with LIVE access to Polymarket APIs. You are currently running as ${selectedModel} in ${complexity} mode.

You have tools to fetch real-time data:
- get_trending_markets: Get the hottest markets right now (volume, prices, liquidity)
- get_market_details: Look up any specific market by slug or keyword
- get_orderbook: Get live bid/ask data for any token
- get_leaderboard: See the top traders by profit
- get_market_price: Get the current price of any token

ALWAYS use your tools to fetch live data when the user asks about markets, prices, traders, or anything on Polymarket. Never say you don't have access — you DO. Call the tools first, then give your analysis.

Be concise and actionable. When showing market data, include prices as percentages (e.g. YES at 73.5%).`,
    messages: await convertToModelMessages(messages),
    tools: {
      get_trending_markets: tool({
        description: "Get the top trending prediction markets on Polymarket right now, sorted by volume. Returns market questions, prices, volume, and liquidity.",
        parameters: z.object({
          limit: z.number().optional().describe("Number of markets to return (default 10, max 50)"),
        }),
        execute: async ({ limit = 10 }) => {
          const data = await fetchJSON(`${GAMMA_API}/events?active=true&closed=false&order=volume&ascending=false&limit=${limit}`);
          if (isApiError(data)) return { markets: [], count: 0, error: data.message };
          const markets: any[] = [];
          for (const event of (data as any[])) {
            for (const market of event.markets ?? []) {
              if (market.closed || !market.active) continue;
              const outcomes = JSON.parse(market.outcomes || "[]");
              const prices = JSON.parse(market.outcomePrices || "[]");
              markets.push({
                question: market.question,
                slug: market.slug,
                yesPrice: `${(parseFloat(prices[0] ?? "0") * 100).toFixed(1)}%`,
                noPrice: `${(parseFloat(prices[1] ?? "0") * 100).toFixed(1)}%`,
                volume: `$${(parseFloat(market.volume ?? "0") / 1000).toFixed(0)}K`,
                liquidity: `$${(parseFloat(market.liquidity ?? "0") / 1000).toFixed(0)}K`,
                endDate: market.endDate,
                conditionId: market.conditionId,
              });
            }
          }
          return { markets: markets.slice(0, limit), count: markets.length };
        },
      }),

      get_market_details: tool({
        description: "Search for a specific Polymarket market by keyword or slug. Returns detailed info including prices, volume, outcomes, and token IDs.",
        parameters: z.object({
          query: z.string().describe("Market slug or search keyword (e.g. 'trump', 'bitcoin-100k', 'fed-rate')"),
        }),
        execute: async ({ query }: { query: string }) => {
          // Try slug search first
          const data = await fetchJSON(`${GAMMA_API}/markets?slug=${encodeURIComponent(query)}&limit=5`);
          let results = isApiError(data) ? [] : (data as any[]);

          // If no results, try text search
          if (!results || results.length === 0) {
            const searchData = await fetchJSON(`${GAMMA_API}/markets?text=${encodeURIComponent(query)}&limit=5&active=true&closed=false`);
            results = isApiError(searchData) ? [] : (searchData as any[]);
          }

          if (results.length === 0) return [];

          return results.map((m: any) => {
            const outcomes = JSON.parse(m.outcomes || "[]");
            const prices = JSON.parse(m.outcomePrices || "[]");
            const tokenIds = JSON.parse(m.clobTokenIds || "[]");
            return {
              question: m.question,
              slug: m.slug,
              conditionId: m.conditionId,
              outcomes: outcomes.map((o: string, i: number) => ({
                outcome: o,
                price: `${(parseFloat(prices[i] ?? "0") * 100).toFixed(1)}%`,
                tokenId: tokenIds[i],
              })),
              volume: `$${(parseFloat(m.volume ?? "0") / 1000).toFixed(0)}K`,
              liquidity: `$${(parseFloat(m.liquidity ?? "0") / 1000).toFixed(0)}K`,
              endDate: m.endDate,
              active: m.active,
              description: m.description?.slice(0, 300),
            };
          });
        },
      }),

      get_orderbook: tool({
        description: "Get the live orderbook (bids, asks, spread, midpoint) for a Polymarket token. Requires a token ID.",
        parameters: z.object({
          token_id: z.string().describe("The CLOB token ID to get the orderbook for"),
        }),
        execute: async ({ token_id }: { token_id: string }) => {
          const book = await fetchJSON(`${CLOB_API}/book?token_id=${token_id}`);
          if (isApiError(book)) return { error: book.message, bestBid: "0%", bestAsk: "0%", spread: "0%", midpoint: "0%", bidDepth: [], askDepth: [] };
          const bids = (book as any).bids ?? [];
          const asks = (book as any).asks ?? [];
          const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
          const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 1;
          const spread = bestAsk - bestBid;
          const midpoint = (bestBid + bestAsk) / 2;
          return {
            bestBid: `${(bestBid * 100).toFixed(1)}%`,
            bestAsk: `${(bestAsk * 100).toFixed(1)}%`,
            spread: `${(spread * 100).toFixed(2)}%`,
            midpoint: `${(midpoint * 100).toFixed(1)}%`,
            bidDepth: bids.slice(0, 5).map((b: any) => ({ price: `${(parseFloat(b.price) * 100).toFixed(1)}%`, size: b.size })),
            askDepth: asks.slice(0, 5).map((a: any) => ({ price: `${(parseFloat(a.price) * 100).toFixed(1)}%`, size: a.size })),
          };
        },
      }),

      get_leaderboard: tool({
        description: "Get the top traders on Polymarket ranked by profit or volume. Shows their PnL, volume, username, and rank.",
        parameters: z.object({
          period: z.enum(["DAY", "WEEK", "MONTH", "ALL"]).optional().describe("Time period (default 'WEEK')"),
          orderBy: z.enum(["PNL", "VOL"]).optional().describe("Sort by PNL (profit) or VOL (volume). Default PNL."),
          limit: z.number().optional().describe("Number of traders to return (default 25, max 100)"),
        }),
        execute: async ({ period = "WEEK", orderBy = "PNL", limit = 25 }) => {
          // Try v1 endpoint first (correct per Polymarket docs)
          const urls = [
            `${DATA_API}/v1/leaderboard?timePeriod=${period}&orderBy=${orderBy}&limit=${limit}&category=OVERALL`,
            `${DATA_API}/leaderboard?timePeriod=${period}&orderBy=${orderBy}&limit=${limit}`,
            `${DATA_API}/ranked?window=${period === "DAY" ? "1d" : period === "WEEK" ? "7d" : period === "MONTH" ? "30d" : "all"}&limit=${limit}`,
          ];

          for (const url of urls) {
            const data = await fetchJSON(url);
            if (isApiError(data)) continue;
            const entries = Array.isArray(data) ? data : (data as any)?.leaderboard ?? (data as any)?.rankings ?? (data as any)?.data ?? [];
            if (entries.length === 0) continue;
            return entries.slice(0, limit).map((e: any, i: number) => ({
              rank: e.rank ?? i + 1,
              address: e.proxyWallet ?? e.address ?? e.wallet ?? "",
              username: e.userName ?? e.username ?? e.displayName ?? `${(e.proxyWallet ?? e.address ?? "").slice(0, 6)}...`,
              pnl: `$${parseFloat(e.pnl ?? e.profit ?? "0").toFixed(2)}`,
              volume: `$${(parseFloat(e.vol ?? e.volume ?? "0") / 1000).toFixed(0)}K`,
              xUsername: e.xUsername ?? undefined,
              verified: e.verifiedBadge ?? false,
            }));
          }
          return { error: "Leaderboard API is temporarily unavailable across all endpoints." };
        },
      }),

      get_market_price: tool({
        description: "Get the current midpoint price for a Polymarket token by its token ID.",
        parameters: z.object({
          token_id: z.string().describe("The CLOB token ID"),
        }),
        execute: async ({ token_id }: { token_id: string }) => {
          const data = await fetchJSON(`${CLOB_API}/midpoint?token_id=${token_id}`);
          if (isApiError(data)) return { tokenId: token_id, midpoint: "0%", raw: 0, error: data.message };
          const mid = parseFloat((data as any).mid ?? "0");
          return {
            tokenId: token_id,
            midpoint: `${(mid * 100).toFixed(2)}%`,
            raw: mid,
          };
        },
      }),
    },
    maxSteps: 5,
    onStepFinish({ text, toolCalls, toolResults, finishReason, usage }) {
      console.log("[chat] Step finished:", {
        hasText: !!text?.trim(),
        textLength: text?.length ?? 0,
        toolCalls: toolCalls?.map((tc: any) => tc.toolName ?? tc.name) ?? [],
        toolResults: toolResults?.length ?? 0,
        finishReason,
        tokens: usage?.totalTokens ?? 0,
      });
    },
    onFinish({ text, finishReason, usage }) {
      console.log("[chat] Stream finished:", {
        hasText: !!text?.trim(),
        textLength: text?.length ?? 0,
        finishReason,
        tokens: usage?.totalTokens ?? 0,
      });
    },
  });

  return result.toUIMessageStreamResponse();
  } catch (err: any) {
    console.error("[chat/route] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "An unexpected error occurred" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
