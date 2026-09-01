import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from "./types.ts";

/**
 * A deterministic stand-in for Claude.
 *
 * This exists so the whole stack — channels, agent runtime, confirmation
 * gate, database writes — can be developed, demoed and tested without an API
 * key or network access, and so tests assert on behaviour rather than on a
 * model's mood.
 *
 * It is a keyword router, and deliberately not more than that. Anything that
 * needs real language understanding (resolving "the Friday before payday",
 * parsing a photographed timesheet) is left to the real provider; the mock
 * says it cannot help rather than guessing, because a plausible-looking
 * wrong answer in a payroll tool is worse than an honest refusal.
 */

interface IntentRule {
  /** Tool this rule targets. Skipped when the runtime hasn't declared it. */
  tool: string;
  test: RegExp;
  build: (message: string, match: RegExpExecArray) => Record<string, unknown>;
}

const RULES: IntentRule[] = [
  {
    tool: "record_attendance",
    test: /\b(?:clock(?:ed|ing)?\s*(in|out)|punch(?:ed|ing)?\s*(in|out)|(?:i'?m|im)\s+(here|in|leaving|off|out)|start(?:ed|ing)?\s+(?:my\s+)?shift|finish(?:ed|ing)?\s+(?:my\s+)?shift|heading\s+(home|out))\b/i,
    build: (message, match) => {
      const direction = detectDirection(match);
      const time = extractTime(message);
      return {
        direction,
        ...(time ? { time } : {}),
        ...(extractAfterBecause(message)
          ? { justification: extractAfterBecause(message) }
          : {}),
      };
    },
  },
  {
    tool: "request_leave",
    test: /\b(?:day\s+off|time\s+off|annual\s+leave|vacation|holiday|sick(?:\s+(?:day|leave))?|take\s+leave|need\s+.*\boff\b)\b/i,
    build: (message) => {
      const dates = extractIsoDates(message);
      return {
        leaveType: /\bsick\b/i.test(message) ? "sick" : "unpaid",
        ...(dates[0] ? { startDate: dates[0] } : {}),
        ...(dates[1] ?? dates[0] ? { endDate: dates[1] ?? dates[0] } : {}),
        ...(extractAfterBecause(message)
          ? { reason: extractAfterBecause(message) }
          : {}),
      };
    },
  },
  {
    tool: "decide_request",
    test: /\b(approve|reject|deny|decline|ok(?:ay)?)\b.*?req(?:uest)?[\s#-]*(\d+)|req(?:uest)?[\s#-]*(\d+).*?\b(approve|reject|deny|decline)\b/i,
    build: (message, match) => {
      const reference = match[2] ?? match[3];
      const verb = (match[1] ?? match[4] ?? "").toLowerCase();
      return {
        ...(reference ? { reference: Number(reference) } : {}),
        decision: /^(reject|deny|decline)$/.test(verb) ? "reject" : "approve",
      };
    },
  },
  {
    tool: "list_pending_requests",
    test: /\b(?:pending|open|outstanding|waiting)\b.*\brequests?\b|\brequests?\b.*\b(?:pending|open|outstanding|waiting)\b|what(?:'s| is)\s+waiting\s+on\s+me/i,
    build: () => ({}),
  },
  {
    tool: "get_request_status",
    test: /\b(?:status|what happened|any (?:news|update)|where(?:'s| is) )\b.*?(?:req(?:uest)?[\s#-]*(\d+))?|req(?:uest)?[\s#-]*(\d+)/i,
    build: (message, match) => {
      const reference = match[1] ?? match[2];
      return reference
        ? { reference: Number(reference) }
        : { query: message.trim() };
    },
  },
  {
    tool: "continue_onboarding",
    test: /\b(?:(?:start|begin)\s+(?:onboarding|setup)|set\s+up\s+(?:my\s+|the\s+)?account|account\s+setup)\b/i,
    build: () => ({}),
  },
  {
    tool: "add_employee",
    test: /\b(?:add|onboard|hire)\b\s+(.+?)(?:\s+as\s+(?:a\s+|an\s+)?(?:new\s+)?(?:staff|employee|hire|barista|cook|chef|manager)(?:\s+member)?)?$/i,
    build: (_message, match) => ({
      fullName: (match[1] ?? "").trim(),
    }),
  },
  {
    tool: "update_employee_fields",
    test: /\b(?:update|change|set|correct|fix)\b\s+(?:my\s+)?(.+?)\s+(?:to|=|is)\s+(.+)$/i,
    build: (_message, match) => ({
      // The label-to-key mapping is intentionally left to the caller: the
      // mock does not know the account's schema, and guessing a field key
      // would write to the wrong column.
      changes: { [slugGuess(match[1] ?? "")]: (match[2] ?? "").trim() },
    }),
  },
  {
    tool: "get_employee_record",
    test: /\b(?:my|show me my|what do you have on)\b.*\b(?:record|details|info(?:rmation)?|profile|file)\b/i,
    build: () => ({}),
  },
  {
    tool: "list_employees",
    test: /\b(?:list|show|who(?:'s| is| are)|pull up)\b.*\b(?:employees?|staff|team|crew|workers?|everyone)\b/i,
    build: () => ({}),
  },
];

export function createMockProvider(): LlmProvider {
  return {
    name: "mock",

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const message = lastUserText(request);
      const available = new Set(request.tools.map((tool) => tool.name));

      if (message === "") {
        return textResponse(
          "Hi! I can help with your team's hours, leave and records. " +
            "What do you need?",
        );
      }

      for (const rule of RULES) {
        if (!available.has(rule.tool)) continue;
        const match = rule.test.exec(message);
        if (!match) continue;

        const call: LlmToolCall = {
          id: `mock_${Date.now().toString(36)}_${rule.tool}`,
          name: rule.tool,
          input: rule.build(message, match),
        };
        return { text: "", toolCalls: [call], stopReason: "tool_use" };
      }

      // Once setup has started, the system prompt carries the current
      // question. Treat whatever they typed as the answer, unless another
      // rule already matched (clock-in, add a person, and so on).
      if (
        available.has("continue_onboarding") &&
        /Account setup is in progress/.test(request.system)
      ) {
        const skip = /^(skip|none|nothing|later|n\/a|pass)$/i.test(message);
        return {
          text: "",
          toolCalls: [
            {
              id: `mock_${Date.now().toString(36)}_continue_onboarding`,
              name: "continue_onboarding",
              input: skip ? { skip: true } : { answer: message },
            },
          ],
          stopReason: "tool_use",
        };
      }

      return textResponse(
        "I'm running without a language model connected, so I only " +
          "understand a few set phrases right now — things like " +
          '"start onboarding", "clock in", "I need Friday off", ' +
          '"show my record", or "list open requests". Set ' +
          'ANTHROPIC_API_KEY and MYCREW_LLM_PROVIDER="anthropic" ' +
          "for full conversation.",
      );
    },
  };
}

function textResponse(text: string): LlmResponse {
  return { text, toolCalls: [], stopReason: "end_turn" };
}

function lastUserText(request: LlmRequest): string {
  for (let index = request.turns.length - 1; index >= 0; index -= 1) {
    const turn = request.turns[index]!;
    if (turn.role !== "user") continue;

    const text = turn.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join(" ")
      .trim();

    if (text !== "") return text;
  }
  return "";
}

function detectDirection(match: RegExpExecArray): "in" | "out" {
  const groups = match.slice(1).filter(Boolean).map((g) => g.toLowerCase());
  const joined = `${match[0].toLowerCase()} ${groups.join(" ")}`;
  if (/\b(out|leaving|off|home|finish)/.test(joined)) return "out";
  return "in";
}

/** Pulls "5:30pm" or "17:30" out of a sentence, if present. */
function extractTime(message: string): string | null {
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i
    .exec(message);
  if (!match) return null;

  if (match[4] !== undefined) return `${match[4]}:${match[5]}`;

  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

/**
 * Only ISO dates are recognised. Relative language ("next Tuesday") needs the
 * conversation and the account's timezone to resolve, which is precisely the
 * job the real model does.
 */
function extractIsoDates(message: string): string[] {
  return [...message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!);
}

function extractAfterBecause(message: string): string | null {
  const match = /\b(?:because|since|due to|as)\b\s+(.+)$/i.exec(message);
  return match ? match[1]!.trim().replace(/[.!]+$/, "") : null;
}

function slugGuess(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
