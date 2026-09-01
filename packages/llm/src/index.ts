import { createAnthropicProvider } from "./anthropic.ts";
import { createMockProvider } from "./mock.ts";
import { LlmConfigurationError, type LlmProvider } from "./types.ts";

export * from "./types.ts";
export { createAnthropicProvider } from "./anthropic.ts";
export { createMockProvider } from "./mock.ts";

export type LlmProviderKind = "mock" | "anthropic";

/**
 * Build the provider named by the environment.
 *
 * Flipping to real Claude is one variable: MYCREW_LLM_PROVIDER="anthropic"
 * plus an ANTHROPIC_API_KEY. Nothing downstream changes.
 */
export function createLlmProvider(
  env: Record<string, string | undefined> = process.env,
): LlmProvider {
  const kind = (env["MYCREW_LLM_PROVIDER"] ?? "mock").toLowerCase();

  switch (kind) {
    case "mock":
      return createMockProvider();

    case "anthropic":
      return createAnthropicProvider({
        apiKey: env["ANTHROPIC_API_KEY"] ?? "",
        ...(env["ANTHROPIC_MODEL"] ? { model: env["ANTHROPIC_MODEL"] } : {}),
        ...(env["ANTHROPIC_WORKSPACE_ID"]
          ? { workspaceId: env["ANTHROPIC_WORKSPACE_ID"] }
          : {}),
      });

    default:
      throw new LlmConfigurationError(
        `Unknown MYCREW_LLM_PROVIDER "${kind}". Expected "mock" or "anthropic".`,
      );
  }
}
