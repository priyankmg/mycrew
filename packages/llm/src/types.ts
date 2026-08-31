/**
 * A provider-neutral view of a chat completion with tool use.
 *
 * The agent runtime speaks only these types, never a vendor SDK's wire
 * format. That boundary is what makes the mock provider a genuine drop-in
 * rather than a parallel code path — the runtime cannot tell the difference,
 * so the logic exercised in tests is the logic that runs in production.
 */

/** JSON Schema describing a tool's arguments. */
export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface LlmToolSchema {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

export type LlmContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    };

export interface LlmTurn {
  role: "user" | "assistant";
  content: LlmContentBlock[];
}

export interface LlmRequest {
  system: string;
  turns: LlmTurn[];
  tools: readonly LlmToolSchema[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmStopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

export interface LlmResponse {
  /** Concatenated text blocks. Empty when the model only called tools. */
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Raised when a provider is misconfigured, so the cause is actionable. */
export class LlmConfigurationError extends Error {
  override readonly name = "LlmConfigurationError";
}
