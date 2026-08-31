import { prisma } from "@mycrew/db";
import { createLlmProvider } from "@mycrew/llm";

import { failure } from "@/lib/errors.ts";
import { simulatorDenied } from "@/lib/simulator-gate.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the simulator can pretend to be, plus which LLM provider is live.
 *
 * A development-only endpoint. Real channels identify the sender from the
 * platform (a verified phone number); nothing here implies users can pick
 * their own identity in production.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = simulatorDenied(request);
  if (denied) return denied;

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        displayName: true,
        role: true,
        account: { select: { businessName: true } },
      },
      orderBy: [{ role: "asc" }, { displayName: "asc" }],
    });

    return Response.json({
      provider: createLlmProvider().name,
      users: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        businessName: user.account.businessName,
      })),
    });
  } catch (error) {
    return failure("users", error, {
      hint:
        "Check DATABASE_URL in .env, then run `npm run db:migrate` and " +
        "`npm run db:seed`.",
    });
  }
}
