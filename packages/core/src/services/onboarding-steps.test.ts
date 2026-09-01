import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSkip,
  nextStep,
  onboardableTemplates,
  parseDataToTrack,
  parseSickDays,
  parseTeamSize,
  questionFor,
  wantsUnpaidLeave,
} from "./onboarding-steps.ts";

describe("onboarding steps", () => {
  it("asks one question per step", () => {
    assert.match(questionFor("BUSINESS_BASICS"), /business/i);
    assert.match(questionFor("DATA_TO_TRACK"), /skip/i);
  });

  it("advances in order through to complete", () => {
    assert.equal(nextStep("BUSINESS_BASICS"), "TEAM_SIZE");
    assert.equal(nextStep("ROSTER_IMPORT"), "COMPLETE");
    assert.equal(nextStep("COMPLETE"), "COMPLETE");
  });

  it("never offers restricted templates such as national id or bank details", () => {
    const keys = onboardableTemplates().map((spec) => spec.key);
    assert.ok(keys.includes("home_address"));
    assert.ok(!keys.includes("national_id"));
    assert.ok(!keys.includes("bank_account"));
  });

  it("parses 'all' into every onboardable field", () => {
    const choice = parseDataToTrack("all of them");
    assert.equal(choice.skip, false);
    assert.ok(choice.keys.includes("home_address"));
    assert.ok(choice.keys.includes("certifications"));
    assert.ok(!choice.keys.includes("national_id"));
  });

  it("matches labels in a free-text list", () => {
    const choice = parseDataToTrack("home address and certifications");
    assert.deepEqual(choice.keys.sort(), ["certifications", "home_address"]);
  });

  it("treats skip/none as no extra fields", () => {
    assert.deepEqual(parseDataToTrack("skip"), { skip: true, keys: [] });
    assert.equal(isSkip("later"), true);
  });

  it("reads a team size and sick-day count", () => {
    assert.equal(parseTeamSize("we have 4 including me"), 4);
    assert.equal(parseSickDays("5 paid sick days and unpaid too"), 5);
    assert.equal(wantsUnpaidLeave("5 paid sick days and unpaid too"), true);
  });
});
