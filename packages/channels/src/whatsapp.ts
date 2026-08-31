import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  InboundMedia,
  InboundMessage,
  OutboundMessage,
  SendResult,
  WebhookChannelAdapter,
} from "./types.ts";

export interface WhatsAppOptions {
  accessToken: string;
  phoneNumberId: string;
  /** Shared secret echoed back during webhook subscription setup. */
  verifyToken: string;
  /** Meta app secret, used to verify the X-Hub-Signature-256 header. */
  appSecret: string;
  graphVersion?: string;
}

/**
 * WhatsApp Cloud API adapter.
 *
 * Written now, unused until credentials exist, because doing so proves the
 * `ChannelAdapter` boundary is actually sufficient. An abstraction with one
 * implementation is a guess; this one has two.
 */
export function createWhatsAppAdapter(
  options: WhatsAppOptions,
): WebhookChannelAdapter {
  const graphVersion = options.graphVersion ?? "v21.0";
  const endpoint =
    `https://graph.facebook.com/${graphVersion}/` +
    `${options.phoneNumberId}/messages`;

  return {
    channel: "WHATSAPP",

    async send(message: OutboundMessage): Promise<SendResult> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildSendPayload(message)),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `WhatsApp send failed (${response.status}): ${detail}`,
        );
      }

      const payload = (await response.json()) as {
        messages?: Array<{ id?: string }>;
      };
      const id = payload.messages?.[0]?.id;
      return id ? { channelMessageId: id } : {};
    },

    verifySignature(rawBody, headers) {
      const header =
        headers["x-hub-signature-256"] ?? headers["X-Hub-Signature-256"];
      if (!header || !options.appSecret) return false;

      const expected = createHmac("sha256", options.appSecret)
        .update(rawBody, "utf8")
        .digest("hex");
      const received = header.replace(/^sha256=/, "");

      const expectedBuffer = Buffer.from(expected, "hex");
      const receivedBuffer = Buffer.from(received, "hex");
      // timingSafeEqual throws on length mismatch, so check first.
      if (expectedBuffer.length !== receivedBuffer.length) return false;
      return timingSafeEqual(expectedBuffer, receivedBuffer);
    },

    parseWebhook(body) {
      return parseWhatsAppWebhook(body);
    },
  };
}

function buildSendPayload(message: OutboundMessage): unknown {
  const replies = message.quickReplies ?? [];

  // WhatsApp interactive replies cap at three buttons, and each title is
  // limited to 20 characters. Beyond that we fall back to plain text with
  // the options listed, rather than silently dropping choices.
  const canUseButtons =
    replies.length > 0 &&
    replies.length <= 3 &&
    replies.every((reply) => reply.length <= 20);

  if (!canUseButtons) {
    const suffix =
      replies.length > 0 ? `\n\n${replies.map((r) => `• ${r}`).join("\n")}` : "";
    return {
      messaging_product: "whatsapp",
      to: message.channelThreadId,
      type: "text",
      text: { body: `${message.text}${suffix}` },
    };
  }

  return {
    messaging_product: "whatsapp",
    to: message.channelThreadId,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: message.text },
      action: {
        buttons: replies.map((reply, index) => ({
          type: "reply",
          reply: { id: `qr_${index}_${slug(reply)}`, title: reply },
        })),
      },
    },
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 16);
}

/** Shape of the parts of the Cloud API webhook payload we consume. */
interface WhatsAppMediaPayload {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

interface WhatsAppMessagePayload {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WhatsAppMediaPayload;
  audio?: WhatsAppMediaPayload;
  document?: WhatsAppMediaPayload;
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: WhatsAppMessagePayload[];
      };
    }>;
  }>;
}

export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  const typed = body as WhatsAppWebhookBody;
  const results: InboundMessage[] = [];

  for (const entry of typed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Status callbacks (delivered/read) arrive on the same webhook with no
      // `messages` array; ignoring them here keeps the caller simple.
      const contactName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages ?? []) {
        const from = message.from;
        if (!from || !message.id) continue;

        const media = extractMedia(message);
        const text = extractText(message);

        // A message with neither text nor media is nothing we can act on.
        if (text === "" && !media) continue;

        results.push({
          channel: "WHATSAPP",
          channelThreadId: from,
          channelMessageId: message.id,
          senderPhoneE164: from.startsWith("+") ? from : `+${from}`,
          ...(contactName ? { senderDisplayName: contactName } : {}),
          text,
          ...(media ? { media } : {}),
          receivedAt: message.timestamp
            ? new Date(Number(message.timestamp) * 1000)
            : new Date(),
        });
      }
    }
  }

  return results;
}

function extractText(message: WhatsAppMessagePayload): string {
  return (
    message.text?.body ??
    // Tapping a quick-reply button is a reply, so treat its title as text.
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.button?.text ??
    message.image?.caption ??
    ""
  ).trim();
}

function extractMedia(
  message: WhatsAppMessagePayload,
): InboundMedia | undefined {
  const source = message.image ?? message.audio ?? message.document;
  if (!source?.id) return undefined;

  return {
    mediaId: source.id,
    mimeType: source.mime_type ?? "application/octet-stream",
    ...(source.caption ? { caption: source.caption } : {}),
  };
}

/**
 * Meta's subscription handshake: echo the challenge when the token matches.
 */
export function verifyWebhookSubscription(
  options: Pick<WhatsAppOptions, "verifyToken">,
  query: Record<string, string | undefined>,
): { ok: true; challenge: string } | { ok: false } {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode === "subscribe" && token === options.verifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}
