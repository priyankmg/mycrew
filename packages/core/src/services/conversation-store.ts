import { prisma } from "@mycrew/db";

import type {
  AppendMessageInput,
  ConversationStore,
  CreatePendingActionInput,
  PendingActionRecord,
  StoredMessage,
} from "../agent/store.ts";

/**
 * The production `ConversationStore`, backed by Postgres.
 *
 * Kept deliberately thin: it maps rows to the port's types and nothing else.
 * All decision-making lives in the runtime, which is why the runtime can be
 * tested against an in-memory fake and still be the code that ships.
 */
export function createPrismaConversationStore(): ConversationStore {
  return {
    async appendMessage(input: AppendMessageInput): Promise<StoredMessage> {
      const message = await prisma.message.create({
        data: {
          conversationId: input.conversationId,
          direction: input.direction,
          role: input.role,
          body: input.body,
          channelMessageId: input.channelMessageId ?? null,
          toolName: input.toolName ?? null,
          toolPayload: (input.toolPayload ?? null) as never,
        },
      });

      // Keeps conversation lists sortable by recency without a subquery.
      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: message.createdAt },
      });

      return toStoredMessage(message);
    },

    async recentMessages(conversationId, limit) {
      const messages = await prisma.message.findMany({
        where: { conversationId },
        // Newest first so the limit takes the most recent history, then the
        // runtime restores chronological order.
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return messages.map(toStoredMessage);
    },

    async createPendingAction(
      input: CreatePendingActionInput,
    ): Promise<PendingActionRecord> {
      // At most one write may be awaiting confirmation per conversation.
      // Without this, an earlier prompt could be answered by a later "yes"
      // and apply a change the user had moved on from.
      await prisma.pendingAction.updateMany({
        where: {
          conversationId: input.conversationId,
          status: "AWAITING_CONFIRMATION",
        },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });

      const action = await prisma.pendingAction.create({
        data: {
          conversationId: input.conversationId,
          toolName: input.toolName,
          arguments: input.arguments as never,
          summary: input.summary,
          expiresAt: input.expiresAt,
        },
      });

      return {
        id: action.id,
        conversationId: action.conversationId,
        toolName: action.toolName,
        arguments: action.arguments as Record<string, unknown>,
        summary: action.summary,
        expiresAt: action.expiresAt,
      };
    },

    async findAwaitingConfirmation(conversationId, now) {
      const action = await prisma.pendingAction.findFirst({
        where: {
          conversationId,
          status: "AWAITING_CONFIRMATION",
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!action) return null;

      return {
        id: action.id,
        conversationId: action.conversationId,
        toolName: action.toolName,
        arguments: action.arguments as Record<string, unknown>,
        summary: action.summary,
        expiresAt: action.expiresAt,
      };
    },

    async resolvePendingAction(id, status) {
      await prisma.pendingAction.update({
        where: { id },
        data: { status, resolvedAt: new Date() },
      });
    },
  };
}

function toStoredMessage(message: {
  id: string;
  role: StoredMessage["role"];
  body: string;
  toolName: string | null;
  toolPayload: unknown;
  createdAt: Date;
}): StoredMessage {
  return {
    id: message.id,
    role: message.role,
    body: message.body,
    toolName: message.toolName,
    toolPayload: message.toolPayload,
    createdAt: message.createdAt,
  };
}
