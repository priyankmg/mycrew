import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { SIMULATOR_TOKEN_HEADER, simulatorDenied } from "./simulator-gate.ts";

const originalEnv = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function request(token?: string): Request {
  return new Request("https://example.test/api/users", {
    headers: token === undefined ? {} : { [SIMULATOR_TOKEN_HEADER]: token },
  });
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("simulator gate", () => {
  it("allows everything outside production", () => {
    setEnv({ NODE_ENV: "development", MYCREW_SIMULATOR_TOKEN: undefined });

    assert.equal(simulatorDenied(request()), undefined);
  });

  it("denies in production when no token is configured", async () => {
    // The important case: deploying without having thought about the simulator
    // must leave it closed, not open.
    setEnv({ NODE_ENV: "production", MYCREW_SIMULATOR_TOKEN: undefined });

    const denied = simulatorDenied(request());

    assert.ok(denied, "expected the request to be refused");
    assert.equal(denied.status, 404);
    const body = (await denied.json()) as { error: string };
    assert.match(body.error, /disabled on this deployment/);
  });

  it("denies in production when the token is blank or whitespace", () => {
    setEnv({ NODE_ENV: "production", MYCREW_SIMULATOR_TOKEN: "   " });

    // An empty value in a dashboard is a common way to "unset" a variable and
    // must not count as enabling the simulator with an empty password.
    assert.ok(simulatorDenied(request("")));
    assert.ok(simulatorDenied(request("   ")));
  });

  it("denies a wrong token, and says nothing different about it", async () => {
    setEnv({ NODE_ENV: "production", MYCREW_SIMULATOR_TOKEN: "correct-horse" });

    const wrong = simulatorDenied(request("battery-staple"));
    const missing = simulatorDenied(request());

    assert.ok(wrong);
    assert.ok(missing);
    assert.equal(wrong.status, missing.status);
    assert.deepEqual(await wrong.json(), await missing.json());
  });

  it("allows the configured token", () => {
    setEnv({ NODE_ENV: "production", MYCREW_SIMULATOR_TOKEN: "correct-horse" });

    assert.equal(simulatorDenied(request("correct-horse")), undefined);
  });

  it("is not fooled by a token that merely starts correctly", () => {
    setEnv({ NODE_ENV: "production", MYCREW_SIMULATOR_TOKEN: "correct-horse" });

    assert.ok(simulatorDenied(request("correct")));
    assert.ok(simulatorDenied(request("correct-horse-extra")));
  });
});
