import { prisma } from "@mycrew/db";

import type { ToolActor } from "../agent/tools.ts";
import { applyEmployeeChanges } from "./employee-service.ts";
import { dateOnly, isIsoDate } from "./time.ts";

export class RequestInputError extends Error {
  override readonly name = "RequestInputError";
}

export interface SubmitLeaveInput {
  accountId: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate?: string;
  hours?: number;
  reason?: string;
  actor: ToolActor;
  conversationId?: string;
}

export interface SubmitLeaveResult {
  seq: number;
  leaveRequestId: string;
  status: "PENDING" | "APPROVED";
  message: string;
  summary: string;
}

export interface PendingRequestRow {
  seq: number;
  type: string;
  summary: string;
  employeeName: string;
  createdAt: Date;
}

export interface RequestStatusRow {
  seq: number;
  type: string;
  status: string;
  summary: string;
  employeeName: string;
  rationale: string | null;
  decisionNote: string | null;
}

export interface DecideRequestInput {
  accountId: string;
  reference: number;
  decision: "approve" | "reject";
  note?: string;
  actor: ToolActor;
  conversationId?: string;
}

const LEAVE_TYPE_ALIASES: Record<string, string> = {
  sick: "sick",
  sick_day: "sick",
  illness: "sick",
  unpaid: "unpaid",
  vacation: "unpaid",
  holiday: "unpaid",
  annual: "unpaid",
};

export function normalizeLeaveType(raw: string): string {
  const key = raw.trim().toLowerCase();
  const collapsed = key.replace(/\s+/g, "_");
  const firstWord = key.split(/\s+/)[0] ?? key;
  return (
    LEAVE_TYPE_ALIASES[key] ??
    LEAVE_TYPE_ALIASES[collapsed] ??
    LEAVE_TYPE_ALIASES[firstWord] ??
    collapsed
  );
}

export function leaveSummary(input: {
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
}): string {
  const type = input.leaveType.replace(/_/g, " ");
  const span =
    input.startDate === input.endDate
      ? input.startDate
      : `${input.startDate} to ${input.endDate}`;
  return `${input.employeeName}: ${type} leave ${span}`;
}

export async function submitLeaveRequest(
  input: SubmitLeaveInput,
): Promise<SubmitLeaveResult> {
  const startDate = requireIsoDate(input.startDate, "start date");
  const endDate = requireIsoDate(input.endDate ?? input.startDate, "end date");
  if (endDate < startDate) {
    throw new RequestInputError("The end date is before the start date.");
  }

  const leaveType = normalizeLeaveType(input.leaveType);
  const employee = await prisma.employee.findFirstOrThrow({
    where: { id: input.employeeId, accountId: input.accountId },
    select: { fullName: true },
  });

  const summary = leaveSummary({
    employeeName: employee.fullName,
    leaveType,
    startDate,
    endDate,
  });

  const ownerFiled = input.actor.role === "OWNER";
  const status = ownerFiled ? "APPROVED" : "PENDING";

  const created = await prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.create({
      data: {
        accountId: input.accountId,
        employeeId: input.employeeId,
        leaveType,
        startDate: dateOnly(startDate),
        endDate: dateOnly(endDate),
        hours: input.hours ?? null,
        reason: input.reason ?? null,
        status,
      },
      select: { id: true },
    });

    const request = await tx.approvalRequest.create({
      data: {
        accountId: input.accountId,
        type: "LEAVE_REQUEST",
        status,
        employeeId: input.employeeId,
        requestedByUserId: input.actor.userId ?? null,
        payload: {
          leaveType,
          startDate,
          endDate,
          hours: input.hours ?? null,
        } as never,
        summary,
        rationale: input.reason ?? null,
        conversationId: input.conversationId ?? null,
        leaveRequestId: leave.id,
        ...(ownerFiled
          ? {
              decisionByUserId: input.actor.userId ?? null,
              decidedAt: new Date(),
            }
          : {}),
      },
      select: { seq: true },
    });

    return { leaveId: leave.id, seq: request.seq };
  });

  const reference = `REQ-${created.seq}`;
  const message = ownerFiled
    ? `Done — ${summary} (${reference}).`
    : `I've sent that to your manager to approve (${reference}).`;

  return {
    seq: created.seq,
    leaveRequestId: created.leaveId,
    status,
    message,
    summary,
  };
}

export async function listPendingRequests(
  accountId: string,
): Promise<{ message: string; requests: PendingRequestRow[] }> {
  const rows = await prisma.approvalRequest.findMany({
    where: { accountId, status: { in: ["PENDING", "NEEDS_INFO"] } },
    select: {
      seq: true,
      type: true,
      summary: true,
      createdAt: true,
      employee: { select: { fullName: true } },
    },
    orderBy: { seq: "asc" },
  });

  const requests = rows.map((row) => ({
    seq: row.seq,
    type: row.type,
    summary: row.summary,
    employeeName: row.employee.fullName,
    createdAt: row.createdAt,
  }));

  if (requests.length === 0) {
    return { message: "Nothing is waiting on you.", requests };
  }

  const lines = requests.map(
    (request) => `REQ-${request.seq} — ${request.summary}`,
  );
  return {
    message: `${requests.length} waiting:\n${lines.join("\n")}`,
    requests,
  };
}

