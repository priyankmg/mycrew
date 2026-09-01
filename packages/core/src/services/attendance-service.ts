import { prisma, type AttendanceFlag } from "@mycrew/db";

import type { ToolActor } from "../agent/tools.ts";
import {
  dateOnly,
  formatDateInZone,
  formatTimeInZone,
  instantInZone,
  parseClockTime,
} from "./time.ts";

export type AttendanceDirection = "in" | "out";

export interface ShiftWindow {
  startAt: Date;
  endAt: Date;
}

export interface RecordAttendanceInput {
  accountId: string;
  employeeId: string;
  direction: AttendanceDirection;
  /** Wall-clock time from chat, e.g. "08:45" or "8:45am". Omit to use `now`. */
  time?: string;
  justification?: string;
  actor: ToolActor;
  conversationId?: string;
  timezone: string;
  now: Date;
}

export interface AttendancePreview {
  willChange: boolean;
  message: string;
  summary?: string;
  flags: AttendanceFlag[];
  askWhy: boolean;
}

export interface RecordAttendanceResult {
  message: string;
  flags: AttendanceFlag[];
  askWhy: boolean;
  workDate: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
}

interface PlannedPunch {
  employeeName: string;
  workDate: string;
  at: Date;
  existing: {
    id: string;
    clockInAt: Date | null;
    clockOutAt: Date | null;
    flags: AttendanceFlag[];
    justification: string | null;
    lockedAt: Date | null;
    status: string;
  } | null;
  shift: ShiftWindow | null;
  nextClockIn: Date | null;
  nextClockOut: Date | null;
  flags: AttendanceFlag[];
  askWhy: boolean;
}

/**
 * Decide LATE_IN / EARLY_OUT from a punch and an optional scheduled shift.
 *
 * No shift means no flag: we cannot call someone late against a schedule
 * that does not exist. OUTSIDE_SCHEDULE is reserved for "they have shifts
 * on other days but none that match this punch".
 */
export function assessAttendance(input: {
  clockInAt: Date | null;
  clockOutAt: Date | null;
  shift: ShiftWindow | null;
  hasOtherShifts?: boolean;
}): AttendanceFlag[] {
  const flags: AttendanceFlag[] = [];

  if (!input.shift) {
    if (input.hasOtherShifts) flags.push("OUTSIDE_SCHEDULE");
    return flags;
  }

  if (input.clockInAt && input.clockInAt > input.shift.startAt) {
    flags.push("LATE_IN");
  }
  if (input.clockOutAt && input.clockOutAt < input.shift.endAt) {
    flags.push("EARLY_OUT");
  }
  return flags;
}

export function resolveWorkDate(
  at: Date,
  timeZone: string,
  coveringShift: { startAt: Date } | null,
): string {
  if (coveringShift) return formatDateInZone(coveringShift.startAt, timeZone);
  return formatDateInZone(at, timeZone);
}

export function pickShift<T extends ShiftWindow>(
  shifts: readonly T[],
  at: Date,
  timeZone: string,
): T | null {
  const covering = shifts.filter(
    (shift) => shift.startAt <= at && at <= shift.endAt,
  );
  if (covering.length === 1) return covering[0]!;
  if (covering.length > 1) {
    return nearestStart(covering, at);
  }

  const workDate = formatDateInZone(at, timeZone);
  const sameDay = shifts.filter(
    (shift) => formatDateInZone(shift.startAt, timeZone) === workDate,
  );
  return sameDay.length > 0 ? nearestStart(sameDay, at) : null;
}

export function resolvePunchInstant(input: {
  now: Date;
  timezone: string;
  time?: string;
}): Date {
  if (!input.time) return input.now;
  const parsed = parseClockTime(input.time);
  if (!parsed) {
    throw new AttendanceInputError(
      `I didn't catch the time — try something like 8:45am.`,
    );
  }
  const day = formatDateInZone(input.now, input.timezone);
  return instantInZone(day, parsed, input.timezone);
}

export class AttendanceInputError extends Error {
  override readonly name = "AttendanceInputError";
}

export async function previewAttendance(
  input: RecordAttendanceInput,
): Promise<AttendancePreview> {
  const plan = await planPunch(input);
  if (plan instanceof AttendanceInputError) {
    return { willChange: false, message: plan.message, flags: [], askWhy: false };
  }

  const inert = inertReason(plan, input);
  if (inert) {
    return { willChange: false, message: inert, flags: plan.flags, askWhy: false };
  }

  return {
    willChange: true,
    message: "",
    summary: describePlan(plan, input),
    flags: plan.flags,
    askWhy: plan.askWhy,
  };
}

