import type { ChannelAdapter, InboundMessage } from "@mycrew/channels";
import { prisma } from "@mycrew/db";
import type { LlmProvider } from "@mycrew/llm";

import { createAgentRuntime, type AgentReply } from "../agent/runtime.ts";
import type { ToolRegistry } from "../agent/tools.ts";
import { createPrismaConversationStore } from "./conversation-store.ts";
import { resolveSession, UnknownSenderError } from "./session.ts";

export interface HandleInboundDeps {
  adapter: ChannelAdapter;
  provider: LlmProvider;
  registry: ToolRegistry;
}

export type HandleInboundOutcome =
  | { status: "REPLIED"; reply: AgentReply }
  | { status: "DUPLICATE" }
  | { status: "UNKNOWN_SENDER"; detail: string };

/**
 * The single entry point for an inbound message, whatever channel it arrived
 * on.
 *
 * Both the WhatsApp webhook and the browser simulator call this, which is
 * what makes the simulator a genuine rehearsal rather than a parallel
 * implementation that drifts: identity resolution, deduplication, the agent
 * turn and the reply all take the same path in both.
 */
export async function handleInboundMessage(
  message: InboundMessage,
  deps: HandleInboundDeps,
): Promise<HandleInboundOutcome> {
  // Every messaging provider retries on a slow response, so the same message
  // will arrive twice sooner or later. Without this check a retry could
  // re-run a turn and duplicate a write.
  if (await isDuplicate(message)) {
    return { status: "DUPLICATE" };
  }

  let session;
  try {
    session = await resolveSession(message);
  } catch (error) {
    if (error instanceof UnknownSenderError) {
      // Deliberately not answered. Replying to an unrecognised number would
      // confirm to a stranger that this business uses the platform, and
      // would let anyone burn tokens for free.
      return { status: "UNKNOWN_SENDER", detail: error.message };
    }
    throw error;
  }

  const runtime = createAgentRuntime({
    provider: deps.provider,
    registry: deps.registry,
    store: createPrismaConversationStore(),
  });

  const reply = await runtime.runTurn({
    message: message.text,
    toolContext: session.toolContext,
    prompt: session.prompt,
  });

  await deps.adapter.send({
    channelThreadId: message.channelThreadId,
    text: reply.text,
    ...(reply.quickReplies ? { quickReplies: reply.quickReplies } : {}),
  });

  return { status: "REPLIED", reply };
}

async function isDuplicate(message: InboundMessage): Promise<boolean> {
  const existing = await prisma.message.findFirst({
    where: {
      channelMessageId: message.channelMessageId,
      conversation: {
        channel: message.channel,
        channelThreadId: message.channelThreadId,
      },
    },
    select: { id: true },
  });
  return existing !== null;
}
