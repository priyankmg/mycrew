import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileSchema } from "./engine.ts";
import { toFieldKey, uniqueFieldKey } from "./keys.ts";
import { SYSTEM_EMPLOYEE_FIELDS } from "./system-fields.ts";
import type { FieldSpec, WriteActor } from "./types.ts";

const OWNER: WriteActor = { role: "OWNER", isSubject: false };
const SELF: WriteActor = { role: "EMPLOYEE", isSubject: true };
const COLLEAGUE: WriteActor = { role: "EMPLOYEE", isSubject: false };

const FIELDS: readonly FieldSpec[] = [
  ...SYSTEM_EMPLOYEE_FIELDS,
  {
    key: "shirt_size",
    label: "Shirt size",
    entity: "EMPLOYEE",
    dataType: "SELECT",
    isRequired: false,
    editPolicy: "EMPLOYEE_DIRECT",
    visibility: "EMPLOYEE_VISIBLE",
    options: [
      { value: "s", label: "Small" },
      { value: "m", label: "Medium" },
      { value: "l", label: "Large" },
    ],
  },
  {
    key: "start_bonus",
    label: "Signing bonus",
    entity: "EMPLOYEE",
    dataType: "CURRENCY",
    isRequired: false,
    editPolicy: "EMPLOYEE_REQUEST",
    visibility: "EMPLOYEE_VISIBLE",
  },
  {
    key: "food_handler_expiry",
    label: "Food handler card expiry",
    entity: "EMPLOYEE",
    dataType: "DATE",
    isRequired: true,
    editPolicy: "EMPLOYEE_REQUEST",
    visibility: "EMPLOYEE_VISIBLE",
  },
];

const schema = compileSchema("EMPLOYEE", FIELDS);

describe("coercion of values people actually type in chat", () => {
  it("reads money written the way owners write it", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { pay_rate: "$18.50/hr" },
      actor: OWNER,
    });

    assert.deepEqual(result.rejected, []);
    assert.equal(result.applied["pay_rate"], 18.5);
  });

  it("handles thousands separators and rounds currency to cents", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { start_bonus: "1,250.005 dollars" },
      actor: OWNER,
    });

    assert.equal(result.applied["start_bonus"], 1250.01);
  });

  it("accepts a US date and normalises it to ISO", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { food_handler_expiry: "3/4/2026" },
      actor: OWNER,
    });

    assert.equal(result.applied["food_handler_expiry"], "2026-03-04");
  });

  it("accepts a spelled-out date", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { food_handler_expiry: "4 March 2026" },
      actor: OWNER,
    });

    assert.equal(result.applied["food_handler_expiry"], "2026-03-04");
  });

  it("rejects a date that does not exist", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { food_handler_expiry: "2026-02-31" },
      actor: OWNER,
    });

    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]?.reason, "INVALID_VALUE");
  });

  it("normalises a phone number to E.164", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { emergency_contact_phone: "(555) 010-1234" },
      actor: SELF,
    });

    assert.equal(result.applied["emergency_contact_phone"], "+15550101234");
  });

  it("matches a select option by its human label", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { shirt_size: "Medium" },
      actor: SELF,
    });

    assert.equal(result.applied["shirt_size"], "m");
  });

  it("lists the valid options when the answer is not one of them", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { shirt_size: "XXL" },
      actor: SELF,
    });

    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0]!.message, /Small, Medium, Large/);
  });

  it("treats an explicit blank as clearing the value", () => {
    const result = schema.resolveWrite({
      current: { shirt_size: "m" },
      changes: { shirt_size: "none" },
      actor: SELF,
    });

    assert.equal(result.applied["shirt_size"], null);
  });
});

describe("write authorization", () => {
  it("lets an owner change anything", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { pay_rate: 25, owner_notes: "Strong closer" },
      actor: OWNER,
    });

    assert.deepEqual(result.rejected, []);
    assert.equal(Object.keys(result.applied).length, 2);
    assert.deepEqual(result.requiresApproval, {});
  });

  it("lets staff directly change their own self-service fields", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { emergency_contact_name: "Dana Vega" },
      actor: SELF,
    });

    assert.equal(result.applied["emergency_contact_name"], "Dana Vega");
  });

  it("routes an approval-gated field to approval rather than applying it", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { start_bonus: "500" },
      actor: SELF,
    });

    assert.deepEqual(result.applied, {});
    assert.equal(result.requiresApproval["start_bonus"], 500);
  });

  it("refuses an owner-only field and explains why", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { pay_rate: "40" },
      actor: SELF,
    });

    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]?.reason, "NOT_PERMITTED");
    assert.match(result.rejected[0]!.message, /only be changed by your manager/);
  });

  it("refuses any write to somebody else's record", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { emergency_contact_name: "Not mine" },
      actor: COLLEAGUE,
    });

    assert.equal(result.rejected[0]?.reason, "NOT_PERMITTED");
  });

  it("splits a mixed request into applied and pending parts", () => {
    // The single-message case the product depends on: "update my emergency
    // contact to Dana and my bonus to 500" is two different decisions.
    const result = schema.resolveWrite({
      current: {},
      changes: { emergency_contact_name: "Dana", start_bonus: "500" },
      actor: SELF,
    });

    assert.deepEqual(Object.keys(result.applied), ["emergency_contact_name"]);
    assert.deepEqual(Object.keys(result.requiresApproval), ["start_bonus"]);
  });
});

