import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockProvider } from "./mock.ts";
import { createLlmProvider } from "./index.ts";
import type { LlmRequest, LlmToolSchema } from "./types.ts";

const OBJECT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: true,
};

function tools(...names: string[]): LlmToolSchema[] {
  return names.map((name) => ({
    name,
    description: name,
    inputSchema: OBJECT_SCHEMA,
  }));
}

function request(
  text: string,
  available: LlmToolSchema[],
  system = "test",
): LlmRequest {
  return {
    system,
    turns: [{ role: "user", content: [{ type: "text", text }] }],
    tools: available,
  };
}

const provider = createMockProvider();

describe("mock provider routing", () => {
  it("routes a clock-in", async () => {
    const response = await provider.complete(
      request("clocking in", tools("record_attendance")),
    );

    assert.equal(response.toolCalls.length, 1);
    assert.equal(response.toolCalls[0]?.name, "record_attendance");
    assert.equal(response.toolCalls[0]?.input["direction"], "in");
  });

  it("distinguishes clocking out from clocking in", async () => {
    const response = await provider.complete(
      request("heading home now", tools("record_attendance")),
    );

    assert.equal(response.toolCalls[0]?.input["direction"], "out");
  });

  it("picks up an explicit time", async () => {
    const response = await provider.complete(
      request("clocked in at 8:45am", tools("record_attendance")),
    );

    assert.equal(response.toolCalls[0]?.input["time"], "08:45");
  });

  it("captures a stated reason verbatim", async () => {
    const response = await provider.complete(
      request(
        "clocking in late because the bus broke down",
        tools("record_attendance"),
      ),
    );

    assert.equal(
      response.toolCalls[0]?.input["justification"],
      "the bus broke down",
    );
  });

  it("routes a sick day and keeps the leave type", async () => {
    const response = await provider.complete(
      request("I need a sick day on 2026-04-02", tools("request_leave")),
    );

    const input = response.toolCalls[0]?.input ?? {};
    assert.equal(response.toolCalls[0]?.name, "request_leave");
    assert.equal(input["leaveType"], "sick");
    assert.equal(input["startDate"], "2026-04-02");
  });

  it("routes listing open requests", async () => {
    const response = await provider.complete(
      request("show me the open requests", tools("list_pending_requests")),
    );
    assert.equal(response.toolCalls[0]?.name, "list_pending_requests");
  });

  it("routes an approval by request number", async () => {
    const response = await provider.complete(
      request("approve request 42", tools("decide_request")),
    );
    assert.equal(response.toolCalls[0]?.name, "decide_request");
    assert.equal(response.toolCalls[0]?.input["reference"], 42);
    assert.equal(response.toolCalls[0]?.input["decision"], "approve");
  });

  it("routes onboarding a named hire", async () => {
    const response = await provider.complete(
      request(
        "onboard Shlok Gupta as staff",
        tools("add_employee", "continue_onboarding"),
      ),
    );
    assert.equal(response.toolCalls[0]?.name, "add_employee");
    assert.equal(response.toolCalls[0]?.input["fullName"], "Shlok Gupta");
  });

  it("routes starting account setup", async () => {
    const response = await provider.complete(
      request("start onboarding", tools("continue_onboarding")),
    );
    assert.equal(response.toolCalls[0]?.name, "continue_onboarding");
  });

  it("treats a free-text reply as the setup answer once underway", async () => {
    const response = await provider.complete(
      request(
        "we're a cafe called Riverside in Oakland",
        tools("continue_onboarding"),
        'Account setup is in progress (BUSINESS_BASICS). The current question is: "What\'s the business called?"',
      ),
    );
    assert.equal(response.toolCalls[0]?.name, "continue_onboarding");
    assert.equal(
      response.toolCalls[0]?.input["answer"],
      "we're a cafe called Riverside in Oakland",
    );
  });

  it("never calls a tool the runtime did not offer", async () => {
    // An employee is not offered list_pending_requests, so a matching phrase
    // must fall through to text rather than inventing a call.
    const response = await provider.complete(
      request("show me the open requests", tools("get_employee_record")),
    );

    assert.deepEqual(response.toolCalls, []);
    assert.equal(response.stopReason, "end_turn");
  });

  it("says plainly when it cannot understand", async () => {
    const response = await provider.complete(
      request(
        "what do you reckon about the weather in March",
        tools("record_attendance"),
      ),
    );

    assert.deepEqual(response.toolCalls, []);
    assert.match(response.text, /without a language model/i);
  });
});

describe("provider factory", () => {
  it("defaults to the mock provider", () => {
    assert.equal(createLlmProvider({}).name, "mock");
  });

  it("builds an Anthropic provider when configured", () => {
    const built = createLlmProvider({
      MYCREW_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test-not-a-real-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
    });

    assert.equal(built.name, "anthropic:claude-sonnet-4-6");
  });

  it("fails loudly when Anthropic is selected without a key", () => {
    assert.throws(
      () => createLlmProvider({ MYCREW_LLM_PROVIDER: "anthropic" }),
      /ANTHROPIC_API_KEY is required/,
    );
  });

  it("rejects an unknown provider name", () => {
    assert.throws(
      () => createLlmProvider({ MYCREW_LLM_PROVIDER: "gpt" }),
      /Unknown MYCREW_LLM_PROVIDER/,
    );
  });
});
