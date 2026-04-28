import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mock the Prisma module before importing the service — the service
 * imports `prisma` at top level, so the mock has to be in place first.
 */
const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    featureFlag: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

import {
  __resetFeatureFlagCacheForTests,
  getFeatureFlag,
  getFeatureFlags,
} from "@/server/services/feature-flags";

beforeEach(() => {
  __resetFeatureFlagCacheForTests();
  findUnique.mockReset();
  findMany.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getFeatureFlag", () => {
  it("returns DB value on first call and caches for subsequent calls within TTL", async () => {
    findUnique.mockResolvedValueOnce({ enabled: true });

    const first = await getFeatureFlag("wizard_mobile_shell");
    const second = await getFeatureFlag("wizard_mobile_shell");

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("defaults to false when the row does not exist", async () => {
    findUnique.mockResolvedValueOnce(null);
    const value = await getFeatureFlag("missing_key");
    expect(value).toBe(false);
  });

  it("re-queries after the TTL expires", async () => {
    vi.useFakeTimers();
    findUnique.mockResolvedValueOnce({ enabled: false });
    findUnique.mockResolvedValueOnce({ enabled: true });

    const first = await getFeatureFlag("wizard_mobile_shell");
    expect(first).toBe(false);

    // 30s TTL — jump past it.
    vi.setSystemTime(Date.now() + 35_000);

    const second = await getFeatureFlag("wizard_mobile_shell");
    expect(second).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("getFeatureFlags (batch)", () => {
  it("fetches uncached keys in a single findMany and caches them", async () => {
    findMany.mockResolvedValueOnce([
      { key: "wizard_mobile_shell", enabled: true },
      { key: "wizard_inline_auth", enabled: false },
    ]);

    const result = await getFeatureFlags([
      "wizard_mobile_shell",
      "wizard_inline_auth",
      "wizard_intl_licence_flow",
    ] as const);

    expect(result).toEqual({
      wizard_mobile_shell: true,
      wizard_inline_auth: false,
      // Row missing from DB → defaulted to false.
      wizard_intl_licence_flow: false,
    });
    expect(findMany).toHaveBeenCalledTimes(1);

    // Second call within TTL — no DB hit.
    findMany.mockClear();
    const again = await getFeatureFlags([
      "wizard_mobile_shell",
      "wizard_inline_auth",
    ] as const);
    expect(again.wizard_mobile_shell).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });
});
