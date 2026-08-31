import { randomUUID } from "node:crypto";

/**
 * Error reporting that doesn't leak the data it was handling.
 *
 * Story 6.11. Two habits make an ordinary 500 into a disclosure:
 *
 *   - Returning `error.message` to the caller. Prisma builds messages
 *     containing the values it was given, so a failed write can echo a pay rate
 *     or a phone number straight back over HTTP.
 *   - Logging the error object. Same content, now in a log aggregator that
 *     outlives the request and is read by people who never had a reason to see
 *     an employee's details.
 *
 * So: messages go to the client only in development, and the log records what
 * the error was and where it came from without its message. A stack trace names
 * code, which is what is actually useful for debugging; the message is the part
 * that carries data.
 */

function isDevelopment(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

/**
 * Logs an error without its message and returns a short reference id.
 *
 * Use directly where there is no response to return — a webhook that must keep
 * processing the rest of its batch, for instance.
 */
export function logFailure(scope: string, error: unknown): string {
  const reference = randomUUID().slice(0, 8);
  const name = error instanceof Error ? error.name : typeof error;

  // Deliberately not `error` and not `error.message`.
  console.error(
    `[${scope}] failed (ref ${reference}, ${name})`,
    error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 6) : "",
  );

  return reference;
}

/**
 * Logs an error without its message, and returns a JSON response.
 *
 * The reference id appears in both, so a report of "I got error a1b2c3" can be
 * tied to a log line without the log needing to contain anything sensitive.
 */
export function failure(
  scope: string,
  error: unknown,
  options: { status?: number; hint?: string } = {},
): Response {
  const reference = logFailure(scope, error);

  const body: Record<string, string> = {
    error: isDevelopment()
      ? error instanceof Error
        ? error.message
        : String(error)
      : `Something went wrong. Reference ${reference}.`,
    reference,
  };

  if (options.hint !== undefined && isDevelopment()) {
    body["hint"] = options.hint;
  }

  return Response.json(body, { status: options.status ?? 500 });
}
