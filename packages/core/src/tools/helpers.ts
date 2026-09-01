import { prisma } from "@mycrew/db";
import type { JsonSchemaObject } from "@mycrew/llm";
import { z } from "zod";

import { ToolInputError, type ToolContext } from "../agent/tools.ts";

/** Build a tool's advertised JSON Schema from its Zod schema. */
export function jsonSchema(schema: z.ZodType): JsonSchemaObject {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >;
  void $schema;
  return rest as unknown as JsonSchemaObject;
}

/** Turn Zod failures into wording the model can act on. */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  throw new ToolInputError(`Those details weren't usable — ${detail}`);
}

/**
 * Work out which employee a request concerns.
 *
 * Staff are pinned to their own record regardless of what the model passed,
 * so a prompt injection or a model slip cannot redirect a read or write onto
 * a colleague. Owners may name someone, and an ambiguous name is a question
 * rather than a guess.
 */
export async function resolveEmployeeId(
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

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
