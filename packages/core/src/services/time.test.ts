import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dateOnly,
  formatDateInZone,
  formatTimeInZone,
  instantInZone,
  parseClockTime,
} from "./time.ts";

describe("formatDateInZone", () => {
  it("keeps a late evening on the local calendar, not the next UTC day", () => {
    // 11pm Pacific on 31 Aug is already 6am UTC on 1 Sep.
    const late = new Date("2026-09-01T06:00:00.000Z");
    assert.equal(formatDateInZone(late, "America/Los_Angeles"), "2026-08-31");
  });
});

describe("instantInZone", () => {
  it("interprets a Pacific winter morning as UTC-8", () => {
    const instant = instantInZone("2026-01-15", "08:45", "America/Los_Angeles");
    assert.equal(instant.toISOString(), "2026-01-15T16:45:00.000Z");
  });

  it("interprets a Pacific summer morning as UTC-7", () => {
    const instant = instantInZone("2026-07-15", "08:45", "America/Los_Angeles");
    assert.equal(instant.toISOString(), "2026-07-15T15:45:00.000Z");
  });

  it("round-trips through formatters", () => {
    const instant = instantInZone("2026-08-31", "09:00", "America/Los_Angeles");
    assert.equal(formatDateInZone(instant, "America/Los_Angeles"), "2026-08-31");
    assert.equal(formatTimeInZone(instant, "America/Los_Angeles"), "9:00am");
  });
});

describe("parseClockTime", () => {
  it("accepts 12-hour and 24-hour forms", () => {
    assert.equal(parseClockTime("8:45am"), "08:45");
    assert.equal(parseClockTime("5:30 pm"), "17:30");
    assert.equal(parseClockTime("17:30"), "17:30");
    assert.equal(parseClockTime("9am"), "09:00");
    assert.equal(parseClockTime("12:00pm"), "12:00");
    assert.equal(parseClockTime("12:00am"), "00:00");
  });

  it("rejects values that are not a time of day", () => {
    assert.equal(parseClockTime("tomorrow"), null);
    assert.equal(parseClockTime("25:00"), null);
  });
});

describe("dateOnly", () => {
  it("stores the calendar date at UTC midnight", () => {
    assert.equal(dateOnly("2026-04-02").toISOString(), "2026-04-02T00:00:00.000Z");
  });
});
