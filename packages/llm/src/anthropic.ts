import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";

import {
  LlmConfigurationError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmToolCall,
  type LlmTurn,
} from "./types.ts";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Retries on 429/5xx are handled by the SDK. */
  maxRetries?: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * The real Claude provider.
 *
 * Its only job is translation between our neutral types and the Messages
 * API. Prompt construction, tool definitions and the confirm-before-write
 * rule all live in @mycrew/core, so switching models never risks changing
 * business behaviour.
 */
export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): LlmProvider {
  if (!options.apiKey) {
    throw new LlmConfigurationError(
      "ANTHROPIC_API_KEY is required when MYCREW_LLM_PROVIDER=anthropic. " +
        'Set MYCREW_LLM_PROVIDER="mock" to run without a key.',
    );
  }

  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: options.maxRetries ?? 2,
  });
  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: `anthropic:${model}`,

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens ?? options.maxTokens ?? DEFAULT_MAX_TOKENS,
        // Low but non-zero: replies should read naturally without the model
        // improvising about payroll.
        temperature: request.temperature ?? 0.2,
        system: request.system,
        messages: request.turns.map(toMessageParam),
        tools: request.tools.map(toAnthropicTool),
      });

      const textParts: string[] = [];
      const toolCalls: LlmToolCall[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }

      return {
        text: textParts.join("\n").trim(),
        toolCalls,
        stopReason: toStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}

function toAnthropicTool(tool: {
  name: string;
  description: string;
  inputSchema: unknown;
}): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Tool.InputSchema,
  };
}

function toMessageParam(turn: LlmTurn): MessageParam {
  const content: ContentBlockParam[] = turn.content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError ?? false,
        };
    }
  });

  return { role: turn.role, content };
}

function toStopReason(reason: string | null): LlmStopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "other";
  }
}
