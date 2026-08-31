import { prisma } from "@mycrew/db";
import type { JsonSchemaObject } from "@mycrew/llm";
import { z } from "zod";

import {
  ToolInputError,
  ToolRegistry,
  type ToolContext,
  type ToolDefinition,
} from "../agent/tools.ts";
import { applyEmployeeChanges } from "../services/employee-service.ts";
import { loadSchema } from "../services/schema-service.ts";
import type { AttributeBag } from "../schema/types.ts";

/**
 * The tool surface exposed to the model.
 *
 * Only tools with working implementations are registered. Declaring a tool
 * the system cannot actually perform would let the assistant promise a
 * business owner something that silently never happens — worse than it
 * saying plainly that it can't help yet.
 *
 * Remaining Phase 1 tools (attendance, leave, approvals, roster import) are
 * listed in docs/roadmap.md with the patterns they should follow.
 */

/** Build a tool's advertised JSON Schema from its Zod schema. */
function jsonSchema(schema: z.ZodType): JsonSchemaObject {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >;
  void $schema;
  return rest as unknown as JsonSchemaObject;
}

/** Turn Zod failures into wording the model can act on. */
function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  throw new ToolInputError(`Those details weren't usable — ${detail}`);
}

// ---------------------------------------------------------------------------
// Resolving who the request is about
// ---------------------------------------------------------------------------

/**
 * Work out which employee a request concerns.
 *
 * Staff are pinned to their own record regardless of what the model passed,
 * so a prompt injection or a model slip cannot redirect a read or write onto
 * a colleague. Owners may name someone, and an ambiguous name is a question
 * rather than a guess.
 */
async function resolveEmployeeId(
  context: ToolContext,
  employeeRef: string | undefined,
): Promise<string> {
  if (context.actor.role === "EMPLOYEE") {
    if (!context.actor.employeeId) {
      throw new ToolInputError(
        "I can't find your staff record — please ask your manager to check.",
      );
    }
    return context.actor.employeeId;
  }

  if (!employeeRef || employeeRef.trim() === "") {
    throw new ToolInputError("Which member of staff did you mean?");
  }

  const reference = employeeRef.trim();

  const exact = await prisma.employee.findFirst({
    where: { accountId: context.accountId, id: reference },
    select: { id: true },
  });
  if (exact) return exact.id;

  const matches = await prisma.employee.findMany({
    where: {
      accountId: context.accountId,
      fullName: { contains: reference, mode: "insensitive" },
      status: { not: "TERMINATED" },
    },
    select: { id: true, fullName: true },
    take: 5,
  });

  if (matches.length === 0) {
    throw new ToolInputError(`I couldn't find anyone called ${reference}.`);
  }
  if (matches.length > 1) {
    const names = matches.map((match) => match.fullName).join(", ");
    throw new ToolInputError(
      `There's more than one match for ${reference}: ${names}. Which one?`,
    );
  }
  return matches[0]!.id;
}

// ---------------------------------------------------------------------------
// get_employee_record  (read)
// ---------------------------------------------------------------------------

const getRecordInput = z.object({
  employeeRef: z
    .string()
    .optional()
    .describe(
      "Who to look up, by name. Omit when the caller means themselves.",
    ),
});

