import type {
  LlmContentBlock,
  LlmProvider,
  LlmTurn,
} from "@mycrew/llm";

import {
  buildConfirmationPrompt,
  classifyConfirmation,
  pendingActionExpiry,
} from "./confirmation.ts";
import { buildSystemPrompt, type PromptContext } from "./prompt.ts";
import type { ConversationStore, StoredMessage } from "./store.ts";
import {
  ToolInputError,
  type ToolContext,
  type ToolRegistry,
  type ToolResult,
} from "./tools.ts";

/** How much history to give the model. */
const HISTORY_LIMIT = 20;

/**
 * Cap on read-tool round trips within a single user message. Prevents a
 * confused model from looping, and bounds worst-case latency and cost.
 */
const MAX_TOOL_ITERATIONS = 3;

export interface AgentReply {
  text: string;
  quickReplies?: readonly string[];
  /** Set when this turn parked a write awaiting confirmation. */
  awaitingConfirmation?: boolean;
  /** Tools actually executed, for logging and tests. */
  executed: string[];
}

export interface RunTurnInput {
  message: string;
  toolContext: ToolContext;
  prompt: Omit<PromptContext, "actor">;
}

export interface AgentRuntimeDeps {
  provider: LlmProvider;
  registry: ToolRegistry;
  store: ConversationStore;
}

/**
 * Runs one user message to completion.
 *
 * The order of operations here is the product's main safety property:
 *
 *   1. If a write is parked awaiting confirmation, interpret this message as
 *      the answer — in code, before the model is consulted at all.
 *   2. Otherwise ask the model what the user wants.
 *   3. Read-only tools execute immediately.
 *   4. Mutating tools never execute. They are parked, and the user is shown
 *      exactly what will happen and asked to confirm.
 *
 * Step 4 means no sequence of model outputs can write to the database on its
 * own. That is enforced structurally, not by prompt instructions.
 */
