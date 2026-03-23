import type {
  LLMProvider,
  LLMMessage,
  LLMToolDefinition,
  MarketCandidate,
  AgentAction,
  AgentConfig,
  TradeDecision,
  ScreeningResult,
} from "@/src/types";
import { filterMarkets, scoreMarket } from "@/src/agent/market-scorer";
import { checkRisk } from "@/src/agent/risk-manager";
import {
  SYSTEM_PROMPT,
  screeningPrompt,
  researchSynthesisPrompt,
  tradeDecisionPrompt,
} from "@/src/agent/prompts";

export interface PipelineDeps {
  llm: LLMProvider;
  /** LLM provider that supports tool calling (used for research stage). Falls back to `llm` if not set. */
  toolLlm?: LLMProvider;
  scanner: {
    fetchTrendingMarkets: (limit?: number) => Promise<MarketCandidate[]>;
  };
  polyClient: any;
  toolDeps: any;
  config: AgentConfig;
  existingPositionIds: string[];
  currentExposure: number;
  logAction: (action: AgentAction) => Promise<void>;
  recordTrade: (trade: any) => Promise<void>;
  updatePositionPrice: (
    conditionId: string,
    price: number
  ) => Promise<void>;
  openPositions: Array<{
    conditionId: string;
    tokenId: string;
    side: string;
    size: number;
    avgEntryPrice: number;
  }>;
}

