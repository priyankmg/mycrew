import type { ChannelType } from "@mycrew/db";

export type { ChannelType };

/** An attachment a user sent: a timesheet photo, a voice note, a roster. */
export interface InboundMedia {
  /** Either a fetchable URL or a channel-specific media id to resolve. */
  url?: string;
  mediaId?: string;
  mimeType: string;
  caption?: string;
}

/**
 * A message normalised out of whatever shape the channel delivered it in.
 *
 * Everything above this boundary — the agent, the tools, the database — is
 * written against this type only, which is what keeps WhatsApp a detail
 * rather than an assumption baked through the codebase (story 5.1).
 */
export interface InboundMessage {
  channel: ChannelType;
  /**
   * The channel's identifier for this conversation. For WhatsApp this is the
   * sender's phone number; for the simulator, a browser session id.
   */
  channelThreadId: string;
  /** Used to deduplicate webhook retries, which every provider does. */
  channelMessageId: string;
  senderPhoneE164?: string;
  senderDisplayName?: string;
  /** Empty when the message carried only media. */
  text: string;
  media?: InboundMedia;
  receivedAt: Date;
}

export interface OutboundMessage {
  channelThreadId: string;
  text: string;
  /**
   * Suggested replies, rendered as buttons where the channel supports them
   * and appended as text where it doesn't. Used mainly for the
   * confirm-before-write prompt, where "Yes"/"No" buttons cut both effort
   * and ambiguity.
   */
  quickReplies?: readonly string[];
}

export interface SendResult {
  channelMessageId?: string;
}

export interface ChannelAdapter {
  readonly channel: ChannelType;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Implemented by channels that receive messages via HTTP webhook. */
export interface WebhookChannelAdapter extends ChannelAdapter {
  /**
   * Verify the request genuinely came from the provider. Called with the raw
   * body, because signatures are computed over exact bytes and re-serialising
   * parsed JSON will not reproduce them.
   */
  verifySignature(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhook(body: unknown): InboundMessage[];
}
