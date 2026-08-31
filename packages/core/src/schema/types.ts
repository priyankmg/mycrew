// Type-only imports from the database package. These are erased at compile
// time, so the schema engine stays a pure module with no runtime dependency
// on Prisma — which means it can be unit tested without a database.
import type {
  FieldDataType,
  FieldEditPolicy,
  FieldSensitivity,
  FieldVisibility,
  SchemaEntity,
  UserRole,
} from "@mycrew/db";

export type {
  FieldDataType,
  FieldEditPolicy,
  FieldSensitivity,
  FieldVisibility,
  SchemaEntity,
  UserRole,
};

/**
 * A value stored in an `attributes` bag.
 *
 * Deliberately JSON-safe: dates are held as ISO-8601 strings rather than
 * `Date` objects, because these round-trip through jsonb and through the
 * LLM tool-call boundary, and a `Date` survives neither.
 */
export type AttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null;

export type AttributeBag = Record<string, AttributeValue>;

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Anchored automatically; supply the inner expression only. */
  pattern?: string;
  /** Decimal places for NUMBER and CURRENCY. */
  precision?: number;
}

/**
 * The engine's view of one field.
 *
 * Structurally compatible with a `FieldDefinition` row but declared
 * independently, so callers can compile a schema from proposed (not yet
 * persisted) definitions — which is exactly what roster import needs when it
 * asks the owner to confirm an inferred schema.
 */
export interface FieldSpec {
  key: string;
  label: string;
  entity: SchemaEntity;
  dataType: FieldDataType;
  isRequired: boolean;
  editPolicy: FieldEditPolicy;
  visibility: FieldVisibility;
  /**
   * How the platform must handle the value (story 6.4).
   *
   * Optional here and defaulted to `CONFIDENTIAL` by `compileSchema`, matching
   * the column default. Omitting it must never quietly mean "not sensitive":
   * a field whose classification nobody has considered is precisely the one to
   * be careful with.
   */
  sensitivity?: FieldSensitivity | null;
  description?: string | null;
  options?: readonly FieldOption[] | null;
  validation?: FieldValidation | null;
  defaultValue?: AttributeValue | null;
}

/** Why a proposed write could not be applied. */
export type WriteRejectionReason =
  | "UNKNOWN_FIELD"
  | "NOT_PERMITTED"
  | "INVALID_VALUE"
  | "REQUIRED"
  | "RECORD_LOCKED";

export interface FieldWriteError {
  key: string;
  /** The field's human label, for wording the assistant's reply. */
  label: string;
  reason: WriteRejectionReason;
  /** Phrased for a non-technical business owner reading it in WhatsApp. */
  message: string;
}

/**
 * The outcome of evaluating a set of proposed changes.
 *
 * Splitting the result three ways is what lets a single chat message like
 * "update my phone to 555-0101 and my pay rate to $25" do the right thing
 * with each part: apply one, raise an approval request for the other.
 */
export interface WriteResolution {
  /** Valid, permitted, and different from the stored value. */
  applied: AttributeBag;
  /** Valid, but the actor needs owner approval (story 3.1). */
  requiresApproval: AttributeBag;
  /** Rejected outright, with a reason to say out loud. */
  rejected: FieldWriteError[];
  /** Proposed but identical to the current value; nothing to do. */
  unchanged: string[];
}

/** The actor attempting a write. */
export interface WriteActor {
  role: UserRole;
  /**
   * True when the actor is the person the record is about. An employee
   * editing their own phone number is a different question from an employee
   * editing a colleague's.
   */
  isSubject: boolean;
}
