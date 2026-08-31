import { prisma, type SchemaEntity } from "@mycrew/db";

import { compileSchema, type CompiledSchema } from "../schema/engine.ts";
import { uniqueFieldKey } from "../schema/keys.ts";
import { SYSTEM_EMPLOYEE_FIELDS } from "../schema/system-fields.ts";
import type {
  FieldOption,
  FieldSpec,
  FieldValidation,
} from "../schema/types.ts";

/**
 * Loads an account's runtime schema from its `FieldDefinition` rows.
 *
 * Archived fields are excluded from writes but their historical values stay
 * in `attributes`, so an old `DataChange` row remains interpretable.
 */
export async function loadSchema(
  accountId: string,
  entity: SchemaEntity,
): Promise<CompiledSchema> {
  const rows = await prisma.fieldDefinition.findMany({
    where: { accountId, entity, archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });

  return compileSchema(entity, rows.map(toFieldSpec));
}

export function toFieldSpec(row: {
  key: string;
  label: string;
  entity: SchemaEntity;
  dataType: FieldSpec["dataType"];
  isRequired: boolean;
  editPolicy: FieldSpec["editPolicy"];
  visibility: FieldSpec["visibility"];
  sensitivity: NonNullable<FieldSpec["sensitivity"]>;
  description: string | null;
  options: unknown;
  validation: unknown;
  defaultValue: unknown;
}): FieldSpec {
  return {
    key: row.key,
    label: row.label,
    entity: row.entity,
    dataType: row.dataType,
    isRequired: row.isRequired,
    editPolicy: row.editPolicy,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    description: row.description,
    options: (row.options ?? null) as FieldOption[] | null,
    validation: (row.validation ?? null) as FieldValidation | null,
    defaultValue: (row.defaultValue ?? null) as FieldSpec["defaultValue"],
  };
}

/**
 * Give a brand-new account its starting schema (story 1.5).
 *
 * Idempotent, so re-running setup or replaying a webhook cannot produce
 * duplicate fields.
 */
export async function seedSystemFields(accountId: string): Promise<number> {
  const existing = await prisma.fieldDefinition.findMany({
    where: { accountId },
    select: { key: true, entity: true },
  });
  const taken = new Set(existing.map((row) => `${row.entity}:${row.key}`));

  const toCreate = SYSTEM_EMPLOYEE_FIELDS.filter(
    (spec) => !taken.has(`${spec.entity}:${spec.key}`),
  );

  if (toCreate.length === 0) return 0;

  await prisma.fieldDefinition.createMany({
    data: toCreate.map((spec, index) => ({
      accountId,
      entity: spec.entity,
      key: spec.key,
      label: spec.label,
      description: spec.description ?? null,
      dataType: spec.dataType,
      isRequired: spec.isRequired,
      isCore: true,
      editPolicy: spec.editPolicy,
      visibility: spec.visibility,
      sensitivity: spec.sensitivity ?? "CONFIDENTIAL",
      options: (spec.options ?? null) as never,
      validation: (spec.validation ?? null) as never,
      defaultValue: (spec.defaultValue ?? null) as never,
      source: "SYSTEM_DEFAULT" as const,
      displayOrder: index,
    })),
  });

  return toCreate.length;
}

export interface AddFieldInput {
  accountId: string;
  entity: SchemaEntity;
  label: string;
  dataType: FieldSpec["dataType"];
  isRequired?: boolean;
  editPolicy?: FieldSpec["editPolicy"];
  visibility?: FieldSpec["visibility"];
  /**
   * Omitted means confidential (story 6.4). A caller that knows a field is
   * harmless says so explicitly; a caller that has not thought about it — the
   * LLM inferring a column from a spreadsheet, say — gets the careful answer.
   */
  sensitivity?: FieldSpec["sensitivity"];
  options?: readonly FieldOption[];
  validation?: FieldValidation;
  description?: string;
  source?: "ONBOARDING_SURVEY" | "ROSTER_IMPORT" | "LLM_INFERRED" | "MANUAL";
  confidence?: number;
}

/**
 * Add a field to an account's schema — the operation that makes story 1.8
 * ("keep the structure flexible") a runtime action rather than a migration.
 */
export async function addField(input: AddFieldInput): Promise<FieldSpec> {
  const existing = await prisma.fieldDefinition.findMany({
    where: { accountId: input.accountId, entity: input.entity },
    select: { key: true },
  });

  const key = uniqueFieldKey(
    input.label,
    existing.map((row) => row.key),
  );

  const maxOrder = await prisma.fieldDefinition.aggregate({
    where: { accountId: input.accountId, entity: input.entity },
    _max: { displayOrder: true },
  });

  const row = await prisma.fieldDefinition.create({
    data: {
      accountId: input.accountId,
      entity: input.entity,
      key,
      label: input.label,
      description: input.description ?? null,
      dataType: input.dataType,
      isRequired: input.isRequired ?? false,
      editPolicy: input.editPolicy ?? "OWNER_ONLY",
      visibility: input.visibility ?? "OWNER_ONLY",
      sensitivity: input.sensitivity ?? "CONFIDENTIAL",
      options: (input.options ?? null) as never,
      validation: (input.validation ?? null) as never,
      source: input.source ?? "MANUAL",
      confidence: input.confidence ?? null,
      displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
    },
  });

  return toFieldSpec(row);
}
