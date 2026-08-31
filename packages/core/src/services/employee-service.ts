import { prisma } from "@mycrew/db";

import type { ToolActor } from "../agent/tools.ts";
import { loadSchema } from "./schema-service.ts";
import type { AttributeBag, FieldWriteError } from "../schema/types.ts";

export interface ApplyChangesInput {
  accountId: string;
  employeeId: string;
  /** Raw proposed values keyed by field key; may be chat strings. */
  changes: Record<string, unknown>;
  actor: ToolActor;
  /** The user's verbatim reason, stored as given. */
  justification?: string;
  conversationId?: string;
}

export interface ApplyChangesResult {
  applied: AttributeBag;
  /** Reference numbers of approval requests raised, e.g. [42]. */
  approvalsRaised: number[];
  rejected: FieldWriteError[];
  unchanged: string[];
  /** A sentence describing what happened, for the assistant to relay. */
  message: string;
}

/**
 * The canonical write path for employee attributes.
 *
 * Nothing else writes `Employee.attributes`. Routing every change through
 * here is what guarantees the three invariants the product depends on: values
 * are validated against the account's schema, permission decides between
 * applying and requesting approval, and every change leaves an audit row.
 */
export async function applyEmployeeChanges(
  input: ApplyChangesInput,
): Promise<ApplyChangesResult> {
  const { accountId, employeeId, actor } = input;

  const [employee, schema, account] = await Promise.all([
    prisma.employee.findFirstOrThrow({
      where: { id: employeeId, accountId },
      select: { id: true, fullName: true, attributes: true },
    }),
    loadSchema(accountId, "EMPLOYEE"),
    prisma.account.findFirstOrThrow({
      where: { id: accountId },
      select: { countryCode: true },
    }),
  ]);

  const current = (employee.attributes ?? {}) as AttributeBag;

  const resolution = schema.resolveWrite({
    current,
    changes: input.changes,
    actor,
    context: { countryCode: account.countryCode },
  });

  const appliedKeys = Object.keys(resolution.applied);
  const approvalKeys = Object.keys(resolution.requiresApproval);
  const approvalsRaised: number[] = [];

  // One transaction so a partial failure cannot leave an attribute updated
  // with no audit row, or an approval request with no record of who asked.
  await prisma.$transaction(async (tx) => {
    if (appliedKeys.length > 0) {
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          attributes: { ...current, ...resolution.applied } as never,
        },
      });

      await tx.dataChange.createMany({
        data: appliedKeys.map((key) => ({
          accountId,
          entity: "EMPLOYEE" as const,
          entityId: employeeId,
          fieldKey: key,
          previousValue: (current[key] ?? null) as never,
          newValue: resolution.applied[key] as never,
          changedByUserId: actor.userId ?? null,
          actorRole: actor.role,
          source: input.conversationId ? ("CHAT" as const) : ("API" as const),
          justification: input.justification ?? null,
        })),
      });
    }

    for (const key of approvalKeys) {
      const field = schema.get(key);
      const newValue = resolution.requiresApproval[key];

      const request = await tx.approvalRequest.create({
        data: {
          accountId,
          type: "FIELD_CHANGE",
          employeeId,
          requestedByUserId: actor.userId ?? null,
          payload: {
            entity: "EMPLOYEE",
            entityId: employeeId,
            changes: { [key]: newValue },
          } as never,
          summary: `${employee.fullName}: change ${
            field?.label ?? key
          } to ${formatValue(newValue)}`,
          rationale: input.justification ?? null,
          conversationId: input.conversationId ?? null,
        },
        select: { seq: true },
      });

      approvalsRaised.push(request.seq);
    }
  });

  return {
    applied: resolution.applied,
    approvalsRaised,
    rejected: resolution.rejected,
    unchanged: resolution.unchanged,
    message: describeOutcome(schema, resolution, approvalsRaised),
  };
}

function describeOutcome(
  schema: Awaited<ReturnType<typeof loadSchema>>,
  resolution: {
    applied: AttributeBag;
    requiresApproval: AttributeBag;
    rejected: FieldWriteError[];
    unchanged: string[];
  },
  approvalsRaised: number[],
): string {
  const parts: string[] = [];

  const appliedKeys = Object.keys(resolution.applied);
  if (appliedKeys.length > 0) {
    const described = appliedKeys
      .map((key) => {
        const label = schema.get(key)?.label ?? key;
        return `${label} is now ${formatValue(resolution.applied[key]!)}`;
      })
      .join(", and ");
    parts.push(`Done — ${described}.`);
  }

  if (approvalsRaised.length > 0) {
    const references = approvalsRaised.map((seq) => `REQ-${seq}`).join(", ");
    parts.push(
      approvalsRaised.length === 1
        ? `I've sent that to your manager to approve (${references}).`
        : `I've sent those to your manager to approve (${references}).`,
    );
  }

  if (resolution.unchanged.length > 0 && parts.length === 0) {
    const labels = resolution.unchanged
      .map((key) => schema.get(key)?.label ?? key)
      .join(", ");
    parts.push(`${labels} was already set to that, so nothing changed.`);
  }

  for (const rejection of resolution.rejected) {
    parts.push(rejection.message);
  }

  return parts.length > 0
    ? parts.join(" ")
    : "I couldn't find anything to change there.";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