export async function recordAttendance(
  input: RecordAttendanceInput,
): Promise<RecordAttendanceResult> {
  const plan = await planPunch(input);
  if (plan instanceof AttendanceInputError) {
    throw plan;
  }

  const inert = inertReason(plan, input);
  if (inert) {
    return {
      message: inert,
      flags: plan.flags,
      askWhy: false,
      workDate: plan.workDate,
      clockInAt: plan.existing?.clockInAt ?? null,
      clockOutAt: plan.existing?.clockOutAt ?? null,
    };
  }

  const { accountId, employeeId, actor } = input;
  const justification = input.justification?.trim() || plan.existing?.justification;
  const flags = plan.flags;
  const status =
    plan.nextClockOut
      ? flags.length > 0
        ? "FLAGGED"
        : "COMPLETE"
      : flags.length > 0
        ? "FLAGGED"
        : "OPEN";

  const workDate = dateOnly(plan.workDate);
  let entryId = plan.existing?.id;

  await prisma.$transaction(async (tx) => {
    if (plan.existing) {
      await tx.attendanceEntry.update({
        where: { id: plan.existing.id },
        data: {
          clockInAt: plan.nextClockIn,
          clockOutAt: plan.nextClockOut,
          flags,
          status,
          justification: justification ?? null,
          recordedByUserId: actor.userId ?? null,
          source: input.conversationId ? "CHAT" : "API",
        },
      });
    } else {
      const created = await tx.attendanceEntry.create({
        data: {
          accountId,
          employeeId,
          workDate,
          clockInAt: plan.nextClockIn,
          clockOutAt: plan.nextClockOut,
          flags,
          status,
          justification: justification ?? null,
          recordedByUserId: actor.userId ?? null,
          source: input.conversationId ? "CHAT" : "API",
        },
        select: { id: true },
      });
      entryId = created.id;
    }

    const changes: Array<{
      fieldKey: string;
      previous: Date | null;
      next: Date | null;
    }> = [];

    if (plan.nextClockIn?.getTime() !== plan.existing?.clockInAt?.getTime()) {
      changes.push({
        fieldKey: "clock_in_at",
        previous: plan.existing?.clockInAt ?? null,
        next: plan.nextClockIn,
      });
    }
    if (plan.nextClockOut?.getTime() !== plan.existing?.clockOutAt?.getTime()) {
      changes.push({
        fieldKey: "clock_out_at",
        previous: plan.existing?.clockOutAt ?? null,
        next: plan.nextClockOut,
      });
    }

    if (changes.length > 0 && entryId) {
      await tx.dataChange.createMany({
        data: changes.map((change) => ({
          accountId,
          entity: "ATTENDANCE" as const,
          entityId: entryId!,
          fieldKey: change.fieldKey,
          previousValue: (change.previous?.toISOString() ?? null) as never,
          newValue: (change.next?.toISOString() ?? null) as never,
          changedByUserId: actor.userId ?? null,
          actorRole: actor.role,
          source: input.conversationId ? ("CHAT" as const) : ("API" as const),
          justification: input.justification ?? null,
        })),
      });
    }
  });

  return {
    message: describeOutcome(plan, input, justification ?? null),
    flags,
    askWhy: plan.askWhy,
    workDate: plan.workDate,
    clockInAt: plan.nextClockIn,
    clockOutAt: plan.nextClockOut,
  };
}

async function planPunch(
  input: RecordAttendanceInput,
): Promise<PlannedPunch | AttendanceInputError> {
  const at = resolvePunchInstant(input);

  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, accountId: input.accountId },
    select: { id: true, fullName: true },
  });
  if (!employee) {
    return new AttendanceInputError("I couldn't find that member of staff.");
  }

  const nearby = await loadNearbyShifts(input.accountId, input.employeeId, at);
  const shift = pickShift(nearby, at, input.timezone);
  const hasOtherShifts =
    nearby.length === 0
      ? (await prisma.shift.count({
          where: { accountId: input.accountId, employeeId: input.employeeId },
        })) > 0
      : nearby.length > 0 && !shift;

  let existing = await findOpenEntry(input.accountId, input.employeeId);
  const workDate =
    input.direction === "out" && existing
      ? ymdFromDateOnly(existing.workDate)
      : resolveWorkDate(at, input.timezone, shift);

  if (!existing || ymdFromDateOnly(existing.workDate) !== workDate) {
    existing = await prisma.attendanceEntry.findFirst({
      where: {
        employeeId: input.employeeId,
        workDate: dateOnly(workDate),
      },
      select: {
        id: true,
        clockInAt: true,
        clockOutAt: true,
        flags: true,
        justification: true,
        lockedAt: true,
        status: true,
        workDate: true,
      },
    });
  }

  const nextClockIn =
    input.direction === "in" ? at : (existing?.clockInAt ?? null);
  const nextClockOut =
    input.direction === "out" ? at : (existing?.clockOutAt ?? null);

  const flags = assessAttendance({
    clockInAt: nextClockIn,
    clockOutAt: nextClockOut,
    shift,
    hasOtherShifts,
  });

  return {
    employeeName: employee.fullName,
    workDate,
    at,
    existing: existing
      ? {
          id: existing.id,
          clockInAt: existing.clockInAt,
          clockOutAt: existing.clockOutAt,
          flags: existing.flags,
          justification: existing.justification,
          lockedAt: existing.lockedAt,
          status: existing.status,
        }
      : null,
    shift,
    nextClockIn,
    nextClockOut,
    flags,
    askWhy: flags.length > 0 && !input.justification?.trim(),
  };
}

