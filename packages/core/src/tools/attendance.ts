import { z } from "zod";

import { ToolInputError, type ToolDefinition } from "../agent/tools.ts";
import {
  AttendanceInputError,
  previewAttendance,
  recordAttendance,
} from "../services/attendance-service.ts";
import { jsonSchema, parseWith, resolveEmployeeId } from "./helpers.ts";

const recordAttendanceInput = z.object({
  direction: z
    .enum(["in", "out"])
    .describe("Whether the person is starting or ending their shift."),
  time: z
    .string()
    .optional()
    .describe(
      "When they punched, as HH:MM or a 12-hour time like 8:45am. " +
        "Omit to use now.",
    ),
  justification: z
    .string()
    .optional()
    .describe("Their reason, in their own words, if they were late or early."),
  employeeRef: z
    .string()
    .optional()
    .describe("Who to record hours for. Omit when the caller means themselves."),
});

export const recordAttendanceTool: ToolDefinition<
  z.infer<typeof recordAttendanceInput>
> = {
  name: "record_attendance",
  description:
    "Record a clock-in or clock-out. Compares the time against the " +
    "person's scheduled shift and asks why if they are late or early.",
  inputSchema: jsonSchema(recordAttendanceInput),
  mutates: true,
  parse: (input) => parseWith(recordAttendanceInput, input),

  async summarize(input, context) {
    try {
      const employeeId = await resolveEmployeeId(context, input.employeeRef);
      const preview = await previewAttendance({
        accountId: context.accountId,
        employeeId,
        direction: input.direction,
        actor: context.actor,
        timezone: context.timezone,
        now: context.now,
        conversationId: context.conversationId,
        ...(input.time ? { time: input.time } : {}),
        ...(input.justification ? { justification: input.justification } : {}),
      });
      if (!preview.willChange) {
        return { willChange: false, message: preview.message };
      }
      return { willChange: true, summary: preview.summary ?? preview.message };
    } catch (error) {
      if (
        error instanceof ToolInputError ||
        error instanceof AttendanceInputError
      ) {
        return { willChange: false, message: error.message };
      }
      throw error;
    }
  },

  async execute(input, context) {
    const employeeId = await resolveEmployeeId(context, input.employeeRef);
    try {
      const result = await recordAttendance({
        accountId: context.accountId,
        employeeId,
        direction: input.direction,
        actor: context.actor,
        timezone: context.timezone,
        now: context.now,
        conversationId: context.conversationId,
        ...(input.time ? { time: input.time } : {}),
        ...(input.justification ? { justification: input.justification } : {}),
      });
      return { message: result.message, data: result };
    } catch (error) {
      if (error instanceof AttendanceInputError) {
        throw new ToolInputError(error.message);
      }
      throw error;
    }
  },
};