export async function getRequestStatus(input: {
  accountId: string;
  actor: ToolActor;
  reference?: number;
  query?: string;
}): Promise<{ message: string; request: RequestStatusRow | null }> {
  const scoped =
    input.actor.role === "EMPLOYEE" && input.actor.employeeId
      ? { employeeId: input.actor.employeeId }
      : {};

  if (input.reference !== undefined) {
    const row = await prisma.approvalRequest.findFirst({
      where: { accountId: input.accountId, seq: input.reference, ...scoped },
      select: statusSelect,
    });
    if (!row) {
      throw new RequestInputError(
        `I couldn't find REQ-${input.reference}${
          input.actor.role === "EMPLOYEE" ? " on your record" : ""
        }.`,
      );
    }
    return { message: formatStatus(row), request: toStatusRow(row) };
  }

  const query = input.query?.trim();
  if (query) {
    const matches = await prisma.approvalRequest.findMany({
      where: {
        accountId: input.accountId,
        ...scoped,
        summary: { contains: query, mode: "insensitive" },
      },
      select: statusSelect,
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (matches.length === 0) {
      throw new RequestInputError(`I couldn't find a request matching "${query}".`);
    }
    if (matches.length > 1) {
      const names = matches.map((match) => `REQ-${match.seq}`).join(", ");
      throw new RequestInputError(
        `There's more than one match: ${names}. Which number?`,
      );
    }
    return { message: formatStatus(matches[0]!), request: toStatusRow(matches[0]!) };
  }

  const open = await prisma.approvalRequest.findMany({
    where: {
      accountId: input.accountId,
      ...scoped,
      status: { in: ["PENDING", "NEEDS_INFO"] },
    },
    select: statusSelect,
    orderBy: { seq: "asc" },
    take: 10,
  });

  if (open.length === 0) {
    return {
      message:
        input.actor.role === "EMPLOYEE"
          ? "You don't have any open requests."
          : "Nothing is waiting.",
      request: null,
    };
  }

  const lines = open.map((row) => formatStatus(row));
  return { message: lines.join("\n"), request: toStatusRow(open[0]!) };
}

export async function previewDecision(
  input: DecideRequestInput,
): Promise<{ willChange: boolean; message: string; summary?: string }> {
  const request = await loadDecidable(input);
  if (request instanceof RequestInputError) {
    return { willChange: false, message: request.message };
  }
  if (request.status !== "PENDING" && request.status !== "NEEDS_INFO") {
    return {
      willChange: false,
      message: `REQ-${request.seq} is already ${request.status.toLowerCase()}.`,
    };
  }

  const verb = input.decision === "approve" ? "approve" : "reject";
  return {
    willChange: true,
    message: "",
    summary: `I'll ${verb} REQ-${request.seq} (${request.summary}).`,
  };
}

export async function decideRequest(
  input: DecideRequestInput,
): Promise<{ message: string; seq: number; status: string }> {
  const request = await loadDecidable(input);
  if (request instanceof RequestInputError) throw request;

  if (request.status !== "PENDING" && request.status !== "NEEDS_INFO") {
    return {
      message: `REQ-${request.seq} is already ${request.status.toLowerCase()}.`,
      seq: request.seq,
      status: request.status,
    };
  }

  const approved = input.decision === "approve";
  const nextStatus = approved ? "APPROVED" : "REJECTED";

  if (approved && request.type === "FIELD_CHANGE") {
    const payload = request.payload as {
      entity?: string;
      entityId?: string;
      changes?: Record<string, unknown>;
    };
    const changes = payload.changes ?? {};
    if (Object.keys(changes).length > 0) {
      await applyEmployeeChanges({
        accountId: input.accountId,
        employeeId: request.employeeId,
        changes,
        actor: {
          role: "SYSTEM",
          isSubject: false,
          displayName: "mycrew",
          userId: input.actor.userId,
        },
        justification: request.rationale ?? input.note,
        conversationId: input.conversationId,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.approvalRequest.update({
      where: { id: request.id },
      data: {
        status: nextStatus,
        decisionByUserId: input.actor.userId ?? null,
        decisionNote: input.note ?? null,
        decidedAt: new Date(),
      },
    });

    if (request.leaveRequestId) {
      await tx.leaveRequest.update({
        where: { id: request.leaveRequestId },
        data: { status: nextStatus },
      });
    }
  });

  const verb = approved ? "Approved" : "Rejected";
  return {
    message: `${verb} REQ-${request.seq} — ${request.summary}.`,
    seq: request.seq,
    status: nextStatus,
  };
}

const statusSelect = {
  seq: true,
  type: true,
  status: true,
  summary: true,
  rationale: true,
  decisionNote: true,
  employee: { select: { fullName: true } },
} as const;

async function loadDecidable(input: DecideRequestInput) {
  const request = await prisma.approvalRequest.findFirst({
    where: { accountId: input.accountId, seq: input.reference },
    select: {
      id: true,
      seq: true,
      type: true,
      status: true,
      summary: true,
      payload: true,
      rationale: true,
      employeeId: true,
      leaveRequestId: true,
    },
  });
  if (!request) {
    return new RequestInputError(`I couldn't find REQ-${input.reference}.`);
  }
  return request;
}

function requireIsoDate(value: string, label: string): string {
  if (!isIsoDate(value)) {
    throw new RequestInputError(
      `I need a ${label} as YYYY-MM-DD — I can't guess from "${value}".`,
    );
  }
  return value;
}

function formatStatus(row: {
  seq: number;
  status: string;
  summary: string;
}): string {
  return `REQ-${row.seq} is ${row.status.toLowerCase().replace("_", " ")} — ${row.summary}.`;
}

function toStatusRow(row: {
  seq: number;
  type: string;
  status: string;
  summary: string;
  rationale: string | null;
  decisionNote: string | null;
  employee: { fullName: string };
}): RequestStatusRow {
  return {
    seq: row.seq,
    type: row.type,
    status: row.status,
    summary: row.summary,
    employeeName: row.employee.fullName,
    rationale: row.rationale,
    decisionNote: row.decisionNote,
  };
}
