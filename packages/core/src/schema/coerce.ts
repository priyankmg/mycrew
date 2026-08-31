import type {
  AttributeValue,
  FieldOption,
  FieldSpec,
} from "./types.ts";

/**
 * Coercion turns what a human typed into a typed value.
 *
 * Scope note: this layer only handles forms that are *unambiguous* —
 * "12.50", "$18/hr", "yes", "2026-03-04", "5:30pm". Genuinely ambiguous
 * language ("next Tuesday", "the Friday before payday") is resolved upstream
 * by the LLM, which has the conversation and the account timezone, and which
 * passes an explicit ISO value into the tool call.
 *
 * Keeping that boundary sharp matters: anything deterministic belongs here
 * where it is testable and cannot drift between model versions.
 */

export interface CoercionContext {
  /** ISO 3166-1 alpha-2, used to expand national phone numbers to E.164. */
  countryCode?: string;
}

export type CoercionResult =
  | { ok: true; value: AttributeValue }
  | { ok: false; message: string };

const TRUTHY = new Set([
  "true", "yes", "y", "yep", "yeah", "yup", "1", "on", "correct", "ok",
  "okay", "confirmed", "si", "sí",
]);
const FALSY = new Set([
  "false", "no", "n", "nope", "nah", "0", "off", "incorrect", "none",
]);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/** Values that mean "the user is clearing this field". */
const BLANK = new Set(["", "-", "--", "n/a", "na", "none", "null", "blank"]);

export function coerceValue(
  spec: FieldSpec,
  raw: unknown,
  context: CoercionContext = {},
): CoercionResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  // Arrays only make sense for MULTI_SELECT; everything else gets the
  // scalar treatment after stringifying.
  if (Array.isArray(raw) && spec.dataType !== "MULTI_SELECT") {
    return { ok: false, message: `${spec.label} accepts a single value.` };
  }

  if (typeof raw === "string" && BLANK.has(raw.trim().toLowerCase())) {
    return { ok: true, value: null };
  }

  switch (spec.dataType) {
    case "TEXT":
    case "LONG_TEXT":
      return coerceText(raw);

    case "NUMBER":
    case "CURRENCY":
      return coerceNumber(spec, raw);

    case "INTEGER":
      return coerceInteger(spec, raw);

    case "BOOLEAN":
      return coerceBoolean(spec, raw);

    case "DATE":
      return coerceDate(spec, raw);

    case "DATETIME":
      return coerceDateTime(spec, raw);

    case "TIME":
      return coerceTime(spec, raw);

    case "SELECT":
      return coerceSelect(spec, raw);

    case "MULTI_SELECT":
      return coerceMultiSelect(spec, raw);

    case "PHONE":
      return coercePhone(spec, raw, context);

    case "EMAIL":
      return coerceEmail(spec, raw);

    case "URL":
    case "FILE":
      return coerceUrl(spec, raw);
  }
}

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : String(raw).trim();
}

function coerceText(raw: unknown): CoercionResult {
  const value = asString(raw);
  return { ok: true, value: value === "" ? null : value };
}

function coerceNumber(spec: FieldSpec, raw: unknown): CoercionResult {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { ok: true, value: round(raw, spec.validation?.precision) }
      : { ok: false, message: `${spec.label} must be a number.` };
  }

  const text = asString(raw);
  // Tolerate the way people actually write money in chat: "$18.50/hr",
  // "18,50" (comma decimal), "1,250.00", "18 dollars an hour".
  const cleaned = text
    .replace(/[\p{Sc}]/gu, "")
    .replace(/\b(per|an|a)\s*(hour|hr|week|wk|month|mo|year|yr|day)\b/gi, "")
    .replace(/\/\s*(hour|hr|week|wk|month|mo|year|yr|day)\b/gi, "")
    .replace(/\b(dollars?|usd|euros?|eur|pounds?|gbp|rupees?|inr)\b/gi, "")
    .replace(/[\s_]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(/,/g, ".");

  const match = /^[-+]?\d*\.?\d+$/.exec(cleaned);
  if (!match) {
    return {
      ok: false,
      message: `I couldn't read "${text}" as a number for ${spec.label}.`,
    };
  }

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: `${spec.label} must be a number.` };
  }

  const precision =
    spec.validation?.precision ?? (spec.dataType === "CURRENCY" ? 2 : undefined);
  return { ok: true, value: round(parsed, precision) };
}

function round(value: number, precision?: number): number {
  if (precision === undefined) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function coerceInteger(spec: FieldSpec, raw: unknown): CoercionResult {
  const asNumber = coerceNumber({ ...spec, dataType: "NUMBER" }, raw);
  if (!asNumber.ok) return asNumber;
  const value = asNumber.value;
  if (typeof value !== "number") return { ok: true, value: null };
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      message: `${spec.label} must be a whole number.`,
    };
  }
  return { ok: true, value };
}

function coerceBoolean(spec: FieldSpec, raw: unknown): CoercionResult {
  if (typeof raw === "boolean") return { ok: true, value: raw };
  const text = asString(raw).toLowerCase();
  if (TRUTHY.has(text)) return { ok: true, value: true };
  if (FALSY.has(text)) return { ok: true, value: false };
  return {
    ok: false,
    message: `Please answer yes or no for ${spec.label}.`,
  };
}

