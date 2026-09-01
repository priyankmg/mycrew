import { z } from "zod";

import { ToolInputError, type ToolDefinition } from "../agent/tools.ts";
import {
  decideRequest,
  getRequestStatus,
  listPendingRequests,
  previewDecision,
  RequestInputError,
  submitLeaveRequest,
} from "../services/request-service.ts";
import { jsonSchema, parseWith, resolveEmployeeId } from "./helpers.ts";

const requestLeaveInput = z.object({
  leaveType: z
    .string()
    .describe("Kind of leave, e.g. sick or unpaid."),
  startDate: z
    .string()
    .describe("First day off, as YYYY-MM-DD in the account timezone."),
  endDate: z
    .string()
    .optional()
    .describe("Last day off, as YYYY-MM-DD. Omit for a single day."),
  hours: z
    .number()
    .optional()
    .describe("Hours off, when this is only part of a day."),
  reason: z
    .string()
    .optional()
    .describe("Their reason, in their own words."),
  employeeRef: z
    .string()
    .optional()
    .describe("Who the leave is for. Omit when the caller means themselves."),
});

export const requestLeaveTool: ToolDefinition<
  z.infer<typeof requestLeaveInput>
> = {
  name: "request_leave",
  description:
    "File a leave request. Staff requests go to the owner to approve. " +
    "An owner filing leave for someone records it as already approved.",
  inputSchema: jsonSchema(requestLeaveInput),
  mutates: true,
  parse: (input) => parseWith(requestLeaveInput, input),

  async summarize(input, context) {
    try {
      await resolveEmployeeId(context, input.employeeRef);
      const endDate = input.endDate ?? input.startDate;
      const who =
        context.actor.role === "EMPLOYEE" ? "your" : "their";
      const span =
        input.startDate === endDate
          ? input.startDate
          : `${input.startDate} to ${endDate}`;
      const type = input.leaveType.replace(/_/g, " ");
      const owner = context.actor.role === "OWNER";
      return {
        willChange: true,
        summary: owner
          ? `I'll record ${type} leave for that person on ${span}.`
          : `I'll send ${who} ${type} leave request for ${span} to your manager.`,
      };
    } catch (error) {
      if (error instanceof ToolInputError) {
        return { willChange: false, message: error.message };
      }
      throw error;
    }
  },

  async execute(input, context) {
    const employeeId = await resolveEmployeeId(context, input.employeeRef);
    try {
      const result = await submitLeaveRequest({
        accountId: context.accountId,
        employeeId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        actor: context.actor,
        conversationId: context.conversationId,
        ...(input.endDate ? { endDate: input.endDate } : {}),
        ...(input.hours !== undefined ? { hours: input.hours } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return { message: result.message, data: result };
    } catch (error) {
      if (error instanceof RequestInputError) {
        throw new ToolInputError(error.message);
      }
      throw error;
    }
  },
};

const listPendingInput = z.object({});

export const listPendingRequestsTool: ToolDefinition<
  z.infer<typeof listPendingInput>
> = {
  name: "list_pending_requests",
  description: "List every request waiting on the owner.",
  inputSchema: jsonSchema(listPendingInput),
  mutates: false,
  parse: (input) => parseWith(listPendingInput, input),

  async execute(_input, context) {
    const result = await listPendingRequests(context.accountId);
    return { message: result.message, data: result };
  },
};

const getStatusInput = z.object({
  reference: z
    .number()
    .optional()
    .describe("The request number, e.g. 42 for REQ-42."),
  query: z
    .string()
    .optional()
    .describe("A phrase from the request to search for."),
});

export const getRequestStatusTool: ToolDefinition<
  z.infer<typeof getStatusInput>
> = {
  name: "get_request_status",
  description:
    "Look up a request by number or description, or list the caller's open ones.",
  inputSchema: jsonSchema(getStatusInput),
  mutates: false,
  parse: (input) => parseWith(getStatusInput, input),

  async execute(input, context) {
    try {
      const result = await getRequestStatus({
        accountId: context.accountId,
        actor: context.actor,
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.query ? { query: input.query } : {}),
      });
      return { message: result.message, data: result };
    } catch (error) {
      if (error instanceof RequestInputError) {
        throw new ToolInputError(error.message);
      }
      throw error;
    }
  },
};

const decideInput = z.object({
  reference: z
    .number()
    .describe("The request number to decide, e.g. 42 for REQ-42."),
  decision: z.enum(["approve", "reject"]),
  note: z
    .string()
    .optional()
    .describe("A short note to attach to the decision."),
});

export const decideRequestTool: ToolDefinition<z.infer<typeof decideInput>> = {
  name: "decide_request",
  description:
    "Approve or reject a pending request. Approving a field change " +
    "applies it to the staff record.",
  inputSchema: jsonSchema(decideInput),
  mutates: true,
  parse: (input) => parseWith(decideInput, input),

  async summarize(input, context) {
    const preview = await previewDecision({
      accountId: context.accountId,
      reference: input.reference,
      decision: input.decision,
      actor: context.actor,
      conversationId: context.conversationId,
      ...(input.note ? { note: input.note } : {}),
    });
    if (!preview.willChange) {
      return { willChange: false, message: preview.message };
    }
    return { willChange: true, summary: preview.summary ?? preview.message };
  },

  async execute(input, context) {
    try {
      const result = await decideRequest({
        accountId: context.accountId,
        reference: input.reference,
        decision: input.decision,
        actor: context.actor,
        conversationId: context.conversationId,
        ...(input.note ? { note: input.note } : {}),
      });
      return { message: result.message, data: result };
    } catch (error) {
      if (error instanceof RequestInputError) {
        throw new ToolInputError(error.message);
      }
      throw error;
    }
  },
};
