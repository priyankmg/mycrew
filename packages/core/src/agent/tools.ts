import type { JsonSchemaObject, LlmToolSchema } from "@mycrew/llm";

import type { WriteActor } from "../schema/types.ts";

/** Everything a tool needs to act, resolved before the model is called. */
export interface ToolContext {
  accountId: string;
  conversationId: string;
  actor: ToolActor;
  /** IANA timezone of the account, for interpreting times of day. */
  timezone: string;
  /** Injected rather than read from the clock, so tests are deterministic. */
  now: Date;
}

export interface ToolActor extends WriteActor {
  userId?: string;
  /** Set when the actor is a member of staff. */
  employeeId?: string;
  displayName: string;
}

export interface ToolResult {
  /**
   * What the user should be told. Written as finished prose because the mock
   * provider has no ability to rephrase it, and because a deterministic
   * confirmation of a write is worth more than a fluent one.
   */
  message: string;
  /** Structured result, given back to the model for follow-up reasoning. */
  data?: unknown;
}

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  /** Advertised to the model. */
  inputSchema: JsonSchemaObject;

  /**
   * Validate and narrow raw model output. Throws `ToolInputError` on bad
   * input. Tool arguments are model-generated and therefore untrusted, so
   * this is a real security boundary, not a formality.
   */
  parse(input: unknown): TInput;

  /**
   * True when this tool writes. Mutating tools never execute on the model's
   * say-so; the runtime parks them for explicit user confirmation
   * (story 3.9).
   */
  mutates: boolean;

  /**
   * One-line description of the pending change, shown when asking the user
   * to confirm. Must state exactly what will happen.
   */
  summarize?(input: TInput, context: ToolContext): Promise<string> | string;

  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}

export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

/**
 * A tool with its input type erased.
 *
 * The registry has to hold tools with differing input types in one
 * collection, while the runtime needs to call them without knowing which is
 * which. Erasing the type parameter into closures at registration keeps
 * definitions fully type-safe where they are written, and gives the runtime a
 * uniform shape to call — with no casts at either end.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  mutates: boolean;
  parse(input: unknown): unknown;
  summarize?(parsed: unknown, context: ToolContext): Promise<string> | string;
  execute(parsed: unknown, context: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

  // `ToolDefinition` declares its callbacks with method syntax, so parameter
  // types are bivariant and concrete tools are assignable here.
  constructor(tools: readonly ToolDefinition<unknown>[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register<TInput>(tool: ToolDefinition<TInput>): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Duplicate tool registered: ${tool.name}`);
    }

    const { summarize } = tool;

    this.#tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      mutates: tool.mutates,
      parse: (input) => tool.parse(input),
      ...(summarize
        ? {
            summarize: (parsed: unknown, context: ToolContext) =>
              summarize(parsed as TInput, context),
          }
        : {}),
      execute: (parsed: unknown, context: ToolContext) =>
        tool.execute(parsed as TInput, context),
    });
  }

  get(name: string): RegisteredTool | undefined {
    return this.#tools.get(name);
  }

  /**
   * Tools this actor is allowed to use. An employee is never even told that
   * `list_employees` exists, which is cheaper and safer than letting the
   * model call it and rejecting the result afterwards.
   */
  schemasFor(actor: ToolActor): LlmToolSchema[] {
    return [...this.#tools.values()]
      .filter((tool) => isToolAvailable(tool.name, actor))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
  }

  get names(): string[] {
    return [...this.#tools.keys()];
  }
}

/** Tools only a business owner may use. */
const OWNER_ONLY_TOOLS = new Set([
  "list_employees",
  "add_employee",
  "list_pending_requests",
  "decide_request",
]);

export function isToolAvailable(
  toolName: string,
  actor: ToolActor,
): boolean {
  if (actor.role === "OWNER" || actor.role === "SYSTEM") return true;
  return !OWNER_ONLY_TOOLS.has(toolName);
}
