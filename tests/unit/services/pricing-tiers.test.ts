import { describe, expect, test, vi } from "vitest";
import { Prisma, type PricingTier } from "@prisma/client";
import {
  computeProgressiveTierTotal,
  quote,
  quoteExtension,
  quoteSwapDelta,
} from "@/server/services/pricing";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeTier(
  minDays: number,
  maxDays: number,
  tierTotal: number,
): PricingTier {
  // Realistic Prisma rows: tierTotal is a Decimal.
  return {
    id: `t-${minDays}`,
    categoryId: "cat1",
    vehicleId: null,
    minDays,
    maxDays,
    tierTotal: new Prisma.Decimal(tierTotal),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// User's working example: 1-2 @ $500, 3-7 @ $1197, 8-14 @ $1080, 15-21 @ $1024,
// 22-83 @ $960. 14-day rental = $2,777; 13-day rental = $2,622.71.
const BMW_LADDER = [
  makeTier(1, 2, 500),
  makeTier(3, 7, 1197),
  makeTier(8, 14, 1080),
  makeTier(15, 21, 1024),
  makeTier(22, 83, 960),
];

// -----------------------------------------------------------------------------
// Pure calculator
// -----------------------------------------------------------------------------

describe("computeProgressiveTierTotal", () => {
  test("14-day booking fills the first three tiers exactly — $2,777", () => {
    const total = computeProgressiveTierTotal(BMW_LADDER, 14);
    expect(Number(total)).toBeCloseTo(500 + 1197 + 1080, 2);
    expect(Number(total)).toBeCloseTo(2777, 2);
  });

  test("13-day booking pro-rates the tail of tier 3 — ~$2,622.71", () => {
    const total = computeProgressiveTierTotal(BMW_LADDER, 13);
    // $500 + $1197 + (6 × $1080/7) = $500 + $1197 + $925.714... ≈ $2622.71
    expect(Number(total)).toBeCloseTo(500 + 1197 + (1080 / 7) * 6, 2);
    expect(Number(total)).toBeCloseTo(2622.71, 2);
  });

  test("1-day booking pays pro-rata of the first tier", () => {
    const total = computeProgressiveTierTotal(BMW_LADDER, 1);
    // 1 day in tier 1 (2-day tier at $500) = 250
    expect(Number(total)).toBeCloseTo(250, 2);
  });

  test("exact tier boundary — 7 days fills tiers 1 + 2 exactly", () => {
    const total = computeProgressiveTierTotal(BMW_LADDER, 7);
    expect(Number(total)).toBeCloseTo(500 + 1197, 2);
  });

  test("8 days steps one day into tier 3", () => {
    const total = computeProgressiveTierTotal(BMW_LADDER, 8);
    expect(Number(total)).toBeCloseTo(500 + 1197 + 1080 / 7, 2);
  });

  test("overflow past the last tier's maxDays extrapolates at last tier's per-day", () => {
    // Last tier 22-83 @ $960 spans 62 days → $15.4839/day
    // 100-day rental fills tiers 1-5 (83 days) then 17 extra days at last per-day
    const total = computeProgressiveTierTotal(BMW_LADDER, 100);
    const tierSum = 500 + 1197 + 1080 + 1024 + 960; // days 1..83
    const extra = (960 / 62) * 17;
    expect(Number(total)).toBeCloseTo(tierSum + extra, 2);
  });

  test("empty tier list returns 0 (caller falls back)", () => {
    const total = computeProgressiveTierTotal([], 5);
    expect(Number(total)).toBe(0);
  });

  test("zero-day booking returns 0", () => {
    const total = computeProgressiveTierTotal(BMW_LADDER, 0);
    expect(Number(total)).toBe(0);
  });

  test("single-tier ladder with partial fill", () => {
    const oneTier = [makeTier(1, 10, 1000)];
    // 4 days in a 10-day @ $1000 tier = $400 pro-rata
    expect(Number(computeProgressiveTierTotal(oneTier, 4))).toBeCloseTo(400, 2);
  });
});

// -----------------------------------------------------------------------------
// quote() integration — tiers vs fallback
// -----------------------------------------------------------------------------

function makeQuoteFake(opts: {
  tiers?: PricingTier[];
  seasonMultiplier?: number;
}) {
  const category = {
    id: "cat1",
    name: "BMW R1250 GS",
    baseDailyRate: new Prisma.Decimal(500),
    baseWeeklyRate: new Prisma.Decimal(3000),
    baseMonthlyRate: new Prisma.Decimal(12000),
    bondAmount: new Prisma.Decimal(2000),
    onlinePaymentStrategy: "FULL" as const,
    bookingFeeFlat: null,
    bookingFeePercent: null,
    longTermMinDays: null,
    longTermDefaultFrequency: "WEEKLY" as const,
  };
  return {
    vehicleCategory: {
      findUniqueOrThrow: vi.fn(async () => category),
    },
    season: {
      findMany: vi.fn(async () =>
        opts.seasonMultiplier
          ? [{ multiplier: new Prisma.Decimal(opts.seasonMultiplier) }]
          : [],
      ),
    },
    addon: { findMany: vi.fn(async () => []) },
    insuranceOption: { findUnique: vi.fn(async () => null) },
    discount: { findUnique: vi.fn(async () => null) },
    oneWayFee: { findUnique: vi.fn(async () => null) },
    pricingTier: {
      findMany: vi.fn(async ({ where }: { where: { categoryId?: string; vehicleId?: string } }) => {
        if (where.vehicleId) return []; // no vehicle-level tiers in these tests
        return opts.tiers ?? [];
      }),
    },
  } as unknown as Parameters<typeof quote>[0];
}

describe("quote() with PricingTier ladder", () => {
  test("when tiers exist: base subtotal comes from progressive calc, method = TIERED", async () => {
    const fake = makeQuoteFake({ tiers: BMW_LADDER });
    const q = await quote(fake, {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-15T10:00:00+10:00"), // 14 days
    });
    expect(q.durationDays).toBe(14);
    expect(q.pricingMethod).toBe("TIERED");
    expect(q.baseSubtotal).toBeCloseTo(2777, 2);
    expect(q.totalAmount).toBeCloseTo(2777, 2);
    // Tiers replace the hardcoded duration discount entirely.
    expect(q.durationDiscountPct).toBe(0);
  });

  test("when tiers exist: hardcoded 10%/25% duration discount is NOT applied", async () => {
    const fake = makeQuoteFake({ tiers: BMW_LADDER });
    // 30-day booking → legacy would apply 25% off on top. Tiers should not.
    const q = await quote(fake, {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-07-01T10:00:00+10:00"), // 30 days
    });
    // 30 days = 1-2 ($500) + 3-7 ($1197) + 8-14 ($1080) + 15-21 ($1024) + (9/62 × 960) days in tier 5
    const expectedBase =
      500 + 1197 + 1080 + 1024 + (960 / 62) * 9;
    expect(q.pricingMethod).toBe("TIERED");
    expect(q.baseSubtotal).toBeCloseTo(expectedBase, 2);
    expect(q.durationDiscountPct).toBe(0);
    // And the total is NOT 0.75 × expectedBase (which it would be if the 25%
    // discount were still stacking on top).
    expect(q.totalAmount).not.toBeCloseTo(expectedBase * 0.75, 1);
  });

  test("season multiplier still multiplies the tier total", async () => {
    const fake = makeQuoteFake({ tiers: BMW_LADDER, seasonMultiplier: 1.5 });
    const q = await quote(fake, {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-12-25T10:00:00+10:00"),
      returnDateTime: new Date("2027-01-08T10:00:00+10:00"), // 14 days
    });
    expect(q.pricingMethod).toBe("TIERED");
    expect(q.seasonMultiplier).toBe(1.5);
    // 2777 × 1.5 = 4165.50
    expect(q.totalAmount).toBeCloseTo(2777 * 1.5, 1);
  });

  test("no tiers: falls back to flat daily/weekly/monthly + duration discount", async () => {
    const fake = makeQuoteFake({ tiers: [] });
    const q = await quote(fake, {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-08T10:00:00+10:00"), // 7 days
    });
    expect(q.pricingMethod).toBe("FLAT");
    expect(q.durationDiscountPct).toBeCloseTo(0.1, 5);
    // Weekly rate = 3000/7 = 428.57/day → 3000 × 0.9 = 2700
    expect(q.totalAmount).toBeCloseTo(2700, 2);
  });

  test("vehicle-scoped tiers take precedence over category-scoped tiers", async () => {
    const vehicleLadder = [makeTier(1, 7, 700)]; // flat cheaper vehicle
    const fake = {
      vehicleCategory: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cat1",
          name: "BMW R1250 GS",
          baseDailyRate: new Prisma.Decimal(500),
          baseWeeklyRate: new Prisma.Decimal(3000),
          baseMonthlyRate: new Prisma.Decimal(12000),
          bondAmount: new Prisma.Decimal(2000),
          onlinePaymentStrategy: "FULL" as const,
          bookingFeeFlat: null,
          bookingFeePercent: null,
          longTermMinDays: null,
          longTermDefaultFrequency: "WEEKLY" as const,
        })),
      },
      season: { findMany: vi.fn(async () => []) },
      addon: { findMany: vi.fn(async () => []) },
      insuranceOption: { findUnique: vi.fn(async () => null) },
      discount: { findUnique: vi.fn(async () => null) },
      oneWayFee: { findUnique: vi.fn(async () => null) },
      pricingTier: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: { categoryId?: string; vehicleId?: string };
          }) => (where.vehicleId ? vehicleLadder : BMW_LADDER),
        ),
      },
    } as unknown as Parameters<typeof quote>[0];

    const q = await quote(fake, {
      categoryId: "cat1",
      vehicleId: "veh1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-08T10:00:00+10:00"), // 7 days
    });
    expect(q.pricingMethod).toBe("TIERED");
    // Vehicle ladder: 7 days in a 1-7 @ $700 tier = $700 flat
    expect(q.baseSubtotal).toBeCloseTo(700, 2);
  });
});

