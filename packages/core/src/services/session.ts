import { prisma, type ChannelType } from "@mycrew/db";
import type { InboundMessage } from "@mycrew/channels";

import type { ToolActor, ToolContext } from "../agent/tools.ts";
import type { PromptContext } from "../agent/prompt.ts";
import { loadSchema } from "./schema-service.ts";
import { formatDateInZone } from "./time.ts";
import { activeOnboarding } from "./onboarding-service.ts";

export interface ResolvedSession {
  toolContext: ToolContext;
  prompt: Omit<PromptContext, "actor">;
}

export class UnknownSenderError extends Error {
  override readonly name = "UnknownSenderError";
}

/**
 * Turn an inbound message into everything a turn needs: which account it
 * belongs to, who is speaking, and which conversation to append to.
 *
 * Identity comes from the channel, not from anything the message says. On
 * WhatsApp the sender's phone number is asserted by the platform, so it is
 * the trust anchor; a message claiming "this is the owner" carries no weight.
 */
export async function resolveSession(
  message: InboundMessage,
): Promise<ResolvedSession> {
  const user = await findUser(message);

  if (!user) {
    throw new UnknownSenderError(
      `No user is registered for ${
        message.senderPhoneE164 ?? message.channelThreadId
      } on ${message.channel}.`,
    );
  }

  const conversation = await upsertConversation({
    accountId: user.accountId,
    userId: user.id,
    channel: message.channel,
    channelThreadId: message.channelThreadId,
  });

  const actor: ToolActor = {
    role: user.role,
    // An owner is not the subject of a record; staff always are their own.
    isSubject: user.role === "EMPLOYEE",
    displayName: user.displayName,
    userId: user.id,
    ...(user.employeeId ? { employeeId: user.employeeId } : {}),
  };

  const schema = await loadSchema(user.accountId, "EMPLOYEE");
  const knownFields = schema
    .project({}, actor)
    .map((field) => field.label);

  const now = new Date();
  const onboarding =
    user.role === "OWNER" ? await activeOnboarding(user.accountId) : null;

  return {
    toolContext: {
      accountId: user.accountId,
      conversationId: conversation.id,
      actor,
      timezone: user.account.timezone,
      now,
    },
    prompt: {
      businessName: user.account.businessName,
      timezone: user.account.timezone,
      today: formatDateInZone(now, user.account.timezone),
      knownFields,
      ...(onboarding ? { onboarding } : {}),
    },
  };
}

async function findUser(message: InboundMessage) {
  const select = {
    id: true,
    accountId: true,
    role: true,
    displayName: true,
    employeeId: true,
    account: { select: { businessName: true, timezone: true } },
  } as const;

  if (message.senderPhoneE164) {
    const byPhone = await prisma.user.findFirst({
      where: { phoneE164: message.senderPhoneE164, isActive: true },
      select,
    });
    if (byPhone) return byPhone;
  }

  // The simulator addresses users directly by id, since a browser session has
  // no phone number to identify it by.
  if (message.channel === "WEB_SIMULATOR") {
    return prisma.user.findFirst({
      where: { id: message.channelThreadId, isActive: true },
      select,
    });
  }

  return null;
}

async function upsertConversation(input: {
  accountId: string;
  userId: string;
  channel: ChannelType;
  channelThreadId: string;
}) {
  return prisma.conversation.upsert({
    where: {
      channel_channelThreadId: {
        channel: input.channel,
        channelThreadId: input.channelThreadId,
      },
    },
    create: {
      accountId: input.accountId,
      userId: input.userId,
      channel: input.channel,
      channelThreadId: input.channelThreadId,
    },
    update: {},
    select: { id: true },
  });
}

export { formatDateInZone } from "./time.ts";
