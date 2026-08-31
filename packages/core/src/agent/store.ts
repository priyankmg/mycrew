import type { MessageRole } from "@mycrew/db";

/**
 * Persistence the agent runtime needs, expressed as a port.
 *
 * The runtime is the piece most worth testing — it decides when writes
 * happen — so it depends on this interface rather than on Prisma directly.
 * The production implementation lives in ../services; tests use an in-memory
 * fake and exercise the identical code path.
 */

export interface StoredMessage {
  id: string;
  role: MessageRole;
  body: string;
  toolName?: string | null;
  toolPayload?: unknown;
  createdAt: Date;
}

export interface AppendMessageInput {
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  role: MessageRole;
  body: string;
  channelMessageId?: string;
  toolName?: string;
  toolPayload?: unknown;
}

export interface PendingActionRecord {
  id: string;
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  expiresAt: Date;
}

export interface CreatePendingActionInput {
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  expiresAt: Date;
}

export interface ConversationStore {
  appendMessage(input: AppendMessageInput): Promise<StoredMessage>;
  /** Most recent first or last is up to the implementation; runtime sorts. */
  recentMessages(
    conversationId: string,
    limit: number,
  ): Promise<StoredMessage[]>;

  createPendingAction(
    input: CreatePendingActionInput,
  ): Promise<PendingActionRecord>;
  /** The single unexpired action awaiting confirmation, if any. */
  findAwaitingConfirmation(
    conversationId: string,
    now: Date,
  ): Promise<PendingActionRecord | null>;
  resolvePendingAction(
    id: string,
    status: "CONFIRMED" | "CANCELLED" | "EXPIRED",
  ): Promise<void>;
}
