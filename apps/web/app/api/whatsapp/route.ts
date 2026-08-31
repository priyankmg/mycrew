import {
  createWhatsAppAdapter,
  verifyWebhookSubscription,
  type WhatsAppOptions,
} from "@mycrew/channels";
import { createToolRegistry, handleInboundMessage } from "@mycrew/core";
import { createLlmProvider } from "@mycrew/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readOptions(): WhatsAppOptions | null {
  const accessToken = process.env["WHATSAPP_ACCESS_TOKEN"];
  const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  const verifyToken = process.env["WHATSAPP_VERIFY_TOKEN"];
  const appSecret = process.env["WHATSAPP_APP_SECRET"];

  if (!accessToken || !phoneNumberId || !verifyToken || !appSecret) {
    return null;
  }
  return { accessToken, phoneNumberId, verifyToken, appSecret };
}

/** Meta's subscription handshake. */
export async function GET(request: Request): Promise<Response> {
  const options = readOptions();
  if (!options) return new Response("WhatsApp is not configured.", { status: 503 });

  const url = new URL(request.url);
  const result = verifyWebhookSubscription(options, {
    "hub.mode": url.searchParams.get("hub.mode") ?? undefined,
    "hub.verify_token": url.searchParams.get("hub.verify_token") ?? undefined,
    "hub.challenge": url.searchParams.get("hub.challenge") ?? undefined,
  });

  return result.ok
    ? new Response(result.challenge, { status: 200 })
    : new Response("Verification failed.", { status: 403 });
}

export async function POST(request: Request): Promise<Response> {
  const options = readOptions();
  if (!options) return new Response("WhatsApp is not configured.", { status: 503 });

  // Read the raw body: the signature is computed over exact bytes, and
  // re-serialising parsed JSON will not reproduce them.
  const rawBody = await request.text();

  const adapter = createWhatsAppAdapter(options);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  if (!adapter.verifySignature(rawBody, headers)) {
    return new Response("Invalid signature.", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Malformed payload.", { status: 400 });
  }

  const provider = createLlmProvider();
  const registry = createToolRegistry();

  for (const message of adapter.parseWebhook(payload)) {
    try {
      await handleInboundMessage(message, { adapter, provider, registry });
    } catch (error) {
      // Log and carry on. Throwing here would make Meta retry the whole
      // batch, re-delivering messages that were already handled.
      console.error("[whatsapp] failed to handle message", error);
    }
  }

  // Always 200 once the signature checks out, so Meta stops retrying.
  return new Response("ok", { status: 200 });
}
