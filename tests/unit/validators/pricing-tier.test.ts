import { describe, expect, test } from "vitest";
import { pricingTierReplaceInputSchema } from "@/lib/validators/pricing-tier";

describe("pricingTierReplaceInputSchema", () => {
  test("accepts a valid BMW ladder (1-2, 3-7, 8-14, 15-21, 22-83)", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [
        { minDays: 1, maxDays: 2, tierTotal: 500 },
        { minDays: 3, maxDays: 7, tierTotal: 1197 },
        { minDays: 8, maxDays: 14, tierTotal: 1080 },
        { minDays: 15, maxDays: 21, tierTotal: 1024 },
        { minDays: 22, maxDays: 83, tierTotal: 960 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts an empty ladder (clears all tiers)", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects ladders that don't start at day 1", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [{ minDays: 2, maxDays: 7, tierTotal: 500 }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toContain("day 1");
    }
  });

  test("rejects non-contiguous tiers (gap between brackets)", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [
        { minDays: 1, maxDays: 2, tierTotal: 500 },
        { minDays: 5, maxDays: 10, tierTotal: 1000 }, // gap: days 3-4 missing
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toContain("day 3");
    }
  });

  test("rejects overlapping tiers", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [
        { minDays: 1, maxDays: 7, tierTotal: 500 },
        { minDays: 5, maxDays: 10, tierTotal: 1000 }, // overlaps days 5-7
      ],
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects tiers with maxDays < minDays", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [{ minDays: 5, maxDays: 3, tierTotal: 500 }],
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects negative tier totals", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "CATEGORY",
      scopeId: "cat1",
      tiers: [{ minDays: 1, maxDays: 7, tierTotal: -100 }],
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts both CATEGORY and VEHICLE scopes", () => {
    for (const scope of ["CATEGORY", "VEHICLE"] as const) {
      const parsed = pricingTierReplaceInputSchema.safeParse({
        scope,
        scopeId: "some-id",
        tiers: [{ minDays: 1, maxDays: 7, tierTotal: 500 }],
      });
      expect(parsed.success).toBe(true);
    }
  });

  test("rejects unknown scope", () => {
    const parsed = pricingTierReplaceInputSchema.safeParse({
      scope: "DEPOT",
      scopeId: "d1",
      tiers: [{ minDays: 1, maxDays: 7, tierTotal: 500 }],
    });
    expect(parsed.success).toBe(false);
  });
});
