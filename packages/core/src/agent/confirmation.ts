/**
 * Confirmation handling for pending writes (story 3.9).
 *
 * The decision of whether a user said yes is made here, in ordinary code,
 * and never by the language model. A model that misreads "no, not that one"
 * as agreement would change someone's pay. So the vocabulary is explicit and
 * closed: anything that is not clearly affirmative or clearly negative is
 * treated as neither, and the user gets asked again.
 *
 * The cost of that strictness is an occasional extra round trip. The cost of
 * the alternative is an unauthorised write to a payroll record.
 */

export type ConfirmationIntent = "AFFIRM" | "DECLINE" | "UNCLEAR";

const AFFIRMATIVE = new Set([
  "yes", "y", "yeah", "yep", "yup", "ya", "sure", "ok", "okay", "k",
  "confirm", "confirmed", "correct", "right", "do it", "go ahead", "go",
  "please do", "sounds good", "that's right", "thats right", "approve",
  "approved", "send it", "save it", "yes please", "affirmative", "si", "sí",
]);

const NEGATIVE = new Set([
  "no", "n", "nope", "nah", "cancel", "stop", "don't", "dont", "do not",
  "never mind", "nevermind", "wait", "hold on", "not right", "wrong",
  "incorrect", "reject", "discard", "forget it", "abort", "undo",
]);

/**
 * Classify a reply to a confirmation prompt.
 *
 * Only short replies are considered a verdict. A long message is far more
 * likely to be a fresh instruction ("no, make it 4pm and also add Sam") than
 * a bare yes or no, and treating it as a verdict would either execute the
 * wrong write or silently drop what the user actually asked for.
 */
export function classifyConfirmation(message: string): ConfirmationIntent {
  const normalized = message
    .toLowerCase()
    .replace(/[.!,;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") return "UNCLEAR";

  if (AFFIRMATIVE.has(normalized)) return "AFFIRM";
  if (NEGATIVE.has(normalized)) return "DECLINE";

  // Allow a couple of leading filler words: "ok yes", "alright go ahead".
  const stripped = normalized.replace(
    /^(?:ok(?:ay)?|alright|well|hmm|um|so|and)\s+/,
    "",
  );
  if (stripped !== normalized) {
    if (AFFIRMATIVE.has(stripped)) return "AFFIRM";
    if (NEGATIVE.has(stripped)) return "DECLINE";
  }

  // A short negation is worth catching even when phrased loosely, because
  // failing to hear "no" is the expensive direction of this error.
  if (normalized.split(" ").length <= 4 && /\b(no|not|don'?t|cancel|stop)\b/.test(normalized)) {
    return "DECLINE";
  }

  return "UNCLEAR";
}

/** How long a parked write stays valid before it must be re-confirmed. */
export const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

export function pendingActionExpiry(now: Date): Date {
  return new Date(now.getTime() + PENDING_ACTION_TTL_MS);
}

/**
 * Wording for the confirmation prompt. Kept in one place so every write in
 * the product asks in the same recognisable shape.
 */
export function buildConfirmationPrompt(summary: string): {
  text: string;
  quickReplies: string[];
} {
  return {
    text: `${summary}\n\nShall I go ahead?`,
    quickReplies: ["Yes", "No"],
  };
}
