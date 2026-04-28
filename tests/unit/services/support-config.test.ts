import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupportConfig } from "../../../src/lib/support-config";

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const backup: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    backup[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(backup)) {
      if (backup[key] === undefined) delete process.env[key];
      else process.env[key] = backup[key];
    }
  }
}

afterEach(() => vi.restoreAllMocks());

describe("getSupportConfig", () => {
  it("disables AI when no provider keys are set", () => {
    withEnv(
      {
        SUPPORT_ENABLED: "true",
        SUPPORT_AI_ENABLED: "true",
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "",
        SUPPORT_AI_PROVIDER: undefined,
      },
      () => {
        const cfg = getSupportConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.aiEnabled).toBe(false);
        expect(cfg.provider).toBeNull();
      },
    );
  });

  it("picks OpenRouter when only OpenRouter key is set", () => {
    withEnv(
      {
        SUPPORT_ENABLED: "true",
        SUPPORT_AI_ENABLED: "true",
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "sk-or-xxx",
        SUPPORT_AI_PROVIDER: undefined,
      },
      () => {
        const cfg = getSupportConfig();
        expect(cfg.provider).toBe("openrouter");
        expect(cfg.model).toBe("anthropic/claude-haiku-4.5");
      },
    );
  });

  it("picks Anthropic when only Anthropic key is set", () => {
    withEnv(
      {
        SUPPORT_ENABLED: "true",
        SUPPORT_AI_ENABLED: "true",
        ANTHROPIC_API_KEY: "sk-ant-xxx",
        OPENROUTER_API_KEY: "",
        SUPPORT_AI_PROVIDER: undefined,
      },
      () => {
        const cfg = getSupportConfig();
        expect(cfg.provider).toBe("anthropic");
        expect(cfg.model).toBe("claude-haiku-4-5-20251001");
      },
    );
  });

  it("honours SUPPORT_AI_PROVIDER override when both keys are set", () => {
    withEnv(
      {
        SUPPORT_AI_ENABLED: "true",
        ANTHROPIC_API_KEY: "sk-ant-xxx",
        OPENROUTER_API_KEY: "sk-or-xxx",
        SUPPORT_AI_PROVIDER: "anthropic",
      },
      () => {
        expect(getSupportConfig().provider).toBe("anthropic");
      },
    );
  });

  it("SUPPORT_ENABLED=false forces aiEnabled off upstream consumers", () => {
    withEnv(
      {
        SUPPORT_ENABLED: "false",
        SUPPORT_AI_ENABLED: "true",
        OPENROUTER_API_KEY: "sk-or-xxx",
      },
      () => {
        const cfg = getSupportConfig();
        expect(cfg.enabled).toBe(false);
      },
    );
  });
});