export function createAgentRuntime(deps: AgentRuntimeDeps) {
  const { provider, registry, store } = deps;

  async function runTurn(input: RunTurnInput): Promise<AgentReply> {
    const { message, toolContext } = input;
    const { conversationId, now } = toolContext;

    await store.appendMessage({
      conversationId,
      direction: "INBOUND",
      role: "USER",
      body: message,
    });

    const pending = await store.findAwaitingConfirmation(conversationId, now);
    if (pending) {
      const verdict = classifyConfirmation(message);

      if (verdict === "AFFIRM") {
        await store.resolvePendingAction(pending.id, "CONFIRMED");
        const result = await executeTool(
          pending.toolName,
          pending.arguments,
          toolContext,
        );
        return reply(conversationId, result.message, {
          executed: [pending.toolName],
        });
      }

      if (verdict === "DECLINE") {
        await store.resolvePendingAction(pending.id, "CANCELLED");
        return reply(
          conversationId,
          "No problem, I haven't changed anything. What would you like instead?",
          { executed: [] },
        );
      }

      // Unclear: the message is probably a new instruction. Cancel the parked
      // write rather than leaving it to be accidentally confirmed by a later
      // "yes" that was meant for something else, and carry on with what they
      // actually said.
      await store.resolvePendingAction(pending.id, "CANCELLED");
    }

    return runModelTurn(input);
  }

  async function runModelTurn(input: RunTurnInput): Promise<AgentReply> {
    const { toolContext } = input;
    const { conversationId } = toolContext;

    const system = buildSystemPrompt({
      ...input.prompt,
      actor: toolContext.actor,
    });
    const tools = registry.schemasFor(toolContext.actor);

    const history = await store.recentMessages(conversationId, HISTORY_LIMIT);
    const turns: LlmTurn[] = toTurns(history);
    const executed: string[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const response = await provider.complete({ system, turns, tools });

      if (response.toolCalls.length === 0) {
        const text =
          response.text.trim() === ""
            ? "Sorry, I didn't catch that. Could you say it another way?"
            : response.text;
        return reply(conversationId, text, { executed });
      }

      // Only the first tool call is honoured per iteration. Micro-business
      // requests are rarely genuinely parallel, and handling them one at a
      // time keeps confirmation prompts about a single, describable change.
      const call = response.toolCalls[0]!;
      const tool = registry.get(call.name);

      if (!tool) {
        return reply(
          conversationId,
          "I can't do that just yet, sorry.",
          { executed },
        );
      }

      let parsed: unknown;
      try {
        parsed = tool.parse(call.input);
      } catch (error) {
        const detail =
          error instanceof ToolInputError
            ? error.message
            : "I didn't understand the details of that request.";
        // Hand the problem back to the model so it can ask the user for what
        // is missing, rather than dead-ending the conversation.
        turns.push(
          { role: "assistant", content: [toToolUseBlock(call)] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                toolUseId: call.id,
                content: detail,
                isError: true,
              },
            ],
          },
        );
        continue;
      }

      if (tool.mutates) {
        const summary = tool.summarize
          ? await tool.summarize(parsed, toolContext)
          : `I'll ${describeToolName(tool.name)}.`;

        await store.createPendingAction({
          conversationId,
          toolName: tool.name,
          arguments: call.input,
          summary,
          expiresAt: pendingActionExpiry(toolContext.now),
        });

        const prompt = buildConfirmationPrompt(summary);
        await store.appendMessage({
          conversationId,
          direction: "OUTBOUND",
          role: "ASSISTANT",
          body: prompt.text,
          toolName: tool.name,
          toolPayload: call.input,
        });

        return {
          text: prompt.text,
          quickReplies: prompt.quickReplies,
          awaitingConfirmation: true,
          executed,
        };
      }

      const result = await tool.execute(parsed, toolContext);
      executed.push(tool.name);

      await store.appendMessage({
        conversationId,
        direction: "OUTBOUND",
        role: "TOOL",
        body: result.message,
        toolName: tool.name,
        toolPayload: result.data ?? null,
      });

      // Give the result back to the model so it can answer in context, e.g.
      // turning a list of records into a sentence.
      turns.push(
        { role: "assistant", content: [toToolUseBlock(call)] },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolUseId: call.id,
              content: JSON.stringify({
                message: result.message,
                data: result.data ?? null,
              }),
            },
          ],
        },
      );

      // The mock provider cannot rephrase a tool result, so surface the
      // tool's own wording rather than looping pointlessly.
      if (provider.name === "mock") {
        return reply(conversationId, result.message, { executed });
      }
    }

    return reply(
      conversationId,
      "I'm having trouble working that one out. Could you try rephrasing it?",
      { executed },
    );
  }

  async function executeTool(
    toolName: string,
    rawArguments: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = registry.get(toolName);
    if (!tool) {
      return { message: "That action is no longer available, sorry." };
    }

    try {
      const parsed = tool.parse(rawArguments);
      return await tool.execute(parsed, context);
    } catch (error) {
      if (error instanceof ToolInputError) {
        return { message: error.message };
      }
      throw error;
    }
  }

  async function reply(
    conversationId: string,
    text: string,
    options: { executed: string[] },
  ): Promise<AgentReply> {
    await store.appendMessage({
      conversationId,
      direction: "OUTBOUND",
      role: "ASSISTANT",
      body: text,
    });
    return { text, executed: options.executed };
  }

  return { runTurn };
}

function toToolUseBlock(call: {
  id: string;
  name: string;
  input: Record<string, unknown>;
}): LlmContentBlock {
  return {
    type: "tool_use",
    id: call.id,
    name: call.name,
    input: call.input,
  };
}

function toTurns(history: readonly StoredMessage[]): LlmTurn[] {
  return [...history]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    // TOOL and SYSTEM rows are a persistence concern; the model sees the
    // conversation as the user experienced it.
    .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
    .map((message) => ({
      role: message.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: [{ type: "text" as const, text: message.body }],
    }));
}

function describeToolName(name: string): string {
  return name.replace(/_/g, " ");
}
