import { describe, expect, it } from "vitest";
import { normalizeResolvedProviderModel } from "./model.provider-normalization.js";

describe("normalizeResolvedProviderModel", () => {
  it("maps opaque github-copilot Codex transport markers to the Codex responses api", () => {
    const result = normalizeResolvedProviderModel({
      provider: "github-copilot",
      model: {
        id: "gpt-5.3-codex",
        name: "gpt-5.3-codex",
        api: "github-copilot",
        provider: "github-copilot",
        baseUrl: "https://api.githubcopilot.com",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384,
      },
    });

    expect(result.api).toBe("openai-codex-responses");
  });

  it("maps opaque github-copilot Claude transport markers to anthropic-messages", () => {
    const result = normalizeResolvedProviderModel({
      provider: "github-copilot",
      model: {
        id: "claude-sonnet-4.6",
        name: "claude-sonnet-4.6",
        api: "github-copilot",
        provider: "github-copilot",
        baseUrl: "https://api.githubcopilot.com",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 32_000,
      },
    });

    expect(result.api).toBe("anthropic-messages");
  });
});
