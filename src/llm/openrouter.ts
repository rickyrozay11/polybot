import OpenAI from "openai";
import type { LLMProvider, LLMMessage, LLMToolDefinition, LLMResponse } from "./types";
import { withRetry } from "@/src/lib/retry";

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI;
  private modelId: string;

  constructor({ apiKey, modelId = "x-ai/grok-4.20-multi-agent-beta" }: { apiKey: string; modelId?: string }) {
    this.modelId = modelId;
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/polymarket-bot",
        "X-Title": "Polymarket Trading Bot",
      },
    });
  }

  async chat(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
  }): Promise<LLMResponse> {
    const { messages, tools, temperature, max_tokens, response_format } = params;

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: msg.content,
          tool_call_id: msg.tool_call_id!,
        };
      }
      if (msg.role === "assistant" && msg.tool_calls?.length) {
        return {
          role: "assistant" as const,
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
      }
      return {
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      };
    });

    const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as Record<string, unknown>,
      },
    }));

    const startMs = Date.now();
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    const promptPreview = userMsg.length > 120 ? userMsg.slice(0, 120) + "..." : userMsg;
    console.log(`[LLM] ➜ ${this.modelId} | temp=${temperature ?? 0.7} | max_tokens=${max_tokens ?? "default"} | tools=${tools?.length ?? 0} | prompt: "${promptPreview}"`);

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.modelId,
          messages: openaiMessages,
          tools: openaiTools,
          temperature,
          max_tokens,
          response_format,
        }),
      { label: `openrouter-${this.modelId}`, maxRetries: 3 }
    );

    const latencyMs = Date.now() - startMs;
    const choice = response.choices[0];
    const message = choice.message;

    const result: LLMResponse = {
      content: message.content ?? null,
    };

    if (message.tool_calls?.length) {
      result.tool_calls = message.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    if (response.usage) {
      result.usage = {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      };
    }

    const contentPreview = (result.content ?? "").slice(0, 200);
    const toolCallNames = result.tool_calls?.map((tc) => tc.function.name).join(", ") ?? "none";
    console.log(`[LLM] ✓ ${this.modelId} | ${latencyMs}ms | tokens: ${result.usage?.prompt_tokens ?? "?"}→${result.usage?.completion_tokens ?? "?"} (${result.usage?.total_tokens ?? "?"}) | tools: ${toolCallNames} | response: "${contentPreview}${(result.content?.length ?? 0) > 200 ? "..." : ""}"`);

    return result;
  }
}
