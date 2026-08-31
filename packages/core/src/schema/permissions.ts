import type { FieldSpec, WriteActor } from "./types.ts";

export type WriteAuthorization = "ALLOW" | "REQUIRES_APPROVAL" | "DENY";

/**
 * Decide whether an actor may write a field.
 *
 * This is the single place the rule lives. Stories 2.9 ("know what I'm
 * allowed to change"), 3.1 ("submit a change request for data that requires
 * approval") and 4.7 ("prevent an employee editing their attendance") are
 * all the same question asked of different fields, so they get one answer
 * function rather than three scattered checks.
 */
export function authorizeFieldWrite(
  spec: FieldSpec,
  actor: WriteActor,
): WriteAuthorization {
  // The system writes derived values (computed hours, flags) that no human
  // edits directly.
  if (spec.editPolicy === "SYSTEM_ONLY") {
    return actor.role === "SYSTEM" ? "ALLOW" : "DENY";
  }

  if (actor.role === "SYSTEM") return "ALLOW";

  if (actor.role === "OWNER") {
    // The owner is the account's authority; nothing they touch needs a
    // second signature.
    return "ALLOW";
  }

  if (actor.role === "EMPLOYEE") {
    // Staff may only ever act on their own record. Reaching a colleague's
    // data is not a permission question, it is a bug.
    if (!actor.isSubject) return "DENY";

    switch (spec.editPolicy) {
      case "EMPLOYEE_DIRECT":
        return "ALLOW";
      case "EMPLOYEE_REQUEST":
        return "REQUIRES_APPROVAL";
      case "OWNER_ONLY":
        return "DENY";
    }
  }

  return "DENY";
}

/**
 * Whether an actor may see a field at all. Used to filter what the assistant
 * reads back, so an employee asking "what do you have on file for me?" never
 * sees an owner-only note about them.
 */
export function canReadField(spec: FieldSpec, actor: WriteActor): boolean {
  if (actor.role === "OWNER" || actor.role === "SYSTEM") return true;
  return spec.visibility === "EMPLOYEE_VISIBLE" && actor.isSubject;
}

/**
 * Human-readable explanation of a field's edit rule, for answering story 2.9
 * directly ("which information am I allowed to change?").
 */
export function describeEditPolicy(spec: FieldSpec): string {
  switch (spec.editPolicy) {
    case "EMPLOYEE_DIRECT":
      return `You can update ${spec.label} yourself.`;
    case "EMPLOYEE_REQUEST":
      return `You can request a change to ${spec.label}; your manager approves it.`;
    case "OWNER_ONLY":
      return `${spec.label} can only be changed by your manager.`;
    case "SYSTEM_ONLY":
      return `${spec.label} is worked out automatically.`;
  }
}