const getEmployeeRecord: ToolDefinition<z.infer<typeof getRecordInput>> = {
  name: "get_employee_record",
  description:
    "Look up the details held for a member of staff, including which of " +
    "them the caller is allowed to change.",
  inputSchema: jsonSchema(getRecordInput),
  mutates: false,
  parse: (input) => parseWith(getRecordInput, input),

  async execute(input, context) {
    const employeeId = await resolveEmployeeId(context, input.employeeRef);

    const [employee, schema] = await Promise.all([
      prisma.employee.findFirstOrThrow({
        where: { id: employeeId, accountId: context.accountId },
        select: {
          fullName: true,
          jobTitle: true,
          status: true,
          employmentType: true,
          startDate: true,
          attributes: true,
        },
      }),
      loadSchema(context.accountId, "EMPLOYEE"),
    ]);

    // `project` filters out anything this actor may not see, so an employee
    // never receives owner-only notes about themselves.
    const fields = schema.project(
      (employee.attributes ?? {}) as AttributeBag,
      context.actor,
    );

    const lines = fields
      .filter((field) => field.value !== null)
      .map((field) => `${field.label}: ${formatValue(field.value)}`);

    const header = [
      employee.fullName,
      employee.jobTitle ? `(${employee.jobTitle})` : null,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      message:
        lines.length > 0
          ? `${header}\n${lines.join("\n")}`
          : `${header} — nothing else on file yet.`,
      data: {
        fullName: employee.fullName,
        jobTitle: employee.jobTitle,
        status: employee.status,
        employmentType: employee.employmentType,
        startDate: employee.startDate,
        fields,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// update_employee_fields  (mutating)
// ---------------------------------------------------------------------------

const updateFieldsInput = z.object({
  employeeRef: z
    .string()
    .optional()
    .describe("Who to update, by name. Omit for the caller themselves."),
  changes: z
    .record(z.string(), z.unknown())
    .describe(
      "Field keys mapped to their new values. Use the exact field keys " +
        "from get_employee_record.",
    ),
  justification: z
    .string()
    .optional()
    .describe("The reason the user gave, in their own words."),
});

const updateEmployeeFields: ToolDefinition<
  z.infer<typeof updateFieldsInput>
> = {
  name: "update_employee_fields",
  description:
    "Change details on a staff record. Changes the caller isn't allowed to " +
    "make directly become a request for their manager to approve.",
  inputSchema: jsonSchema(updateFieldsInput),
  mutates: true,
  parse: (input) => {
    const parsed = parseWith(updateFieldsInput, input);
    if (Object.keys(parsed.changes).length === 0) {
      throw new ToolInputError("What would you like me to change it to?");
    }
    return parsed;
  },

  /**
   * The confirmation prompt is built by re-running the write through the
   * engine in dry-run fashion, so what the user is asked to approve is
   * exactly what will be attempted — including whether it needs a manager.
   */
  async summarize(input, context) {
    const employeeId = await resolveEmployeeId(context, input.employeeRef);

    const [employee, schema] = await Promise.all([
      prisma.employee.findFirstOrThrow({
        where: { id: employeeId, accountId: context.accountId },
        select: { fullName: true, attributes: true },
      }),
      loadSchema(context.accountId, "EMPLOYEE"),
    ]);

    const resolution = schema.resolveWrite({
      current: (employee.attributes ?? {}) as AttributeBag,
      changes: input.changes,
      actor: context.actor,
    });

    const who =
      context.actor.role === "EMPLOYEE" ? "your" : `${employee.fullName}'s`;

    const describe = (bag: AttributeBag) =>
      Object.entries(bag)
        .map(
          ([key, value]) =>
            `${schema.get(key)?.label ?? key} to ${formatValue(value)}`,
        )
        .join(", and ");

    const parts: string[] = [];
    const direct = describe(resolution.applied);
    const gated = describe(resolution.requiresApproval);

    if (direct) parts.push(`set ${who} ${direct}`);
    if (gated) parts.push(`ask your manager to approve ${who} ${gated}`);

    if (parts.length === 0) {
      // Well-formed but inert: not permitted, or already that value. Report
      // the reason instead of prompting for a confirmation that would do
      // nothing.
      const reason =
        resolution.rejected[0]?.message ??
        `That's already what I have for ${who} record.`;
      return { willChange: false, message: reason };
    }

    return { willChange: true, summary: `I'll ${parts.join(", and ")}.` };
  },

  async execute(input, context) {
    const employeeId = await resolveEmployeeId(context, input.employeeRef);

    const result = await applyEmployeeChanges({
      accountId: context.accountId,
      employeeId,
      changes: input.changes,
      actor: context.actor,
      ...(input.justification ? { justification: input.justification } : {}),
      conversationId: context.conversationId,
    });

    return { message: result.message, data: result };
  },
};

// ---------------------------------------------------------------------------
// list_employees  (read, owner only)
// ---------------------------------------------------------------------------

const listEmployeesInput = z.object({
  includeInactive: z
    .boolean()
    .optional()
    .describe("Include people who have left. Defaults to false."),
});

const listEmployees: ToolDefinition<z.infer<typeof listEmployeesInput>> = {
  name: "list_employees",
  description: "List the people on the team.",
  inputSchema: jsonSchema(listEmployeesInput),
  mutates: false,
  parse: (input) => parseWith(listEmployeesInput, input),

  async execute(input, context) {
    const employees = await prisma.employee.findMany({
      where: {
        accountId: context.accountId,
        ...(input.includeInactive ? {} : { status: { not: "TERMINATED" } }),
      },
      select: { id: true, fullName: true, jobTitle: true, status: true },
      orderBy: { fullName: "asc" },
    });

    if (employees.length === 0) {
      return {
        message: "There's nobody on the team yet.",
        data: { employees: [] },
      };
    }

    const lines = employees.map((employee) =>
      [
        employee.fullName,
        employee.jobTitle ? `— ${employee.jobTitle}` : null,
        employee.status === "ACTIVE" ? null : `(${employee.status.toLowerCase()})`,
      ]
        .filter(Boolean)
        .join(" "),
    );

    return {
      message: `${employees.length} on the team:\n${lines.join("\n")}`,
      data: { employees },
    };
  },
};

// ---------------------------------------------------------------------------

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(getEmployeeRecord);
  registry.register(updateEmployeeFields);
  registry.register(listEmployees);
  return registry;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
