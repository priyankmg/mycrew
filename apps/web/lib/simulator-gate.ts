import { timingSafeEqual } from "node:crypto";

/**
 * Guard for the chat simulator's endpoints.
 *
 * The simulator lets a caller act as any user, and `/api/users` lists everyone
 * it can find. That is the right shape for a development tool and completely
 * wrong for anything reachable from the internet: a deployed instance would
 * hand a stranger every employee record it holds.
 *
 * Real channels are not affected. WhatsApp authenticates each request by HMAC
 * over the raw body, which is a stronger check than this one and belongs to the
 * adapter.
 *
 * Story 6.15. This is not user authentication — owners logging in to see their
 * own account needs a real session design, and this is not it. It closes the
 * hole that exists today.
 */

const TOKEN_HEADER = "x-mycrew-simulator-token";

function configuredToken(): string {
  return (process.env["MYCREW_SIMULATOR_TOKEN"] ?? "").trim();
}

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

function tokensMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch, and length alone is not worth
  // protecting here.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Returns a response to send instead of handling the request, or `undefined`
 * when the request may proceed.
 *
 * Fails closed: in production with no token configured, the simulator is off.
 * Enabling it is an explicit act, so forgetting to think about it leaves the
 * data unreachable rather than public.
 */
export function simulatorDenied(request: Request): Response | undefined {
  if (!isProduction()) return undefined;

  const expected = configuredToken();
  const supplied = request.headers.get(TOKEN_HEADER) ?? "";

  // One response for both "switched off" and "wrong token". Distinguishing
  // them would tell an unauthenticated caller that a valid token exists, and
  // 404 rather than 403 keeps the endpoint's existence uninteresting.
  if (expected === "" || !tokensMatch(supplied, expected)) {
    return Response.json(
      {
        error:
          "The chat simulator is disabled on this deployment. It grants " +
          "access to any user's record, so it stays off unless " +
          "MYCREW_SIMULATOR_TOKEN is set.",
      },
      { status: 404 },
    );
  }

  return undefined;
}

export const SIMULATOR_TOKEN_HEADER = TOKEN_HEADER;
