import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { LlmProvider, LlmRequest, LlmResponse } from "@mycrew/llm";

import { createAgentRuntime } from "./runtime.ts";
import type {
  AppendMessageInput,
  ConversationStore,
  CreatePendingActionInput,
  PendingActionRecord,
  StoredMessage,
} from "./store.ts";
import {
  ToolInputError,
  ToolRegistry,
  type ToolContext,
  type ToolDefinition,
} from "./tools.ts";

// --- fakes -----------------------------------------------------------------

function createMemoryStore(): ConversationStore & {
  messages: StoredMessage[];
  pending: (PendingActionRecord & { status: string })[];
} {
  const messages: StoredMessage[] = [];
  const pending: (PendingActionRecord & { status: string })[] = [];
  let sequence = 0;

  return {
    messages,
    pending,

    async appendMessage(input: AppendMessageInput): Promise<StoredMessage> {
      sequence += 1;
      const stored: StoredMessage = {
        id: `m${sequence}`,
        role: input.role,
        body: input.body,
        toolName: input.toolName ?? null,
        toolPayload: input.toolPayload ?? null,
        // Spread out in time so history ordering is meaningful.
        createdAt: new Date(1_800_000_000_000 + sequence * 1000),
      };
      messages.push(stored);
      return stored;
    },

    async recentMessages(_conversationId, limit) {
      return messages.slice(-limit);
    },

    async createPendingAction(
      input: CreatePendingActionInput,
    ): Promise<PendingActionRecord> {
      sequence += 1;
      const record = {
        id: `p${sequence}`,
        conversationId: input.conversationId,
        toolName: input.toolName,
        arguments: input.arguments,
        summary: input.summary,
        expiresAt: input.expiresAt,
        status: "AWAITING_CONFIRMATION",
      };
      pending.push(record);
      return record;
    },

    async findAwaitingConfirmation(conversationId, now) {
      return (
        pending.find(
          (action) =>
            action.conversationId === conversationId &&
            action.status === "AWAITING_CONFIRMATION" &&
            action.expiresAt > now,
        ) ?? null
      );
    },

    async resolvePendingAction(id, status) {
      const action = pending.find((candidate) => candidate.id === id);
      if (action) action.status = status;
    },
  };
}

/** A provider that replays a fixed script of responses. */
function scriptedProvider(responses: LlmResponse[]): LlmProvider & {
  requests: LlmRequest[];
} {
  const requests: LlmRequest[] = [];
  let index = 0;

  return {
    name: "scripted",
    requests,
    async complete(request) {
      requests.push(request);
      const response = responses[index] ?? {
        text: "(script exhausted)",
        toolCalls: [],
        stopReason: "end_turn" as const,
      };
      index += 1;
      return response;
    },
  };
}

const OBJECT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: true,
};

interface Recorded {
  calls: unknown[];
}

function readTool(recorded: Recorded): ToolDefinition<{ ok: boolean }> {
  return {
    name: "get_employee_record",
    description: "Read the caller's own record.",
    inputSchema: OBJECT_SCHEMA,
    mutates: false,
    parse: () => ({ ok: true }),
    async execute(input) {
      recorded.calls.push(input);
      return { message: "You're on £12.50 an hour.", data: { rate: 12.5 } };
    },
  };
}

function writeTool(recorded: Recorded): ToolDefinition<{ rate: number }> {
  return {
    name: "update_employee_fields",
    description: "Change a field on an employee record.",
    inputSchema: OBJECT_SCHEMA,
    mutates: true,
    parse(input) {
      const rate = (input as { rate?: unknown }).rate;
      if (typeof rate !== "number") {
        throw new ToolInputError("Which pay rate should I set?");
      }
      return { rate };
    },
    summarize: (input) =>
      // A negative rate stands in for "well-formed but nothing will happen".
      input.rate < 0
        ? { willChange: false, message: "Pay rate can't be negative." }
        : { willChange: true, summary: `I'll set the pay rate to £${input.rate}.` },
    async execute(input) {
      recorded.calls.push(input);
      return { message: `Done — pay rate is now £${input.rate}.` };
    },
  };
}

const CONTEXT: ToolContext = {
  accountId: "acc_1",
  conversationId: "conv_1",
  actor: {
    role: "OWNER",
    isSubject: false,
    displayName: "Priya",
    userId: "user_1",
  },
  timezone: "Europe/London",
  now: new Date("2026-03-02T09:00:00Z"),
};

