import { coerceValue, type CoercionContext } from "./coerce.ts";
import { checkConstraints } from "./constraints.ts";
import {
  authorizeFieldWrite,
  canReadField,
  describeEditPolicy,
} from "./permissions.ts";
import type {
  AttributeBag,
  AttributeValue,
  FieldSensitivity,
  FieldSpec,
  FieldWriteError,
  SchemaEntity,
  WriteActor,
  WriteResolution,
} from "./types.ts";

export interface ResolveWriteInput {
  /** The record's current attribute values. */
  current: AttributeBag;
  /** Proposed values, keyed by field key. Raw — may be chat strings. */
  changes: Record<string, unknown>;
  actor: WriteActor;
  /**
   * True when the underlying record is closed for edits, e.g. an attendance
   * entry in a locked payroll period (story 4.7).
   */
  isLocked?: boolean;
  context?: CoercionContext;
}

export interface ProjectedField {
  key: string;
  label: string;
  value: AttributeValue;
  /** Whether this actor may change it, for answering story 2.9 inline. */
  editable: boolean;
  requiresApproval: boolean;
}

export interface InitializeResult {
  values: AttributeBag;
  errors: FieldWriteError[];
}

export interface CompiledSchema {
  readonly entity: SchemaEntity;
  readonly fields: readonly FieldSpec[];
  get(key: string): FieldSpec | undefined;
  resolveWrite(input: ResolveWriteInput): WriteResolution;
  initialize(
    input: Record<string, unknown>,
    context?: CoercionContext,
  ): InitializeResult;
  project(attributes: AttributeBag, actor: WriteActor): ProjectedField[];
  describePermissions(actor: WriteActor): string[];

  /**
   * How confidential a field is (story 6.4).
   *
   * An unknown key answers `RESTRICTED`, not `NORMAL`. Callers use this to
   * decide whether a value may be logged or sent to a model, so a typo or a
   * field from another entity must fail towards silence.
   */
  sensitivityOf(key: string): FieldSensitivity;

  /**
   * Whether a value for this field may be accepted in a chat message.
   *
   * False for `RESTRICTED`. WhatsApp message content is processed by Meta in
   * transit, so bank details and government identifiers are collected through
   * a single-use link instead (docs/security.md).
   */
  acceptsChatInput(key: string): boolean;

  /**
   * A copy of an attribute bag safe to put in a log line or an error report
   * (story 6.11). Confidential values are replaced by a placeholder naming
   * their classification, so the shape of a problem stays debuggable while the
   * values do not travel.
   */
  redact(attributes: AttributeBag): Record<string, AttributeValue>;
}

/**
 * Compile a set of field definitions into the runtime schema for one entity.
 *
 * "Compile" is literal: the account's `FieldDefinition` rows are data, and
 * this turns them into the executable rules that guard every write to the
 * matching `attributes` column. Nothing else in the system is permitted to
 * write `attributes` directly.
 */
