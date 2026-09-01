import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessAttendance,
  pickShift,
  resolvePunchInstant,
  resolveWorkDate,
} from "./attendance-service.ts";
import { instantInZone } from "./time.ts";

const TZ = "America/Los_Angeles";

function shift(start: string, end: string, day = "2026-08-31") {
  return {
    startAt: instantInZone(day, start, TZ),
    endAt: instantInZone(day, end, TZ),
  };
}

describe("assessAttendance", () => {
  const nineToFive = shift("09:00", "17:00");

  it("raises LATE_IN when the punch is after the shift start", () => {
    const flags = assessAttendance({
      clockInAt: instantInZone("2026-08-31", "09:18", TZ),
      clockOutAt: null,
      shift: nineToFive,
    });
    assert.deepEqual(flags, ["LATE_IN"]);
  });

  it("raises EARLY_OUT when the punch is before the shift end", () => {
    const flags = assessAttendance({
      clockInAt: instantInZone("2026-08-31", "09:00", TZ),
      clockOutAt: instantInZone("2026-08-31", "16:00", TZ),
      shift: nineToFive,
    });
    assert.deepEqual(flags, ["EARLY_OUT"]);
  });

  it("raises nothing when the punch matches the shift", () => {
    const flags = assessAttendance({
      clockInAt: instantInZone("2026-08-31", "09:00", TZ),
      clockOutAt: instantInZone("2026-08-31", "17:00", TZ),
      shift: nineToFive,
    });
    assert.deepEqual(flags, []);
  });

  it("does not flag lateness when there is no shift at all", () => {
    const flags = assessAttendance({
      clockInAt: instantInZone("2026-08-31", "14:00", TZ),
      clockOutAt: null,
      shift: null,
    });
    assert.deepEqual(flags, []);
  });

  it("flags OUTSIDE_SCHEDULE when they have shifts, just not this one", () => {
    const flags = assessAttendance({
      clockInAt: instantInZone("2026-08-31", "14:00", TZ),
      clockOutAt: null,
      shift: null,
      hasOtherShifts: true,
    });
    assert.deepEqual(flags, ["OUTSIDE_SCHEDULE"]);
  });
});

describe("resolveWorkDate", () => {
  it("uses the shift start date for an overnight clock-out", () => {
    const overnight = {
      startAt: instantInZone("2026-08-31", "22:00", TZ),
      endAt: instantInZone("2026-09-01", "06:00", TZ),
    };
    const twoAm = instantInZone("2026-09-01", "02:00", TZ);
    assert.equal(resolveWorkDate(twoAm, TZ, overnight), "2026-08-31");
  });

  it("falls back to the local calendar date when there is no shift", () => {
    const twoAm = instantInZone("2026-09-01", "02:00", TZ);
    assert.equal(resolveWorkDate(twoAm, TZ, null), "2026-09-01");
  });
});

describe("pickShift", () => {
  it("prefers the shift that contains the punch", () => {
    const morning = shift("08:00", "12:00");
    const afternoon = shift("12:00", "17:00");
    const at = instantInZone("2026-08-31", "13:00", TZ);
    assert.equal(pickShift([morning, afternoon], at, TZ), afternoon);
  });

  it("falls back to the nearest same-day start when the punch is late", () => {
    const morning = shift("08:00", "16:00");
    const at = instantInZone("2026-08-31", "16:30", TZ);
    assert.equal(pickShift([morning], at, TZ), morning);
  });
});

describe("resolvePunchInstant", () => {
  it("uses now when no time was given", () => {
    const now = new Date("2026-08-31T20:00:00.000Z");
    assert.equal(resolvePunchInstant({ now, timezone: TZ }).getTime(), now.getTime());
  });

  it("interprets a stated time on today's local date", () => {
    const now = instantInZone("2026-08-31", "16:00", TZ);
    const at = resolvePunchInstant({ now, timezone: TZ, time: "08:45" });
    assert.equal(at.toISOString(), instantInZone("2026-08-31", "08:45", TZ).toISOString());
  });
});
