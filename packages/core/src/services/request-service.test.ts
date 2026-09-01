import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leaveSummary, normalizeLeaveType } from "./request-service.ts";

describe("normalizeLeaveType", () => {
  it("maps common phrases onto the seeded policy keys", () => {
    assert.equal(normalizeLeaveType("sick"), "sick");
    assert.equal(normalizeLeaveType("Sick Day"), "sick");
    assert.equal(normalizeLeaveType("vacation"), "unpaid");
    assert.equal(normalizeLeaveType("family emergency"), "family_emergency");
  });
});

describe("leaveSummary", () => {
  it("uses a single date for one-day leave", () => {
    assert.equal(
      leaveSummary({
        employeeName: "Sam Ortiz",
        leaveType: "sick",
        startDate: "2026-04-02",
        endDate: "2026-04-02",
      }),
      "Sam Ortiz: sick leave 2026-04-02",
    );
  });

  it("uses a range when the leave spans days", () => {
    assert.equal(
      leaveSummary({
        employeeName: "Dana Vega",
        leaveType: "unpaid",
        startDate: "2026-04-02",
        endDate: "2026-04-04",
      }),
      "Dana Vega: unpaid leave 2026-04-02 to 2026-04-04",
    );
  });
});
