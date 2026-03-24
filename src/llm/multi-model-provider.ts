import OpenAI from "openai";
import { LLMProvider, LLMMessage, LLMToolDefinition, LLMResponse, LLMToolCall } from "@/src/types";
import { withRetry } from "@/src/lib/retry";

/** Strip markdown code fences (```json ... ```) from LLM responses before parsing */
export function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

export type ModelTier = "fast" | "heavy" | "ensemble";

export interface ModelConfig {
  id: string;
  name: string;
  tier: ModelTier;
  supportsToolCalling: boolean;
  costPer1kTokens: number;
}

export const MODELS: Record<string, ModelConfig> = {
  grokMultiAgent: {
    id: "x-ai/grok-4.20-multi-agent-beta",
    name: "Grok 4.20 Multi-Agent",
    tier: "heavy",
    supportsToolCalling: false,
    costPer1kTokens: 0.005,
  },
  claudeSonnet: {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    tier: "heavy",
    supportsToolCalling: true,
    costPer1kTokens: 0.009,
  },
  gpt54: {
    id: "openai/gpt-5.4",
    name: "GPT 5.4",
    tier: "heavy",
    supportsToolCalling: true,
    costPer1kTokens: 0.009,
  },
  deepseekV32: {
    id: "deepseek/deepseek-v3.2",
    name: "Deepseek V3.2",
    tier: "heavy",
    supportsToolCalling: true,
    costPer1kTokens: 0.0003,
  },
  gemini3Flash: {
    id: "google/gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    tier: "heavy",
    supportsToolCalling: true,
    costPer1kTokens: 0.002,
  },
  grokBeta: {
    id: "x-ai/grok-4.20-beta",
    name: "Grok 4.20 Beta",
    tier: "fast",
    supportsToolCalling: true,
    costPer1kTokens: 0.005,
  },
};

// ============================================================================
// MULTI-MODEL PROVIDER
// ============================================================================

export interface MultiModelChatParams {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  modelId?: string;
}

export class MultiModelProvider implements LLMProvider {
  private client: OpenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://polybot.com",
        "X-Title": "Polybot",
      },
    });
  }

  async chat(params: MultiModelChatParams): Promise<LLMResponse> {
    const modelId = params.modelId || MODELS.grokBeta.id;
    const modelConfig = Object.values(MODELS).find((m) => m.id === modelId);

    if (!modelConfig) {
      throw new Error(`Unknown model ID: ${modelId}`);
    }

    // Validate tool calling support
    if (params.tools && !modelConfig.supportsToolCalling) {
      throw new Error(
        `Model ${modelConfig.name} does not support tool calling. Please use a model with supportsToolCalling=true.`
      );
    }

    const chatParams: OpenAI.Chat.ChatCompletionCreateParams = {
      model: modelId,
      messages: params.messages.map((msg) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      })),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2000,
    };

    if (params.tools && modelConfig.supportsToolCalling) {
      chatParams.tools = params.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
      chatParams.tool_choice = "auto";
    }

    if (params.response_format) {
      chatParams.response_format = params.response_format;
    }

    const startMs = Date.now();
    console.log(`[LLM:ensemble] ➜ ${modelId} | temp=${chatParams.temperature} | tools=${chatParams.tools?.length ?? 0}`);

    return withRetry(async () => {
      const response = await this.client.chat.completions.create(chatParams);
      const latencyMs = Date.now() - startMs;

      const toolCalls: LLMToolCall[] = [];
      let content: string | null = null;

      const firstChoice = response.choices[0];
      if (firstChoice.message.content) {
        content = firstChoice.message.content;
      }

      if (firstChoice.message.tool_calls) {
        for (const toolCall of firstChoice.message.tool_calls) {
          if (toolCall.type === "function") {
            toolCalls.push({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            });
          }
        }
      }

      const tokens = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
      console.log(`[LLM:ensemble] ✓ ${modelId} | ${latencyMs}ms | ${tokens} tokens | response: "${(content ?? "").slice(0, 150)}${(content?.length ?? 0) > 150 ? "..." : ""}"`);

      return {
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          total_tokens: tokens,
        },
      };
    });
  }
}

