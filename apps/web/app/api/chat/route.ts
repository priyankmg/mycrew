import {
  createWebSimulatorAdapter,
  simulatorInbound,
} from "@mycrew/channels";
import { createToolRegistry, handleInboundMessage } from "@mycrew/core";
import { createLlmProvider } from "@mycrew/llm";

// Prisma's pg adapter needs Node APIs, so this cannot run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  /** The user id being impersonated in the simulator. */
  userId?: unknown;
  message?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (userId === "") {
    return Response.json({ error: "userId is required." }, { status: 400 });
  }
  if (message === "") {
    return Response.json({ error: "message is required." }, { status: 400 });
  }
  if (message.length > 2000) {
    return Response.json(
      { error: "That message is too long for a chat channel." },
      { status: 400 },
    );
  }

  // The simulator stands in for WhatsApp, so it goes through the same
  // adapter interface. Its "transport" is this HTTP response.
  const adapter = createWebSimulatorAdapter();

  try {
    const outcome = await handleInboundMessage(
      simulatorInbound({ sessionId: userId, text: message }),
      {
        adapter,
        provider: createLlmProvider(),
        registry: createToolRegistry(),
      },
    );

    if (outcome.status === "UNKNOWN_SENDER") {
      return Response.json(
        {
          error:
            "That user isn't registered. Run `npm run db:seed` to create " +
            "the demo account.",
        },
        { status: 404 },
      );
    }

    return Response.json({
      status: outcome.status,
      messages: adapter.drain(),
    });
  } catch (error) {
    // Surfaced to the browser because this endpoint is a development tool and
    // a readable error beats a silent 500 in the console.
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[chat] turn failed", error);
    return Response.json({ error: detail }, { status: 500 });
  }
}