describe("locked records", () => {
  it("blocks staff edits once a period is locked", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { emergency_contact_name: "Dana" },
      actor: SELF,
      isLocked: true,
    });

    assert.equal(result.rejected[0]?.reason, "RECORD_LOCKED");
  });

  it("still lets an owner correct a locked record", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { pay_rate: 20 },
      actor: OWNER,
      isLocked: true,
    });

    assert.equal(result.applied["pay_rate"], 20);
  });
});

describe("no-op writes", () => {
  it("reports an identical value as unchanged instead of applying it", () => {
    const result = schema.resolveWrite({
      current: { pay_rate: 18.5 },
      changes: { pay_rate: "$18.50" },
      actor: OWNER,
    });

    assert.deepEqual(result.applied, {});
    assert.deepEqual(result.unchanged, ["pay_rate"]);
  });

  it("does not raise an approval request for a value that is already set", () => {
    // Otherwise an owner ends up approving changes that change nothing.
    const result = schema.resolveWrite({
      current: { start_bonus: 500 },
      changes: { start_bonus: "500" },
      actor: SELF,
    });

    assert.deepEqual(result.requiresApproval, {});
    assert.deepEqual(result.unchanged, ["start_bonus"]);
  });
});

describe("unknown fields", () => {
  it("rejects a key that is not in the account's schema", () => {
    const result = schema.resolveWrite({
      current: {},
      changes: { favourite_colour: "green" },
      actor: OWNER,
    });

    assert.equal(result.rejected[0]?.reason, "UNKNOWN_FIELD");
  });
});

describe("record creation", () => {
  it("applies defaults and reports missing required fields", () => {
    const { values, errors } = schema.initialize({ pay_rate: "17" });

    assert.equal(values["pay_rate"], 17);
    // pay_basis has a default of "hourly".
    assert.equal(values["pay_basis"], "hourly");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.key, "food_handler_expiry");
    assert.equal(errors[0]?.reason, "REQUIRED");
  });

  it("omits unset optional fields rather than storing nulls", () => {
    const { values } = schema.initialize({
      pay_rate: "17",
      food_handler_expiry: "2026-01-01",
    });

    assert.ok(!("owner_notes" in values));
  });
});

describe("visibility", () => {
  it("hides owner-only fields from staff", () => {
    const projected = schema.project({ owner_notes: "Private" }, SELF);
    assert.ok(!projected.some((field) => field.key === "owner_notes"));
  });

  it("shows owners everything", () => {
    const projected = schema.project({ owner_notes: "Private" }, OWNER);
    assert.ok(projected.some((field) => field.key === "owner_notes"));
  });

  it("tells staff which of their fields need approval", () => {
    const projected = schema.project({}, SELF);
    const bonus = projected.find((field) => field.key === "start_bonus");

    assert.equal(bonus?.editable, true);
    assert.equal(bonus?.requiresApproval, true);
  });
});

describe("field keys", () => {
  it("slugifies a human label", () => {
    assert.equal(toFieldKey("Hourly Rate ($)"), "hourly_rate");
    assert.equal(toFieldKey("Food handler card exp."), "food_handler_card_exp");
  });

  it("strips accents so equivalent labels agree on one key", () => {
    assert.equal(toFieldKey("Años de servicio"), "anos_de_servicio");
  });

  it("disambiguates labels that would collide", () => {
    const first = uniqueFieldKey("Phone", []);
    const second = uniqueFieldKey("Phone", [first]);

    assert.equal(first, "phone");
    assert.equal(second, "phone_2");
  });

  it("refuses to shadow a fixed column", () => {
    assert.equal(uniqueFieldKey("Full name", []), "full_name_field");
  });
});

describe("confidentiality classification", () => {
  it("treats an unclassified field as confidential", () => {
    // `shirt_size` is declared above with no sensitivity, which stands for
    // every field an owner invents without being asked about privacy. Silence
    // must not read as "harmless".
    assert.equal(schema.sensitivityOf("shirt_size"), "CONFIDENTIAL");
  });

  it("keeps declared classifications", () => {
    assert.equal(schema.sensitivityOf("pay_rate"), "CONFIDENTIAL");
    assert.equal(schema.sensitivityOf("pay_basis"), "NORMAL");
  });

  it("treats an unknown key as restricted", () => {
    // Callers ask this before logging a value or putting it in a prompt, so a
    // typo has to fail towards silence rather than disclosure.
    assert.equal(schema.sensitivityOf("no_such_field"), "RESTRICTED");
    assert.equal(schema.acceptsChatInput("no_such_field"), false);
  });

  it("refuses chat input only for restricted fields", () => {
    const withRestricted = compileSchema("EMPLOYEE", [
      ...FIELDS,
      {
        key: "bank_account",
        label: "Bank account details",
        entity: "EMPLOYEE",
        dataType: "TEXT",
        isRequired: false,
        editPolicy: "EMPLOYEE_DIRECT",
        visibility: "OWNER_ONLY",
        sensitivity: "RESTRICTED",
      },
    ]);

    assert.equal(withRestricted.acceptsChatInput("pay_basis"), true);
    assert.equal(withRestricted.acceptsChatInput("pay_rate"), true);
    assert.equal(withRestricted.acceptsChatInput("bank_account"), false);
  });

  it("redacts everything but normal fields, keeping the shape", () => {
    const safe = schema.redact({
      pay_basis: "hourly",
      pay_rate: 18.5,
      emergency_contact_name: "Alex Ortiz",
    });

    // The keys survive so a log line still shows which fields were involved.
    assert.deepEqual(safe, {
      pay_basis: "hourly",
      pay_rate: "[confidential]",
      emergency_contact_name: "[confidential]",
    });
  });

  it("redacts a value whose field it has never heard of", () => {
    assert.deepEqual(schema.redact({ mystery: "sensitive-looking" }), {
      mystery: "[restricted]",
    });
  });
});