export async function runPipeline(
  deps: PipelineDeps
): Promise<AgentAction[]> {
  const actions: AgentAction[] = [];

  async function log(action: AgentAction) {
    actions.push(action);
    await deps.logAction(action);
  }

  // --- Stage 1: Scan ---
  let allMarkets: MarketCandidate[];
  try {
    allMarkets = await deps.scanner.fetchTrendingMarkets(20);
    await log({
      type: "scan",
      summary: `Scanned ${allMarkets.length} trending markets`,
      details: { count: allMarkets.length },
      timestamp: Date.now(),
    });
  } catch (err) {
    await log({
      type: "error",
      summary: "Failed to scan markets",
      details: { error: String(err) },
      timestamp: Date.now(),
    });
    return actions;
  }

  // --- Stage 2: Filter ---
  const filtered = filterMarkets(allMarkets, deps.existingPositionIds);
  await log({
    type: "filter",
    summary: `Filtered ${allMarkets.length} → ${filtered.length} markets`,
    details: { before: allMarkets.length, after: filtered.length },
    timestamp: Date.now(),
  });

  if (filtered.length === 0) {
    return actions;
  }

  // --- Stage 3: LLM Screen ---
  let screenResults: ScreeningResult[] = [];
  try {
    const marketsForScreening = filtered.map((m) => {
      const yesToken = m.tokens.find((t) => t.outcome === "Yes") ?? m.tokens[0];
      return {
        conditionId: m.conditionId,
        question: m.question,
        yesPrice: yesToken?.price ?? 0.5,
        volume: m.volume,
      };
    });

    const screenResponse = await deps.llm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: screeningPrompt(marketsForScreening) },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(screenResponse.content ?? "[]");
    // Handle various JSON wrappers the LLM might use
    let rawResults: Array<{
      conditionId: string;
      preliminaryConfidence: number;
      reasoning: string;
    }>;
    if (Array.isArray(parsed)) {
      rawResults = parsed;
    } else {
      // Try common wrapper keys
      rawResults =
        parsed.markets ??
        parsed.results ??
        parsed.picks ??
        parsed.top_markets ??
        parsed.opportunities ??
        parsed.candidates ??
        parsed.data ??
        // Fallback: find first array value in the object
        Object.values(parsed).find((v) => Array.isArray(v)) ??
        [];
    }

    // Enrich with question from filtered markets
    const marketMap = new Map(filtered.map((m) => [m.conditionId, m]));
    screenResults = rawResults
      .filter((r) => marketMap.has(r.conditionId))
      .slice(0, 3)
      .map((r) => ({
        conditionId: r.conditionId,
        question: marketMap.get(r.conditionId)!.question,
        preliminaryConfidence: r.preliminaryConfidence,
        reasoning: r.reasoning,
      }));

    await log({
      type: "screen",
      summary: `LLM screened ${filtered.length} markets → ${screenResults.length} candidates`,
      details: {
        candidates: screenResults.map((r) => ({
          conditionId: r.conditionId,
          slug: marketMap.get(r.conditionId)?.slug,
          question: r.question,
          confidence: r.preliminaryConfidence,
          reasoning: r.reasoning,
        })),
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    await log({
      type: "error",
      summary: "Failed during LLM screening",
      details: { error: String(err) },
      timestamp: Date.now(),
    });
    return actions;
  }

  // --- Stage 4 & 5: Deep Research + Trade Decision per market ---
  for (const candidate of screenResults) {
    try {
      const market = filtered.find(
        (m) => m.conditionId === candidate.conditionId
      );
      if (!market) continue;

      // Stage 4: Deep Research via tool-calling loop
      const researchSynthesis = await runResearchLoop(
        deps,
        market,
        candidate
      );

      await log({
        type: "research",
        summary: `Completed research on "${market.question}"`,
        details: {
          conditionId: market.conditionId,
          slug: market.slug,
          question: market.question,
          synthesisLength: researchSynthesis.length,
        },
        timestamp: Date.now(),
      });

      // Stage 5: Trade Decision
      const yesToken =
        market.tokens.find((t) => t.outcome === "Yes") ?? market.tokens[0];
      const noToken =
        market.tokens.find((t) => t.outcome === "No") ?? market.tokens[1];

      const decisionResponse = await deps.llm.chat({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: tradeDecisionPrompt(
              market.question,
              yesToken?.price ?? 0.5,
              noToken?.price ?? 0.5,
              researchSynthesis,
              {
                yes: yesToken?.token_id ?? "",
                no: noToken?.token_id ?? "",
              }
            ),
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      });

      const decision: TradeDecision = {
        conditionId: market.conditionId,
        question: market.question,
        ...JSON.parse(decisionResponse.content ?? "{}"),
      };

      if (decision.action === "skip") {
        await log({
          type: "trade",
          summary: `Skipped "${market.question}" — ${decision.reasoning}`,
          details: { conditionId: market.conditionId, slug: market.slug, question: market.question, decision },
          timestamp: Date.now(),
        });
        continue;
      }

      // Risk check
      const riskResult = checkRisk(
        decision,
        deps.currentExposure,
        deps.config
      );

      if (!riskResult.approved) {
        await log({
          type: "trade",
          summary: `Risk rejected "${market.question}" — ${riskResult.reason}`,
          details: { conditionId: market.conditionId, slug: market.slug, question: market.question, decision, riskResult },
          timestamp: Date.now(),
        });
        continue;
      }

      const finalSize = riskResult.adjustedSize ?? decision.suggestedSize;

      if (!deps.config.dryRun) {
        try {
          const { Side } = await import("@polymarket/clob-client");
          await deps.polyClient.createAndPostOrder(
            {
              tokenID: decision.tokenId,
              price: decision.suggestedPrice,
              size: finalSize,
              side: Side.BUY,
            },
            { tickSize: "0.01", negRisk: market.negRisk },
            "FOK"
          );
        } catch (orderErr) {
          await log({
            type: "error",
            summary: `Order failed for "${market.question}"`,
            details: {
              conditionId: market.conditionId,
              error: String(orderErr),
            },
            timestamp: Date.now(),
          });
          continue;
        }
      }

      await deps.recordTrade({
        conditionId: market.conditionId,
        question: market.question,
        action: decision.action,
        tokenId: decision.tokenId,
        side: decision.action === "buy_yes" ? "yes" : "no",
        size: finalSize,
        price: decision.suggestedPrice,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        dryRun: deps.config.dryRun,
      });

      // Update current exposure for subsequent risk checks
      deps.currentExposure += finalSize;

      await log({
        type: "trade",
        summary: `${deps.config.dryRun ? "[DRY RUN] " : ""}${decision.action} $${finalSize.toFixed(2)} on "${market.question}"`,
        details: {
          conditionId: market.conditionId,
          slug: market.slug,
          question: market.question,
          decision: { ...decision, suggestedSize: finalSize },
          riskResult,
          dryRun: deps.config.dryRun,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      await log({
        type: "error",
        summary: `Error processing market ${candidate.conditionId}`,
        details: {
          conditionId: candidate.conditionId,
          error: String(err),
        },
        timestamp: Date.now(),
      });
    }
  }

  // --- Stage 6: Position Refresh ---
  // Use CLOB midpoint API in dry run mode, orderbook when client is available
  for (const position of deps.openPositions) {
    try {
      let midpoint: number;
      if (deps.polyClient) {
        const book = await deps.polyClient.getOrderBook(position.tokenId);
        const bids = book.bids ?? [];
        const asks = book.asks ?? [];
        const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
        const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 1;
        midpoint = (bestBid + bestAsk) / 2;
      } else {
        // Dry run: fetch midpoint from CLOB API directly
        const res = await fetch(
          `https://clob.polymarket.com/midpoint?token_id=${position.tokenId}`
        );
        if (!res.ok) continue;
        const data = (await res.json()) as { mid: string };
        midpoint = parseFloat(data.mid);
        if (isNaN(midpoint)) continue;
      }

      await deps.updatePositionPrice(position.conditionId, midpoint);
    } catch (err) {
      await log({
        type: "error",
        summary: `Failed to refresh position ${position.conditionId}`,
        details: {
          conditionId: position.conditionId,
          error: String(err),
        },
        timestamp: Date.now(),
      });
    }
  }

  if (deps.openPositions.length > 0) {
    await log({
      type: "position_refresh",
      summary: `Refreshed ${deps.openPositions.length} open positions`,
      details: {
        positionCount: deps.openPositions.length,
        conditionIds: deps.openPositions.map((p) => p.conditionId),
      },
      timestamp: Date.now(),
    });
  }

  return actions;
}

// --- Research loop with tool calling ---

async function runResearchLoop(
  deps: PipelineDeps,
  market: MarketCandidate,
  candidate: ScreeningResult
): Promise<string> {
  // Use tool-capable LLM for research (falls back to default llm)
  const researchLlm = deps.toolLlm ?? deps.llm;

  // Dynamically import tool registry (may not exist yet during development)
  let getToolDefinitions: () => LLMToolDefinition[];
  let executeToolCall: (
    name: string,
    args: Record<string, unknown>,
    deps: any
  ) => Promise<string>;

  try {
    const toolRegistry = await import("@/src/tools/tool-registry");
    getToolDefinitions = () => toolRegistry.TOOL_DEFINITIONS;
    executeToolCall = toolRegistry.executeToolCall;
  } catch {
    // If tool registry not available, do a single-shot research synthesis
    const response = await researchLlm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: researchSynthesisPrompt(
            market.question,
            "",
            "",
            "",
            ""
          ),
        },
      ],
      temperature: 0.4,
    });
    return response.content ?? "No research synthesis available.";
  }

  const tools = getToolDefinitions();
  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: researchSynthesisPrompt(
        market.question,
        "",
        "",
        "",
        ""
      ),
    },
  ];

  const MAX_ITERATIONS = 2;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await researchLlm.chat({
      messages,
      tools,
      temperature: 0.4,
    });

    // If no tool calls, we have the final synthesis
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return response.content ?? "No research synthesis available.";
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: response.content ?? "",
      tool_calls: response.tool_calls,
    });

    // Execute each tool call and add results
    for (const toolCall of response.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(toolCall.function.arguments);
        result = await executeToolCall(
          toolCall.function.name,
          args,
          deps.toolDeps
        );
      } catch (err) {
        result = `Tool call failed: ${String(err)}`;
      }

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
      });
    }
  }

  // If we exhausted iterations, ask for final synthesis without tools
  const finalResponse = await deps.llm.chat({
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "Please provide your final research synthesis now based on all the information gathered.",
      },
    ],
    temperature: 0.4,
  });

  return finalResponse.content ?? "No research synthesis available.";
}