// ============================================================================
// ENSEMBLE PROVIDER
// ============================================================================

export interface EnsembleVote {
  modelId: string;
  response: LLMResponse;
  latencyMs: number;
}

export interface EnsembleResult {
  votes: EnsembleVote[];
  consensus: {
    action: "buy_yes" | "buy_no" | "skip";
    confidence: number;
    agreementLevel: "full" | "majority" | "weak" | "none";
    voteCounts: Record<string, number>;
  };
}

export interface EnsembleParams {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  modelWeights?: Record<string, number>;
}

export class EnsembleProvider {
  private multiModelProvider: MultiModelProvider;
  private modelIds: string[];

  constructor(config: { apiKey: string; modelIds?: string[] }) {
    this.multiModelProvider = new MultiModelProvider(config.apiKey);
    // Default to heavy models if not specified
    this.modelIds =
      config.modelIds && config.modelIds.length > 0
        ? config.modelIds
        : [
            MODELS.claudeOpus.id,
            MODELS.gpt54.id,
            MODELS.deepseekV32.id,
            MODELS.grokMultiAgent.id,
          ];
  }

  async chatEnsemble(params: EnsembleParams): Promise<EnsembleResult> {
    const weights = params.modelWeights || {};
    // Initialize equal weights if not provided
    for (const modelId of this.modelIds) {
      if (!(modelId in weights)) {
        weights[modelId] = 1.0;
      }
    }

    // Send requests to all models in parallel
    const promises = this.modelIds.map(async (modelId) => {
      const startTime = Date.now();
      try {
        const response = await this.multiModelProvider.chat({
          ...params,
          modelId,
        });
        const latencyMs = Date.now() - startTime;
        return {
          success: true,
          vote: { modelId, response, latencyMs } as EnsembleVote,
        };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        return {
          success: false,
          error,
          modelId,
          latencyMs,
        };
      }
    });

    const results = await Promise.allSettled(promises);

    // Collect successful votes
    const votes: EnsembleVote[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success && result.value.vote) {
        votes.push(result.value.vote);
      }
    }

    const consensus = computeConsensus(votes, weights, this.modelIds.length);

    return {
      votes,
      consensus,
    };
  }
}

// ============================================================================
// CONSENSUS COMPUTATION
// ============================================================================