const PROMPT = {
  businessName: "Rosie's Cafe",
  timezone: "Europe/London",
  today: "2026-03-02",
  knownFields: ["Pay rate"],
};

function toolUse(name: string, input: Record<string, unknown>): LlmResponse {
  return {
    text: "",
    toolCalls: [{ id: "call_1", name, input }],
    stopReason: "tool_use",
  };
}

// --- tests -----------------------------------------------------------------

describe("agent runtime", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let recorded: Recorded;

  beforeEach(() => {
    store = createMemoryStore();
    recorded = { calls: [] };
  });

  function runtimeWith(responses: LlmResponse[]) {
    const registry = new ToolRegistry();
    registry.register(readTool(recorded));
    registry.register(writeTool(recorded));
    const provider = scriptedProvider(responses);
    return {
      provider,
      runtime: createAgentRuntime({ provider, registry, store }),
    };
  }

  it("answers a plain question without touching any tool", async () => {
    const { runtime } = runtimeWith([
      { text: "We open at 8.", toolCalls: [], stopReason: "end_turn" },
    ]);

    const reply = await runtime.runTurn({
      message: "what time do we open?",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.equal(reply.text, "We open at 8.");
    assert.deepEqual(recorded.calls, []);
  });

  it("executes a read-only tool immediately", async () => {
    const { runtime } = runtimeWith([
      toolUse("get_employee_record", {}),
      { text: "You're on £12.50 an hour.", toolCalls: [], stopReason: "end_turn" },
    ]);

    const reply = await runtime.runTurn({
      message: "what am I paid?",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.equal(recorded.calls.length, 1);
    assert.match(reply.text, /12\.50/);
    assert.deepEqual(reply.executed, ["get_employee_record"]);
  });

  it("never executes a mutating tool without confirmation", async () => {
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: 14 }),
    ]);

    const reply = await runtime.runTurn({
      message: "set the pay rate to 14",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    // The write has not happened.
    assert.deepEqual(recorded.calls, []);
    assert.equal(reply.awaitingConfirmation, true);
    assert.match(reply.text, /set the pay rate to £14/);
    assert.match(reply.text, /Shall I go ahead\?/);
    assert.deepEqual(reply.quickReplies, ["Yes", "No"]);
    assert.equal(store.pending.length, 1);
  });

  it("explains instead of prompting when nothing would change", async () => {
    // Being asked "shall I go ahead?" about a change that cannot happen is a
    // dead end, so no pending action should be parked at all.
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: -5 }),
    ]);

    const reply = await runtime.runTurn({
      message: "set the pay rate to -5",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.deepEqual(recorded.calls, []);
    assert.equal(store.pending.length, 0);
    assert.equal(reply.awaitingConfirmation, undefined);
    assert.equal(reply.text, "Pay rate can't be negative.");
  });

  it("performs the write once the user says yes", async () => {
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: 14 }),
    ]);

    await runtime.runTurn({
      message: "set the pay rate to 14",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    const reply = await runtime.runTurn({
      message: "yes",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.deepEqual(recorded.calls, [{ rate: 14 }]);
    assert.match(reply.text, /pay rate is now £14/);
    assert.equal(store.pending[0]?.status, "CONFIRMED");
  });

  it("abandons the write when the user says no", async () => {
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: 14 }),
    ]);

    await runtime.runTurn({
      message: "set the pay rate to 14",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    const reply = await runtime.runTurn({
      message: "no",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.deepEqual(recorded.calls, []);
    assert.match(reply.text, /haven't changed anything/);
    assert.equal(store.pending[0]?.status, "CANCELLED");
  });

  it("decides confirmation without consulting the model", async () => {
    // The confirming turn must not reach the provider at all: a model is not
    // permitted a vote on whether a write was authorised.
    const { runtime, provider } = runtimeWith([
      toolUse("update_employee_fields", { rate: 14 }),
    ]);

    await runtime.runTurn({
      message: "set the pay rate to 14",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });
    const requestsBefore = provider.requests.length;

    await runtime.runTurn({
      message: "yes",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.equal(provider.requests.length, requestsBefore);
  });

  it("treats an ambiguous reply as a new instruction, not a yes", async () => {
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: 14 }),
      { text: "Sure, what would you like to change?", toolCalls: [], stopReason: "end_turn" },
    ]);

    await runtime.runTurn({
      message: "set the pay rate to 14",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    const reply = await runtime.runTurn({
      message: "actually hold on, what about Sam's hours instead",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.deepEqual(recorded.calls, []);
    assert.equal(store.pending[0]?.status, "CANCELLED");
    assert.equal(reply.awaitingConfirmation, undefined);
  });

  it("does not let a stale yes trigger an expired write", async () => {
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: 14 }),
      { text: "What would you like to do?", toolCalls: [], stopReason: "end_turn" },
    ]);

    await runtime.runTurn({
      message: "set the pay rate to 14",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    // Same conversation, twenty minutes later.
    const later: ToolContext = {
      ...CONTEXT,
      now: new Date("2026-03-02T09:20:00Z"),
    };
    await runtime.runTurn({
      message: "yes",
      toolContext: later,
      prompt: PROMPT,
    });

    assert.deepEqual(recorded.calls, []);
  });

  it("asks the user directly when a tool needs a lookup it can't resolve", async () => {
    // The common case is a name matching two people. The question is already
    // phrased for the user, so it should be asked rather than fed back to the
    // model — which, given identical input, would just call the tool again.
    const registry = new ToolRegistry();
    registry.register({
      name: "get_employee_record",
      description: "Read a record.",
      inputSchema: OBJECT_SCHEMA,
      mutates: false,
      parse: () => ({}),
      execute: () => {
        throw new ToolInputError("There's more than one Sam. Which one?");
      },
    });
    const provider = scriptedProvider([toolUse("get_employee_record", {})]);
    const runtime = createAgentRuntime({ provider, registry, store });

    const reply = await runtime.runTurn({
      message: "what is sam paid?",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.equal(reply.text, "There's more than one Sam. Which one?");
  });

  it("asks the user directly when a mutating tool can't resolve its target", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "update_employee_fields",
      description: "Change a record.",
      inputSchema: OBJECT_SCHEMA,
      mutates: true,
      parse: () => ({}),
      summarize: () => {
        throw new ToolInputError("Which member of staff did you mean?");
      },
      execute: async () => ({ message: "should never run" }),
    });
    const provider = scriptedProvider([
      toolUse("update_employee_fields", { rate: 20 }),
    ]);
    const runtime = createAgentRuntime({ provider, registry, store });

    const reply = await runtime.runTurn({
      message: "update the pay rate to 20",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.equal(reply.text, "Which member of staff did you mean?");
    // Crucially, no write was parked against an unknown target.
    assert.equal(store.pending.length, 0);
  });

  it("asks the model to clarify when tool arguments are unusable", async () => {
    const { runtime } = runtimeWith([
      toolUse("update_employee_fields", { rate: "not a number" }),
      { text: "What rate should I set?", toolCalls: [], stopReason: "end_turn" },
    ]);

    const reply = await runtime.runTurn({
      message: "change the pay rate",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.deepEqual(recorded.calls, []);
    assert.equal(reply.text, "What rate should I set?");
  });

  it("hides owner-only tools from staff", async () => {
    const registry = new ToolRegistry();
    registry.register(readTool(recorded));
    registry.register({
      name: "list_employees",
      description: "List all staff.",
      inputSchema: OBJECT_SCHEMA,
      mutates: false,
      parse: () => ({}),
      execute: async () => ({ message: "everyone" }),
    });
    const provider = scriptedProvider([
      { text: "ok", toolCalls: [], stopReason: "end_turn" },
    ]);
    const runtime = createAgentRuntime({ provider, registry, store });

    await runtime.runTurn({
      message: "hello",
      toolContext: {
        ...CONTEXT,
        actor: {
          role: "EMPLOYEE",
          isSubject: true,
          displayName: "Sam",
          employeeId: "emp_1",
        },
      },
      prompt: PROMPT,
    });

    const offered = provider.requests[0]!.tools.map((tool) => tool.name);
    assert.deepEqual(offered, ["get_employee_record"]);
  });

  it("records the conversation for audit and replay", async () => {
    const { runtime } = runtimeWith([
      { text: "We open at 8.", toolCalls: [], stopReason: "end_turn" },
    ]);

    await runtime.runTurn({
      message: "what time do we open?",
      toolContext: CONTEXT,
      prompt: PROMPT,
    });

    assert.deepEqual(
      store.messages.map((message) => [message.role, message.body]),
      [
        ["USER", "what time do we open?"],
        ["ASSISTANT", "We open at 8."],
      ],
    );
  });
});
