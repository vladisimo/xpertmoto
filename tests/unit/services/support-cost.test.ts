import { describe, expect, it } from "vitest";
import { usageToAud } from "../../../src/server/services/support-cost";

describe("usageToAud", () => {
  it("uses upstream USD cost for OpenRouter when present", () => {
    const aud = usageToAud({
      provider: "openrouter",
      model: "anthropic/claude-haiku-4.5",
      inputTokens: 100,
      outputTokens: 100,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      upstreamCostUsd: 0.002,
    });
    // 0.002 * 1.55 = 0.0031
    expect(aud).toBeCloseTo(0.0031, 5);
  });

  it("computes from tokens for direct Anthropic", () => {
    const aud = usageToAud({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
    });
    // 1M input tokens at $1 per 1M USD × 1.55 AUD rate = $1.55 AUD
    expect(aud).toBeCloseTo(1.55, 4);
  });

  it("cache hits cost much less than fresh input", () => {
    const fresh = usageToAud({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
    });
    const cached = usageToAud({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 100_000,
      cacheCreationTokens: 0,
    });
    expect(cached).toBeLessThan(fresh);
  });
});
