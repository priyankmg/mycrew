import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  createWhatsAppAdapter,
  parseWhatsAppWebhook,
  verifyWebhookSubscription,
} from "./whatsapp.ts";

const OPTIONS = {
  accessToken: "token",
  phoneNumberId: "123456",
  verifyToken: "verify-me",
  appSecret: "app-secret",
};

function webhook(messages: unknown[], contactName = "Sam Ortiz") {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "15550000002", profile: { name: contactName } }],
              messages,
            },
          },
        ],
      },
    ],
  };
}

describe("parsing WhatsApp webhooks", () => {
  it("normalises a text message", () => {
    const parsed = parseWhatsAppWebhook(
      webhook([
        {
          id: "wamid.1",
          from: "15550000002",
          timestamp: "1780000000",
          type: "text",
          text: { body: "  clocking in  " },
        },
      ]),
    );

    assert.equal(parsed.length, 1);
    const message = parsed[0]!;
    assert.equal(message.channel, "WHATSAPP");
    assert.equal(message.text, "clocking in");
    assert.equal(message.channelThreadId, "15550000002");
    assert.equal(message.senderPhoneE164, "+15550000002");
    assert.equal(message.senderDisplayName, "Sam Ortiz");
    assert.equal(message.channelMessageId, "wamid.1");
    assert.deepEqual(message.receivedAt, new Date(1_780_000_000_000));
  });

  it("treats a tapped quick-reply button as a reply", () => {
    const parsed = parseWhatsAppWebhook(
      webhook([
        {
          id: "wamid.2",
          from: "15550000002",
          type: "interactive",
          interactive: { button_reply: { title: "Yes" } },
        },
      ]),
    );

    assert.equal(parsed[0]?.text, "Yes");
  });

  it("keeps media with its caption", () => {
    const parsed = parseWhatsAppWebhook(
      webhook([
        {
          id: "wamid.3",
          from: "15550000002",
          type: "image",
          image: {
            id: "media-1",
            mime_type: "image/jpeg",
            caption: "this week's timesheet",
          },
        },
      ]),
    );

    const message = parsed[0]!;
    assert.equal(message.text, "this week's timesheet");
    assert.equal(message.media?.mediaId, "media-1");
    assert.equal(message.media?.mimeType, "image/jpeg");
  });

  it("ignores delivery status callbacks", () => {
    // These arrive on the same webhook with no `messages` array at all.
    const parsed = parseWhatsAppWebhook({
      entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }] } }] }],
    });

    assert.deepEqual(parsed, []);
  });

  it("skips a message with neither text nor media", () => {
    const parsed = parseWhatsAppWebhook(
      webhook([{ id: "wamid.4", from: "15550000002", type: "unsupported" }]),
    );

    assert.deepEqual(parsed, []);
  });

  it("tolerates a completely unexpected payload", () => {
    assert.deepEqual(parseWhatsAppWebhook({}), []);
    assert.deepEqual(parseWhatsAppWebhook({ entry: [] }), []);
  });
});

describe("webhook signature verification", () => {
  const adapter = createWhatsAppAdapter(OPTIONS);
  const body = JSON.stringify({ hello: "world" });

  function sign(payload: string, secret = OPTIONS.appSecret): string {
    return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
  }

  it("accepts a correctly signed body", () => {
    assert.equal(
      adapter.verifySignature(body, { "x-hub-signature-256": sign(body) }),
      true,
    );
  });

  it("rejects a body signed with the wrong secret", () => {
    assert.equal(
      adapter.verifySignature(body, {
        "x-hub-signature-256": sign(body, "wrong-secret"),
      }),
      false,
    );
  });

  it("rejects a tampered body", () => {
    assert.equal(
      adapter.verifySignature('{"hello":"tampered"}', {
        "x-hub-signature-256": sign(body),
      }),
      false,
    );
  });

  it("rejects a missing signature header", () => {
    assert.equal(adapter.verifySignature(body, {}), false);
  });

  it("rejects a malformed signature without throwing", () => {
    // timingSafeEqual throws on length mismatch, so this must be guarded.
    assert.equal(
      adapter.verifySignature(body, { "x-hub-signature-256": "sha256=abcd" }),
      false,
    );
  });
});

describe("subscription handshake", () => {
  it("echoes the challenge when the token matches", () => {
    const result = verifyWebhookSubscription(OPTIONS, {
      "hub.mode": "subscribe",
      "hub.verify_token": "verify-me",
      "hub.challenge": "1234",
    });

    assert.deepEqual(result, { ok: true, challenge: "1234" });
  });

  it("refuses a wrong token", () => {
    const result = verifyWebhookSubscription(OPTIONS, {
      "hub.mode": "subscribe",
      "hub.verify_token": "nope",
      "hub.challenge": "1234",
    });

    assert.deepEqual(result, { ok: false });
  });
});
