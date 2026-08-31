import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "./types.ts";

/**
 * The development channel: a browser chat window standing in for WhatsApp.
 *
 * Outbound messages are handed to a sink instead of a network call, because
 * the browser is already waiting on the HTTP response that triggered them.
 * This is what lets the product be built and demoed before Meta approval,
 * which for a WhatsApp-first product is otherwise a hard blocker on all
 * development.
 */
export interface WebSimulatorAdapter extends ChannelAdapter {
  /** Messages produced while handling the current request, in order. */
  drain(): OutboundMessage[];
}

export function createWebSimulatorAdapter(): WebSimulatorAdapter {
  const outbox: OutboundMessage[] = [];

  return {
    channel: "WEB_SIMULATOR",

    async send(message: OutboundMessage): Promise<SendResult> {
      outbox.push(message);
      return { channelMessageId: `sim_${outbox.length}` };
    },

    drain(): OutboundMessage[] {
      return outbox.splice(0, outbox.length);
    },
  };
}

/** Build a normalised inbound message from a simulator HTTP request. */
export function simulatorInbound(input: {
  sessionId: string;
  text: string;
  senderPhoneE164?: string;
  senderDisplayName?: string;
}): InboundMessage {
  return {
    channel: "WEB_SIMULATOR",
    channelThreadId: input.sessionId,
    // Unique per message so the deduplication path behaves as it will in
    // production rather than being bypassed in development.
    channelMessageId: `sim_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    ...(input.senderPhoneE164
      ? { senderPhoneE164: input.senderPhoneE164 }
      : {}),
    ...(input.senderDisplayName
      ? { senderDisplayName: input.senderDisplayName }
      : {}),
    text: input.text,
    receivedAt: new Date(),
  };
}
