import type { FieldSpec } from "./types.ts";

/**
 * The schema every new account starts with.
 *
 * Kept deliberately small. The product thesis is that owners should not face
 * a form they didn't ask for, so we seed only the fields the platform itself
 * needs to be useful on day one, and let the onboarding survey add the rest
 * (story 1.7).
 *
 * These carry `isCore` when persisted, meaning an owner can relabel them but
 * cannot delete or retype them — payroll maths depends on `pay_rate` being a
 * number.
 */
export const SYSTEM_EMPLOYEE_FIELDS: readonly FieldSpec[] = [
  {
    key: "pay_rate",
    label: "Pay rate",
    description: "Base rate before tips, overtime or deductions.",
    entity: "EMPLOYEE",
    dataType: "CURRENCY",
    isRequired: false,
    editPolicy: "OWNER_ONLY",
    visibility: "EMPLOYEE_VISIBLE",
    validation: { min: 0, precision: 2 },
  },
  {
    key: "pay_basis",
    label: "Pay basis",
    entity: "EMPLOYEE",
    dataType: "SELECT",
    isRequired: false,
    editPolicy: "OWNER_ONLY",
    visibility: "EMPLOYEE_VISIBLE",
    options: [
      { value: "hourly", label: "Per hour" },
      { value: "daily", label: "Per day" },
      { value: "weekly", label: "Per week" },
      { value: "monthly", label: "Per month" },
      { value: "per_job", label: "Per job" },
    ],
    defaultValue: "hourly",
  },
  {
    key: "emergency_contact_name",
    label: "Emergency contact name",
    entity: "EMPLOYEE",
    dataType: "TEXT",
    isRequired: false,
    // Staff own this information, so they can change it without asking.
    editPolicy: "EMPLOYEE_DIRECT",
    visibility: "EMPLOYEE_VISIBLE",
  },
  {
    key: "emergency_contact_phone",
    label: "Emergency contact phone",
    entity: "EMPLOYEE",
    dataType: "PHONE",
    isRequired: false,
    editPolicy: "EMPLOYEE_DIRECT",
    visibility: "EMPLOYEE_VISIBLE",
  },
  {
    key: "owner_notes",
    label: "Private notes",
    description: "Free-form notes visible only to the owner.",
    entity: "EMPLOYEE",
    dataType: "LONG_TEXT",
    isRequired: false,
    editPolicy: "OWNER_ONLY",
    // Story 1.7 asks for "free feedback notes". Those must not be visible to
    // the person they are about.
    visibility: "OWNER_ONLY",
  },
];

/**
 * Fields the onboarding survey can offer to add, and that the roster parser
 * can match an unrecognised column against.
 *
 * Having a catalogue matters for consistency: two accounts that both track a
 * food handler card should end up with the same key and type, so reporting
 * and future compliance features work across the customer base instead of
 * facing a thousand bespoke spellings.
 */
export const FIELD_TEMPLATES: readonly FieldSpec[] = [
  {
    key: "job_role",
    label: "Role",
    entity: "EMPLOYEE",
    dataType: "TEXT",
    isRequired: false,
    editPolicy: "OWNER_ONLY",
    visibility: "EMPLOYEE_VISIBLE",
  },
  {
    key: "home_address",
    label: "Home address",
    entity: "EMPLOYEE",
    dataType: "LONG_TEXT",
    isRequired: false,
    editPolicy: "EMPLOYEE_DIRECT",
    visibility: "EMPLOYEE_VISIBLE",
  },
  {
    key: "date_of_birth",
    label: "Date of birth",
    entity: "EMPLOYEE",
    dataType: "DATE",
    isRequired: false,
    // Age affects which labour rules apply, so a change needs review rather
    // than being self-service.
    editPolicy: "EMPLOYEE_REQUEST",
    visibility: "EMPLOYEE_VISIBLE",
  },
  {
    key: "preferred_shift",
    label: "Preferred shift",
    entity: "EMPLOYEE",
    dataType: "SELECT",
    isRequired: false,
    editPolicy: "EMPLOYEE_DIRECT",
    visibility: "EMPLOYEE_VISIBLE",
    options: [
      { value: "morning", label: "Morning" },
      { value: "afternoon", label: "Afternoon" },
      { value: "evening", label: "Evening" },
      { value: "overnight", label: "Overnight" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "certifications",
    label: "Certifications",
    entity: "EMPLOYEE",
    dataType: "MULTI_SELECT",
    isRequired: false,
    editPolicy: "EMPLOYEE_REQUEST",
    visibility: "EMPLOYEE_VISIBLE",
    options: [
      { value: "food_handler", label: "Food handler card" },
      { value: "alcohol_service", label: "Alcohol service" },
      { value: "first_aid", label: "First aid" },
      { value: "drivers_license", label: "Driver's licence" },
      { value: "forklift", label: "Forklift" },
    ],
  },
  {
    key: "work_location",
    label: "Work location",
    entity: "ATTENDANCE",
    dataType: "TEXT",
    isRequired: false,
    // Recorded from the clock-in message; not something to edit after the
    // fact.
    editPolicy: "SYSTEM_ONLY",
    visibility: "EMPLOYEE_VISIBLE",
  },
];