function inertReason(
  plan: PlannedPunch,
  input: RecordAttendanceInput,
): string | null {
  const who = subjectLabel(input.actor, plan.employeeName);
  const tz = input.timezone;

  if (plan.existing?.lockedAt || plan.existing?.status === "LOCKED") {
    return `Those hours are locked for payroll and can't be changed.`;
  }

  if (input.direction === "in" && plan.existing?.clockInAt) {
    return `${capitalize(who)} already clocked in at ${formatTimeInZone(plan.existing.clockInAt, tz)}.`;
  }

  if (input.direction === "out" && plan.existing?.clockOutAt) {
    return `${capitalize(who)} already clocked out at ${formatTimeInZone(plan.existing.clockOutAt, tz)}.`;
  }

  if (input.direction === "out" && !plan.existing?.clockInAt) {
    return `I don't have ${who} clocked in today. Clock in first, or tell me when you started.`;
  }

  return null;
}

function describePlan(
  plan: PlannedPunch,
  input: RecordAttendanceInput,
): string {
  const who = subjectLabel(input.actor, plan.employeeName);
  const time = formatTimeInZone(plan.at, input.timezone);
  const verb = input.direction === "in" ? "clock" : "clock";
  const direction = input.direction === "in" ? "in" : "out";
  const late = flagNote(plan, input.timezone);
  return `I'll ${verb} ${who} ${direction} at ${time}${late}.`;
}

function describeOutcome(
  plan: PlannedPunch,
  input: RecordAttendanceInput,
  justification: string | null,
): string {
  const who = subjectLabel(input.actor, plan.employeeName);
  const time = formatTimeInZone(plan.at, input.timezone);
  const done =
    input.direction === "in"
      ? `${capitalize(who)} clocked in at ${time}.`
      : `${capitalize(who)} clocked out at ${time}.`;

  if (plan.askWhy) {
    const why =
      plan.flags.includes("LATE_IN")
        ? "That's after the shift start"
        : plan.flags.includes("EARLY_OUT")
          ? "That's before the shift finish"
          : "That's off the usual schedule";
    const expected = plan.shift
      ? input.direction === "in"
        ? formatTimeInZone(plan.shift.startAt, input.timezone)
        : formatTimeInZone(plan.shift.endAt, input.timezone)
      : null;
    const against = expected ? ` (${expected})` : "";
    return `${done} ${why}${against} — what happened?`;
  }

  if (justification && plan.flags.length > 0) {
    return `${done} I've noted: ${justification}.`;
  }

  return done;
}

function flagNote(plan: PlannedPunch, timeZone: string): string {
  if (!plan.shift || plan.flags.length === 0) return "";
  if (plan.flags.includes("LATE_IN")) {
    const minutes = Math.round(
      (plan.at.getTime() - plan.shift.startAt.getTime()) / 60_000,
    );
    return ` (${minutes} minute${minutes === 1 ? "" : "s"} after the ${formatTimeInZone(plan.shift.startAt, timeZone)} start)`;
  }
  if (plan.flags.includes("EARLY_OUT")) {
    const minutes = Math.round(
      (plan.shift.endAt.getTime() - plan.at.getTime()) / 60_000,
    );
    return ` (${minutes} minute${minutes === 1 ? "" : "s"} before the ${formatTimeInZone(plan.shift.endAt, timeZone)} finish)`;
  }
  return "";
}

function subjectLabel(actor: ToolActor, employeeName: string): string {
  if (actor.role === "EMPLOYEE") return "you";
  return employeeName;
}

function capitalize(value: string): string {
  return value === "you" ? "You're" : `${value} is`;
}

function nearestStart<T extends ShiftWindow>(shifts: readonly T[], at: Date): T {
  return [...shifts].sort(
    (left, right) =>
      Math.abs(left.startAt.getTime() - at.getTime()) -
      Math.abs(right.startAt.getTime() - at.getTime()),
  )[0]!;
}

function ymdFromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function findOpenEntry(accountId: string, employeeId: string) {
  return prisma.attendanceEntry.findFirst({
    where: { accountId, employeeId, clockOutAt: null, lockedAt: null },
    orderBy: { workDate: "desc" },
    select: {
      id: true,
      clockInAt: true,
      clockOutAt: true,
      flags: true,
      justification: true,
      lockedAt: true,
      status: true,
      workDate: true,
    },
  });
}

async function loadNearbyShifts(
  accountId: string,
  employeeId: string,
  at: Date,
) {
  const windowMs = 36 * 60 * 60 * 1000;
  return prisma.shift.findMany({
    where: {
      accountId,
      employeeId,
      startAt: { lte: new Date(at.getTime() + windowMs) },
      endAt: { gte: new Date(at.getTime() - windowMs) },
    },
    select: { startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });
}
