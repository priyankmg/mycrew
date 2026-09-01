import { prisma } from "@mycrew/db";

import type { ToolActor } from "../agent/tools.ts";
import { coerceValue } from "../schema/coerce.ts";
import { dateOnly, isIsoDate } from "./time.ts";
import { loadSchema } from "./schema-service.ts";
import type { AttributeBag, FieldSpec, FieldWriteError } from "../schema/types.ts";

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

export class EmployeeInputError extends Error {
  override readonly name = "EmployeeInputError";
}

export interface AddEmployeeInput {
  accountId: string;
  fullName: string;
  phone?: string;
  email?: string;
  jobTitle?: string;
  startDate?: string;
  employmentType?: "HOURLY" | "SALARIED" | "CONTRACTOR";
  /** Raw pay rate; stored through the schema engine as `pay_rate`. */
  payRate?: unknown;
  actor: ToolActor;
  conversationId?: string;
}

export interface AddEmployeeResult {
  employeeId: string;
  userId: string;
  fullName: string;
  message: string;
}

const PHONE_SPEC: FieldSpec = {
  key: "phone",
  label: "Phone number",
  entity: "EMPLOYEE",
  dataType: "PHONE",
  isRequired: false,
  editPolicy: "OWNER_ONLY",
  visibility: "EMPLOYEE_VISIBLE",
  sensitivity: "CONFIDENTIAL",
};

/**
 * Create a staff record and a login so they can talk to the assistant.
 *
 * The chat identity is a `User` row. Without it they exist on the roster
 * but cannot clock in or request leave, because those tools resolve from
 * who is speaking.
 */
export async function addEmployee(
  input: AddEmployeeInput,
): Promise<AddEmployeeResult> {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) {
    throw new EmployeeInputError("I need their full name.");
  }

  const account = await prisma.account.findFirstOrThrow({
    where: { id: input.accountId },
    select: { countryCode: true },
  });

  let phoneE164: string | null = null;
  if (input.phone?.trim()) {
    const coerced = coerceValue(PHONE_SPEC, input.phone, {
      countryCode: account.countryCode,
    });
    if (!coerced.ok) throw new EmployeeInputError(coerced.message);
    phoneE164 = typeof coerced.value === "string" ? coerced.value : null;
  }

  if (phoneE164) {
    const clash = await prisma.employee.findFirst({
      where: { accountId: input.accountId, phoneE164 },
      select: { fullName: true },
    });
    if (clash) {
      throw new EmployeeInputError(
        `That number is already on ${clash.fullName}'s record.`,
      );
    }
  }

  let startDate: Date | null = null;
  if (input.startDate) {
    if (!isIsoDate(input.startDate)) {
      throw new EmployeeInputError(
        `I need the start date as YYYY-MM-DD — I can't guess from "${input.startDate}".`,
      );
    }
    startDate = dateOnly(input.startDate);
  }

  const employmentType = input.employmentType ?? "HOURLY";

  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        accountId: input.accountId,
        fullName,
        phoneE164,
        email: input.email?.trim() || null,
        jobTitle: input.jobTitle?.trim() || null,
        startDate,
        status: "ACTIVE",
        employmentType,
      },
      select: { id: true },
    });

    const user = await tx.user.create({
      data: {
        accountId: input.accountId,
        role: "EMPLOYEE",
        displayName: fullName,
        phoneE164,
        email: input.email?.trim() || null,
        employeeId: employee.id,
      },
      select: { id: true },
    });

    await tx.dataChange.create({
      data: {
        accountId: input.accountId,
        entity: "EMPLOYEE",
        entityId: employee.id,
        newValue: { fullName } as never,
        changedByUserId: input.actor.userId ?? null,
        actorRole: input.actor.role,
        source: input.conversationId ? "CHAT" : "API",
      },
    });

    return { employeeId: employee.id, userId: user.id };
  });

  if (input.payRate !== undefined && input.payRate !== null) {
    await applyEmployeeChanges({
      accountId: input.accountId,
      employeeId: created.employeeId,
      changes: { pay_rate: input.payRate },
      actor: input.actor,
      conversationId: input.conversationId,
    });
  }

  const extras = [
    input.jobTitle?.trim(),
    phoneE164,
    input.payRate !== undefined && input.payRate !== null
      ? `pay ${String(input.payRate)}`
      : null,
  ].filter(Boolean);

  const detail = extras.length > 0 ? ` (${extras.join(", ")})` : "";

  return {
    employeeId: created.employeeId,
    userId: created.userId,
    fullName,
    message: `Done — ${fullName} is on the team${detail}. They can chat from the simulator now.`,
  };
}