function computeConsensus(
  votes: EnsembleVote[],
  weights: Record<string, number>,
  expectedModelCount: number
): EnsembleResult["consensus"] {
  // Parse JSON responses to extract action and confidence
  const parsedVotes: Array<{ modelId: string; action?: string; confidence?: number }> = [];

  for (const vote of votes) {
    try {
      // Attempt to parse content as JSON
      const parsed = vote.response.content ? JSON.parse(stripCodeFences(vote.response.content)) : {};
      parsedVotes.push({
        modelId: vote.modelId,
        action: parsed.action || parsed.recommendation || undefined,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      });
    } catch {
      // If not JSON, treat the entire response as action
      const content = vote.response.content || "";
      parsedVotes.push({
        modelId: vote.modelId,
        action: content.substring(0, 100),
        confidence: 0.5,
      });
    }
  }

  if (parsedVotes.length === 0) {
    return {
      action: "skip",
      confidence: 0,
      agreementLevel: "none",
      voteCounts: {},
    };
  }

  // Count weighted votes for each action
  const actionWeights: Record<string, number> = {};
  const actionConfidences: Record<string, number[]> = {};

  for (const pv of parsedVotes) {
    if (!pv.action) continue;

    actionWeights[pv.action] = (actionWeights[pv.action] || 0) + (weights[pv.modelId] || 1.0);
    if (!actionConfidences[pv.action]) {
      actionConfidences[pv.action] = [];
    }
    actionConfidences[pv.action].push(pv.confidence || 0.5);
  }

  // Find the action with highest weighted vote
  const sortedActions = Object.entries(actionWeights).sort(([, a], [, b]) => b - a);

  if (sortedActions.length === 0) {
    return {
      action: "skip",
      confidence: 0,
      agreementLevel: "none",
      voteCounts: {},
    };
  }

  const topAction = sortedActions[0][0];
  const topWeight = sortedActions[0][1];
  const averageConfidence =
    actionConfidences[topAction].reduce((a, b) => a + b, 0) / actionConfidences[topAction].length;

  // Determine agreement level
  let agreementLevel: "full" | "majority" | "weak" | "none" = "none";

  const voteCount = votes.length;

  if (voteCount >= 3) {
    // Full agreement if 3+ models agree on same action
    if (actionConfidences[topAction].length >= 3) {
      agreementLevel = "full";
    }
    // Majority + strong confidence if 2 models agree and confidence > 0.7
    else if (
      actionConfidences[topAction].length === 2 &&
      averageConfidence > 0.7
    ) {
      agreementLevel = "majority";
    }
    // Otherwise weak agreement
    else {
      agreementLevel = "weak";
    }
  } else if (voteCount === 2) {
    // For 2 votes, check confidence
    if (averageConfidence > 0.7) {
      agreementLevel = "majority";
    } else {
      agreementLevel = "weak";
    }
  } else {
    // Single vote, treat as weak
    agreementLevel = "weak";
  }

  return {
    action: (topAction as "buy_yes" | "buy_no" | "skip") || "skip",
    confidence: averageConfidence,
    agreementLevel,
    voteCounts: Object.fromEntries(
      Object.entries(actionConfidences).map(([action, confidences]) => [
        action,
        confidences.length,
      ])
    ),
  };
}

export { computeConsensus };

// ============================================================================
// CHAT ROUTER
// ============================================================================

export interface RouterResult {
  modelId: string;
  tier: ModelTier;
}

export class ChatRouter {
  constructor(private apiKey: string) {
    // API key stored but not required for keyword-based routing
  }

  routeChat(message: string): RouterResult {
    const lowerMessage = message.toLowerCase().trim();

    // Simple query patterns - route to fast model
    const simplePatterns = [
      /^what.*trading at/i,
      /^price/i,
      /^what.*price/i,
      /^\s*price\s*of\s*/i,
      /^how much.*worth/i,
      /^current.*price/i,
      /^get.*trending/i,
      /^trending\s+markets/i,
      /^leaderboard/i,
      /^top\s+traders/i,
      /^orderbook/i,
      /^bid\s*ask/i,
      /^spread/i,
      /^volume/i,
    ];

    for (const pattern of simplePatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          modelId: MODELS.grokBeta.id,
          tier: "fast",
        };
      }
    }

    // Complex query patterns - route to heavy model
    const complexPatterns = [
      /should\s+i\s+/i,
      /should\s+we\s+/i,
      /analyze/i,
      /analysis/i,
      /strategy/i,
      /research/i,
      /sentiment/i,
      /forecast/i,
      /predict/i,
      /opinion/i,
      /recommend/i,
      /why\s+is/i,
      /explain/i,
      /compare/i,
      /signal/i,
      /opportunity/i,
      /risk/i,
      /confidence/i,
      /position\s+size/i,
      /portfolio/i,
      /correlation/i,
      /hedge/i,
      /arbitrage/i,
      /edge/i,
    ];

    for (const pattern of complexPatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          modelId: MODELS.claudeOpus.id,
          tier: "heavy",
        };
      }
    }

    // Default to fast for short queries, heavy for longer ones
    const wordCount = lowerMessage.split(/\s+/).length;
    if (wordCount > 15) {
      return {
        modelId: MODELS.claudeOpus.id,
        tier: "heavy",
      };
    }

    return {
      modelId: MODELS.grokBeta.id,
      tier: "fast",
    };
  }
}
