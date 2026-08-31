import { prisma } from "@mycrew/db";
import { createLlmProvider } from "@mycrew/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the simulator can pretend to be, plus which LLM provider is live.
 *
 * A development-only endpoint. Real channels identify the sender from the
 * platform (a verified phone number); nothing here implies users can pick
 * their own identity in production.
 */
export async function GET(): Promise<Response> {
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
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[users] lookup failed", error);
    return Response.json(
      {
        error: detail,
        hint:
          "Check DATABASE_URL in .env, then run `npm run db:migrate` and " +
          "`npm run db:seed`.",
      },
      { status: 500 },
    );
  }
}