/** Normalises to "YYYY-MM-DD". */
function coerceDate(spec: FieldSpec, raw: unknown): CoercionResult {
  const text = asString(raw);

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return buildDate(spec, +iso[1]!, +iso[2]!, +iso[3]!);

  // Ambiguous by design: US convention, matching the target market. An
  // account outside the US should have the LLM send ISO instead.
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const year = +slash[3]!;
    return buildDate(spec, year < 100 ? 2000 + year : year, +slash[1]!, +slash[2]!);
  }

  // "4 March 2026", "March 4 2026", "Mar 4"
  const words =
    /^(\d{1,2})\s+([a-z]+)\.?,?\s*(\d{4})?$/i.exec(text) ??
    /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/i.exec(text);
  if (words) {
    const monthWord = (MONTHS[words[2]!.toLowerCase()] ? words[2]! : words[1]!).toLowerCase();
    const dayText = MONTHS[words[2]!.toLowerCase()] ? words[1]! : words[2]!;
    const month = MONTHS[monthWord];
    if (month) {
      const year = words[3] ? +words[3] : new Date().getUTCFullYear();
      return buildDate(spec, year, month, +dayText);
    }
  }

  return {
    ok: false,
    message:
      `I couldn't read "${text}" as a date for ${spec.label}. ` +
      "Try a format like 2026-03-04.",
  };
}

function buildDate(
  spec: FieldSpec,
  year: number,
  month: number,
  day: number,
): CoercionResult {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, message: `${spec.label} isn't a real date.` };
  }
  // Round-trip through UTC to reject 31 February and friends, which a naive
  // range check would happily accept.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, message: `${spec.label} isn't a real date.` };
  }
  return { ok: true, value: date.toISOString().slice(0, 10) };
}

function coerceDateTime(spec: FieldSpec, raw: unknown): CoercionResult {
  const text = asString(raw);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      message:
        `I couldn't read "${text}" as a date and time for ${spec.label}.`,
    };
  }
  return { ok: true, value: parsed.toISOString() };
}

/** Normalises to 24-hour "HH:MM". */
function coerceTime(spec: FieldSpec, raw: unknown): CoercionResult {
  const text = asString(raw).toLowerCase().replace(/\s+/g, "");
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(text);
  if (!match) {
    return {
      ok: false,
      message: `I couldn't read "${asString(raw)}" as a time for ${spec.label}.`,
    };
  }

  let hour = +match[1]!;
  const minute = match[2] ? +match[2] : 0;
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) {
    return { ok: false, message: `${spec.label} isn't a valid time.` };
  }
  return {
    ok: true,
    value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function matchOption(
  options: readonly FieldOption[],
  text: string,
): FieldOption | undefined {
  const needle = text.trim().toLowerCase();
  return (
    options.find((option) => option.value.toLowerCase() === needle) ??
    options.find((option) => option.label.toLowerCase() === needle)
  );
}

function coerceSelect(spec: FieldSpec, raw: unknown): CoercionResult {
  const options = spec.options ?? [];
  if (options.length === 0) return coerceText(raw);

  const text = asString(raw);
  const option = matchOption(options, text);
  if (!option) {
    const choices = options.map((o) => o.label).join(", ");
    return {
      ok: false,
      message: `${spec.label} needs to be one of: ${choices}.`,
    };
  }
  return { ok: true, value: option.value };
}

function coerceMultiSelect(spec: FieldSpec, raw: unknown): CoercionResult {
  const options = spec.options ?? [];
  const parts = Array.isArray(raw)
    ? raw.map((part) => String(part))
    : asString(raw).split(/\s*(?:,|\band\b|\/|;)\s*/i);

  const selected: string[] = [];
  const unknown: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") continue;

    if (options.length === 0) {
      selected.push(trimmed);
      continue;
    }
    const option = matchOption(options, trimmed);
    if (option) {
      if (!selected.includes(option.value)) selected.push(option.value);
    } else {
      unknown.push(trimmed);
    }
  }

  if (unknown.length > 0) {
    const choices = options.map((o) => o.label).join(", ");
    return {
      ok: false,
      message:
        `I don't recognise ${unknown.join(", ")} for ${spec.label}. ` +
        `Valid options are: ${choices}.`,
    };
  }
  return { ok: true, value: selected.length === 0 ? null : selected };
}

function coercePhone(
  spec: FieldSpec,
  raw: unknown,
  context: CoercionContext,
): CoercionResult {
  const text = asString(raw);
  const digits = text.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits)
      ? { ok: true, value: digits }
      : { ok: false, message: `${spec.label} doesn't look like a valid number.` };
  }

  const bare = digits.replace(/\D/g, "");
  // Only the US dialling plan is expanded automatically; everywhere else we
  // ask for the country code rather than guessing wrong.
  if ((context.countryCode ?? "US") === "US") {
    if (bare.length === 10) return { ok: true, value: `+1${bare}` };
    if (bare.length === 11 && bare.startsWith("1")) {
      return { ok: true, value: `+${bare}` };
    }
  }

  return {
    ok: false,
    message:
      `I couldn't read "${text}" as a phone number for ${spec.label}. ` +
      "Please include the country code, like +1 555 010 1234.",
  };
}

function coerceEmail(spec: FieldSpec, raw: unknown): CoercionResult {
  const value = asString(raw).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return {
      ok: false,
      message: `"${asString(raw)}" doesn't look like an email address.`,
    };
  }
  return { ok: true, value };
}

function coerceUrl(spec: FieldSpec, raw: unknown): CoercionResult {
  const text = asString(raw);
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return { ok: true, value: new URL(candidate).toString() };
  } catch {
    return {
      ok: false,
      message: `"${text}" doesn't look like a valid link for ${spec.label}.`,
    };
  }
}
