import type { AttributeValue, FieldSpec } from "./types.ts";

/**
 * Constraint checks applied *after* coercion has produced a typed value.
 *
 * These are hand-written rather than delegated to a validation library
 * because every message here is read aloud by the assistant to a business
 * owner in WhatsApp. "Expected number, received string" is not an acceptable
 * thing to say to someone trying to pay their staff.
 */
export function checkConstraints(
  spec: FieldSpec,
  value: AttributeValue,
): string | null {
  if (value === null) {
    return spec.isRequired ? `${spec.label} is required.` : null;
  }

  const rules = spec.validation;
  if (!rules) return null;

  if (typeof value === "number") {
    if (rules.min !== undefined && value < rules.min) {
      return `${spec.label} can't be less than ${rules.min}.`;
    }
    if (rules.max !== undefined && value > rules.max) {
      return `${spec.label} can't be more than ${rules.max}.`;
    }
  }

  if (typeof value === "string") {
    if (rules.minLength !== undefined && value.length < rules.minLength) {
      return `${spec.label} needs at least ${rules.minLength} characters.`;
    }
    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      return `${spec.label} can't be longer than ${rules.maxLength} characters.`;
    }
    if (rules.pattern !== undefined && !safeMatches(rules.pattern, value)) {
      return `${value} isn't a valid ${spec.label}.`;
    }
  }

  if (Array.isArray(value)) {
    if (rules.min !== undefined && value.length < rules.min) {
      return `Please choose at least ${rules.min} for ${spec.label}.`;
    }
    if (rules.max !== undefined && value.length > rules.max) {
      return `Please choose no more than ${rules.max} for ${spec.label}.`;
    }
  }

  return null;
}

/**
 * Patterns can originate from an LLM inferring a schema from a spreadsheet,
 * so they are untrusted input. An unbounded regex against attacker-shaped
 * data is a denial-of-service risk, so we cap the work: reject patterns that
 * fail to compile, and bail out on absurdly long inputs rather than letting
 * a catastrophic backtrack run.
 */
function safeMatches(pattern: string, value: string): boolean {
  if (value.length > 4096) return false;
  try {
    return new RegExp(`^(?:${pattern})$`, "u").test(value);
  } catch {
    // A malformed pattern must not block an owner from saving their data.
    return true;
  }
}