export function compileSchema(
  entity: SchemaEntity,
  specs: readonly FieldSpec[],
): CompiledSchema {
  // Resolve the sensitivity default here, once, rather than at each call site.
  // An absent classification means nobody has considered the field, so it is
  // treated as confidential — the column default says the same thing, and the
  // two must not disagree.
  const relevant: readonly FieldSpec[] = specs
    .filter((spec) => spec.entity === entity)
    .map((spec) => ({
      ...spec,
      sensitivity: spec.sensitivity ?? "CONFIDENTIAL",
    }));
  const byKey = new Map(relevant.map((spec) => [spec.key, spec]));

  function resolveWrite(input: ResolveWriteInput): WriteResolution {
    const {
      current,
      changes,
      actor,
      isLocked = false,
      context = {},
    } = input;

    const resolution: WriteResolution = {
      applied: {},
      requiresApproval: {},
      rejected: [],
      unchanged: [],
    };

    for (const [key, rawValue] of Object.entries(changes)) {
      const spec = byKey.get(key);

      if (!spec) {
        resolution.rejected.push({
          key,
          label: key,
          reason: "UNKNOWN_FIELD",
          message: `I don't have a field called "${key}" on record.`,
        });
        continue;
      }

      // Lock check comes before permission and validation: if the period is
      // closed, whether the value is well-formed is beside the point.
      if (isLocked && actor.role === "EMPLOYEE") {
        resolution.rejected.push({
          key,
          label: spec.label,
          reason: "RECORD_LOCKED",
          message:
            `${spec.label} is locked for this period. ` +
            "Ask your manager to make the correction.",
        });
        continue;
      }

      const authorization = authorizeFieldWrite(spec, actor);
      if (authorization === "DENY") {
        resolution.rejected.push({
          key,
          label: spec.label,
          reason: "NOT_PERMITTED",
          message: describeEditPolicy(spec),
        });
        continue;
      }

      const coerced = coerceValue(spec, rawValue, context);
      if (!coerced.ok) {
        resolution.rejected.push({
          key,
          label: spec.label,
          reason: "INVALID_VALUE",
          message: coerced.message,
        });
        continue;
      }

      const constraintError = checkConstraints(spec, coerced.value);
      if (constraintError) {
        resolution.rejected.push({
          key,
          label: spec.label,
          reason: coerced.value === null ? "REQUIRED" : "INVALID_VALUE",
          message: constraintError,
        });
        continue;
      }

      // A no-op write should not create an audit entry or, worse, an
      // approval request that an owner has to action for nothing.
      if (valuesEqual(current[key] ?? null, coerced.value)) {
        resolution.unchanged.push(key);
        continue;
      }

      if (authorization === "REQUIRES_APPROVAL") {
        resolution.requiresApproval[key] = coerced.value;
      } else {
        resolution.applied[key] = coerced.value;
      }
    }

    return resolution;
  }

  function initialize(
    input: Record<string, unknown>,
    context: CoercionContext = {},
  ): InitializeResult {
    const values: AttributeBag = {};
    const errors: FieldWriteError[] = [];

    for (const spec of relevant) {
      const provided = Object.prototype.hasOwnProperty.call(input, spec.key);
      const raw = provided ? input[spec.key] : spec.defaultValue ?? null;

      const coerced = coerceValue(spec, raw, context);
      if (!coerced.ok) {
        errors.push({
          key: spec.key,
          label: spec.label,
          reason: "INVALID_VALUE",
          message: coerced.message,
        });
        continue;
      }

      const constraintError = checkConstraints(spec, coerced.value);
      if (constraintError) {
        errors.push({
          key: spec.key,
          label: spec.label,
          reason: coerced.value === null ? "REQUIRED" : "INVALID_VALUE",
          message: constraintError,
        });
        continue;
      }

      // Only store keys that actually carry a value. Writing explicit nulls
      // for every unanswered field makes the jsonb bag noisy and makes
      // "was this ever set?" unanswerable.
      if (coerced.value !== null) values[spec.key] = coerced.value;
    }

    return { values, errors };
  }

  function project(
    attributes: AttributeBag,
    actor: WriteActor,
  ): ProjectedField[] {
    return relevant
      .filter((spec) => canReadField(spec, actor))
      .map((spec) => {
        const authorization = authorizeFieldWrite(spec, actor);
        return {
          key: spec.key,
          label: spec.label,
          value: attributes[spec.key] ?? null,
          editable: authorization !== "DENY",
          requiresApproval: authorization === "REQUIRES_APPROVAL",
        };
      });
  }

  function describePermissions(actor: WriteActor): string[] {
    return relevant
      .filter((spec) => canReadField(spec, actor))
      .map((spec) => describeEditPolicy(spec));
  }

  function sensitivityOf(key: string): FieldSensitivity {
    // Unknown keys are treated as the most sensitive value, so a mistake
    // withholds data rather than exposing it.
    return byKey.get(key)?.sensitivity ?? "RESTRICTED";
  }

  function acceptsChatInput(key: string): boolean {
    return sensitivityOf(key) !== "RESTRICTED";
  }

  function redact(attributes: AttributeBag): Record<string, AttributeValue> {
    const safe: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(attributes)) {
      const level = sensitivityOf(key);
      safe[key] = level === "NORMAL" ? value : `[${level.toLowerCase()}]`;
    }
    return safe;
  }

  return {
    entity,
    fields: relevant,
    get: (key) => byKey.get(key),
    resolveWrite,
    initialize,
    project,
    describePermissions,
    sensitivityOf,
    acceptsChatInput,
    redact,
  };
}

function valuesEqual(a: AttributeValue, b: AttributeValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    // MULTI_SELECT is a set, so ordering is not a difference worth
    // recording in the audit trail.
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
  }
  return a === b;
}