// -----------------------------------------------------------------------------
// quoteExtension() with tiers
// -----------------------------------------------------------------------------

describe("quoteExtension() with tier ladder", () => {
  test("extension is priced by the tier ladder when present", async () => {
    const fake = {
      vehicleCategory: {
        findUniqueOrThrow: async () => ({
          id: "cat1",
          name: "BMW R1250 GS",
          baseDailyRate: new Prisma.Decimal(500),
          baseWeeklyRate: new Prisma.Decimal(3000),
          baseMonthlyRate: new Prisma.Decimal(12000),
          bondAmount: new Prisma.Decimal(2000),
        }),
      },
      season: { findMany: async () => [] },
      pricingTier: { findMany: async () => BMW_LADDER },
    } as unknown as Parameters<typeof quoteExtension>[0];

    const q = await quoteExtension(fake, {
      categoryId: "cat1",
      oldReturnDateTime: new Date("2026-06-01T10:00:00+10:00"),
      newReturnDateTime: new Date("2026-06-04T10:00:00+10:00"), // 3-day extension
    });
    expect(q.extensionDays).toBe(3);
    expect(q.pricingMethod).toBe("TIERED");
    // 3 days = tier 1 full ($500) + 1 day in tier 2 ($1197/5) = $500 + $239.40
    expect(q.baseSubtotal).toBeCloseTo(500 + 1197 / 5, 2);
    // Hardcoded duration discount is suppressed when tiers are present.
    expect(q.durationDiscountPct).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// quoteSwapDelta() with tiers
// -----------------------------------------------------------------------------

describe("quoteSwapDelta() with tier ladder", () => {
  test("tiers on both sides → method = TIERED, legacy duration discount suppressed", async () => {
    const cheaperLadder = [makeTier(1, 7, 500), makeTier(8, 30, 1400)];
    const fake = {
      vehicleCategory: {
        findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          name: `Cat ${where.id}`,
          baseDailyRate: new Prisma.Decimal(100),
          baseWeeklyRate: new Prisma.Decimal(600),
          baseMonthlyRate: new Prisma.Decimal(2400),
          bondAmount: new Prisma.Decimal(500),
        }),
      },
      season: { findMany: async () => [] },
      pricingTier: {
        findMany: async ({
          where,
        }: {
          where: { categoryId?: string; vehicleId?: string };
        }) => {
          if (where.categoryId === "A") return BMW_LADDER;
          if (where.categoryId === "B") return cheaperLadder;
          return [];
        },
      },
    } as unknown as Parameters<typeof quoteSwapDelta>[0];

    const q = await quoteSwapDelta(fake, {
      oldCategoryId: "A",
      newCategoryId: "B",
      swapAt: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-08T10:00:00+10:00"), // 7 days remaining
    });
    expect(q.pricingMethod).toBe("TIERED");
    expect(q.durationDiscountPct).toBe(0);
    // Old (BMW) 7 days = 500 + 1197 = 1697
    // New (cheaper) 7 days in 1-7 @ $500 = 500
    expect(q.oldRemainderAmount).toBeCloseTo(1697, 2);
    expect(q.newRemainderAmount).toBeCloseTo(500, 2);
    expect(q.deltaAmount).toBeCloseTo(-1197, 2);
    expect(q.direction).toBe("REFUND");
  });
});
