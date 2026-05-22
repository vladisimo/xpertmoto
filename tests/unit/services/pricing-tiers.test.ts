import { describe, expect, test, vi } from "vitest";
import { Prisma, type PricingTier } from "@prisma/client";
import {
  computeProgressiveTierTotal,
  quote,
  quoteExtension,
  quoteSwapDelta,
  MinimumRentalPeriodError,
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
    modelId: null,
    vehicleId: null,
    minDays,
    maxDays,
    tierTotal: new Prisma.Decimal(tierTotal),
    tierMode: "PROGRESSIVE",
    pricePerWeek: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePerWeekTier(
  minDays: number,
  maxDays: number,
  pricePerWeek: number,
): PricingTier {
  return {
    id: `pw-${minDays}`,
    categoryId: null,
    modelId: "model1",
    vehicleId: null,
    minDays,
    maxDays,
    tierTotal: new Prisma.Decimal(0),
    tierMode: "PER_WEEK",
    pricePerWeek: new Prisma.Decimal(pricePerWeek),
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
      vehicle: {
        findUnique: vi.fn(async () => ({
          baseRateOverride: null,
          basePeriodHoursOverride: null,
          modelId: null,
          catalogueModel: null,
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

// -----------------------------------------------------------------------------
// PER_WEEK tier mode — xpertmoto.com.au rate card
// -----------------------------------------------------------------------------

describe("computeProgressiveTierTotal — PER_WEEK mode", () => {
  // Honda CB125F xpertmoto ladder. 24h base = $110, then per-week tiers.
  // 1wk $168 flat → expressed as PER_WEEK $168 for days 7..13.
  const CB125F_LADDER: PricingTier[] = [
    makePerWeekTier(7, 13, 168),
    makePerWeekTier(14, 20, 152),
    makePerWeekTier(21, 27, 144),
    makePerWeekTier(28, 83, 136),
    makePerWeekTier(84, 3650, 110),
  ];

  // BMW R1250GS Trophy xpertmoto ladder. Premium bike, 48 h base ($500).
  const R1250GS_LADDER: PricingTier[] = [
    makePerWeekTier(7, 13, 1197),
    makePerWeekTier(14, 20, 1080),
    makePerWeekTier(21, 27, 1024),
    makePerWeekTier(28, 83, 960),
    makePerWeekTier(84, 3650, 755),
  ];

  test("CB125F 14-day = $152 × 2 = $304", () => {
    const total = computeProgressiveTierTotal(CB125F_LADDER, 14);
    expect(Number(total)).toBeCloseTo(304, 2);
  });

  test("R1250GS 28-day = $960 × 4 = $3,840", () => {
    const total = computeProgressiveTierTotal(R1250GS_LADDER, 28);
    expect(Number(total)).toBeCloseTo(3840, 2);
  });

  test("CB125F 7-day uses the 1-week tier — $168 × 1", () => {
    const total = computeProgressiveTierTotal(CB125F_LADDER, 7);
    expect(Number(total)).toBeCloseTo(168, 2);
  });

  test("8-day rental pro-rates the 1-week tier: $168 × 8/7", () => {
    // 8 days falls in the 7..13 day tier. PER_WEEK pricing pro-rates by
    // day within the tier instead of rounding up to a full week, so the
    // customer doesn't see a $168 jump for one extra day.
    const total = computeProgressiveTierTotal(CB125F_LADDER, 8);
    expect(Number(total)).toBeCloseTo((168 / 7) * 8, 2);
  });

  test("R1250GS 90-day uses the 12+ wk tier — $755 × 90/7", () => {
    // 90 days falls in the 12+ wk tier (84-3650). Pro-rata: $755 × 90/7.
    const total = computeProgressiveTierTotal(R1250GS_LADDER, 90);
    expect(Number(total)).toBeCloseTo((755 / 7) * 90, 2);
  });
});

describe("48 h base period (xpertmoto premium bikes)", () => {
  // R1250GS-style: $500 covers any 1–2 day rental, 1-day rejected.
  function fake48hVehicle() {
    return {
      vehicleCategory: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cat-prem",
          name: "BMW R1250 GS",
          baseDailyRate: new Prisma.Decimal(250),
          baseWeeklyRate: new Prisma.Decimal(1750),
          baseMonthlyRate: new Prisma.Decimal(7000),
          bondAmount: new Prisma.Decimal(2000),
          onlinePaymentStrategy: "FULL" as const,
          bookingFeeFlat: null,
          bookingFeePercent: null,
          longTermMinDays: null,
          longTermDefaultFrequency: "WEEKLY" as const,
        })),
      },
      vehicle: {
        findUnique: vi.fn(async () => ({
          baseRateOverride: null,
          basePeriodHoursOverride: null,
          modelId: "model-prem",
          catalogueModel: {
            baseRate: new Prisma.Decimal(500),
            basePeriodHours: "H48" as const,
          },
        })),
      },
      season: { findMany: vi.fn(async () => []) },
      addon: { findMany: vi.fn(async () => []) },
      insuranceOption: { findUnique: vi.fn(async () => null) },
      discount: { findUnique: vi.fn(async () => null) },
      oneWayFee: { findUnique: vi.fn(async () => null) },
      pricingTier: { findMany: vi.fn(async () => []) }, // flat path
    } as unknown as Parameters<typeof quote>[0];
  }

  test("2-day rental on a 48 h bike pays exactly the base rate", async () => {
    const q = await quote(fake48hVehicle(), {
      categoryId: "cat-prem",
      vehicleId: "veh-prem",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-03T10:00:00+10:00"),
    });
    expect(q.durationDays).toBe(2);
    expect(q.totalAmount).toBeCloseTo(500, 2);
    expect(q.pricingMethod).toBe("FLAT");
  });

  test("1-day rental on a 48 h bike throws MinimumRentalPeriodError", async () => {
    await expect(
      quote(fake48hVehicle(), {
        categoryId: "cat-prem",
        vehicleId: "veh-prem",
        pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
        returnDateTime: new Date("2026-06-02T10:00:00+10:00"),
      }),
    ).rejects.toBeInstanceOf(MinimumRentalPeriodError);
  });

  test("3-day rental on a 48 h bike adds one half-base day", async () => {
    // 48 h base = $500 → per-day = $250 → 3 days = $750
    const q = await quote(fake48hVehicle(), {
      categoryId: "cat-prem",
      vehicleId: "veh-prem",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-04T10:00:00+10:00"),
    });
    expect(q.totalAmount).toBeCloseTo(750, 2);
  });
});

describe("Per-model base rate cascade", () => {
  test("model.baseRate wins over category.baseDailyRate when no override", async () => {
    const fake = {
      vehicleCategory: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cat1",
          name: "125cc",
          baseDailyRate: new Prisma.Decimal(80), // category default
          baseWeeklyRate: new Prisma.Decimal(560),
          baseMonthlyRate: new Prisma.Decimal(2200),
          bondAmount: new Prisma.Decimal(500),
          onlinePaymentStrategy: "FULL" as const,
          bookingFeeFlat: null,
          bookingFeePercent: null,
          longTermMinDays: null,
          longTermDefaultFrequency: "WEEKLY" as const,
        })),
      },
      vehicle: {
        findUnique: vi.fn(async () => ({
          baseRateOverride: null, // no per-vehicle override
          basePeriodHoursOverride: null,
          modelId: "model-cb125f",
          catalogueModel: {
            baseRate: new Prisma.Decimal(110), // model overrides category
            basePeriodHours: "H24" as const,
          },
        })),
      },
      season: { findMany: vi.fn(async () => []) },
      addon: { findMany: vi.fn(async () => []) },
      insuranceOption: { findUnique: vi.fn(async () => null) },
      discount: { findUnique: vi.fn(async () => null) },
      oneWayFee: { findUnique: vi.fn(async () => null) },
      pricingTier: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof quote>[0];

    const q = await quote(fake, {
      categoryId: "cat1",
      vehicleId: "veh1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-02T10:00:00+10:00"), // 1 day
    });
    // Model baseRate $110 wins over category $80.
    expect(q.totalAmount).toBeCloseTo(110, 2);
  });

  test("vehicle.baseRateOverride wins over model.baseRate", async () => {
    const fake = {
      vehicleCategory: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cat1",
          name: "125cc",
          baseDailyRate: new Prisma.Decimal(80),
          baseWeeklyRate: new Prisma.Decimal(560),
          baseMonthlyRate: new Prisma.Decimal(2200),
          bondAmount: new Prisma.Decimal(500),
          onlinePaymentStrategy: "FULL" as const,
          bookingFeeFlat: null,
          bookingFeePercent: null,
          longTermMinDays: null,
          longTermDefaultFrequency: "WEEKLY" as const,
        })),
      },
      vehicle: {
        findUnique: vi.fn(async () => ({
          baseRateOverride: new Prisma.Decimal(140), // override applies
          basePeriodHoursOverride: null,
          modelId: "model-cb125f",
          catalogueModel: {
            baseRate: new Prisma.Decimal(110),
            basePeriodHours: "H24" as const,
          },
        })),
      },
      season: { findMany: vi.fn(async () => []) },
      addon: { findMany: vi.fn(async () => []) },
      insuranceOption: { findUnique: vi.fn(async () => null) },
      discount: { findUnique: vi.fn(async () => null) },
      oneWayFee: { findUnique: vi.fn(async () => null) },
      pricingTier: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof quote>[0];

    const q = await quote(fake, {
      categoryId: "cat1",
      vehicleId: "veh1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-02T10:00:00+10:00"), // 1 day
    });
    expect(q.totalAmount).toBeCloseTo(140, 2);
  });
});

// -----------------------------------------------------------------------------
// 50%-of-week-1 deposit basis (xpertmoto convention) + payOnlineBreakdown
// -----------------------------------------------------------------------------

describe("PERCENT deposit with depositBasis=WEEK1", () => {
  // Ducati Monster 659 ladder from xpertmoto's rate card.
  const DUCATI_LADDER: PricingTier[] = [
    makePerWeekTier(7, 13, 496),
    makePerWeekTier(14, 20, 448),
    makePerWeekTier(21, 27, 424),
    makePerWeekTier(28, 83, 400),
    makePerWeekTier(84, 3650, 314),
  ];

  function ducatiQuoteFake(opts: { depositBasis?: "TOTAL" | "WEEK1" } = {}) {
    return {
      vehicleCategory: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cat-ur",
          name: "Unrestricted Motorcycle",
          baseDailyRate: new Prisma.Decimal(140),
          baseWeeklyRate: new Prisma.Decimal(980),
          baseMonthlyRate: new Prisma.Decimal(3920),
          bondAmount: new Prisma.Decimal(1500),
          onlinePaymentStrategy: "PERCENT" as const,
          bookingFeeFlat: null,
          bookingFeePercent: new Prisma.Decimal(50),
          // Deliberately null so the "isLongTerm" branch is not taken on a
          // 10-day rental — keeps the strategy path testable in isolation.
          longTermMinDays: null,
          longTermDefaultFrequency: "WEEKLY" as const,
        })),
      },
      vehicle: {
        findUnique: vi.fn(async () => ({
          make: "Ducati",
          model: "Monster 659",
          baseRateOverride: null,
          basePeriodHoursOverride: null,
          modelId: "model-ducati",
          catalogueModel: {
            baseRate: new Prisma.Decimal(299),
            basePeriodHours: "H24" as const,
          },
        })),
      },
      season: { findMany: vi.fn(async () => []) },
      addon: { findMany: vi.fn(async () => []) },
      insuranceOption: { findUnique: vi.fn(async () => null) },
      discount: { findUnique: vi.fn(async () => null) },
      oneWayFee: { findUnique: vi.fn(async () => null) },
      pricingTier: {
        findMany: vi.fn(async ({ where }: { where: { categoryId?: string; modelId?: string; vehicleId?: string } }) =>
          where.modelId === "model-ducati" ? DUCATI_LADDER : [],
        ),
      },
      systemSetting: {
        findMany: vi.fn(async () =>
          opts.depositBasis
            ? [{ key: "pricing.depositBasis", value: opts.depositBasis }]
            : [],
        ),
      },
    } as unknown as Parameters<typeof quote>[0];
  }

  test("Ducati 10-day with WEEK1 (no extras): pay-now = 50% × $496 = $248", async () => {
    const q = await quote(ducatiQuoteFake({ depositBasis: "WEEK1" }), {
      categoryId: "cat-ur",
      vehicleId: "veh-ducati",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-11T10:00:00+10:00"), // 10 days
    });
    expect(q.durationDays).toBe(10);
    // 10 days falls in 7-13 tier → pro-rata: $496 × 10/7 = $708.57
    expect(q.totalAmount).toBeCloseTo((496 / 7) * 10, 2);
    // Deposit basis: week 1 (= 7 days) base = $496 × 7/7 = $496.
    // 50% × $496 = $248.
    expect(q.payOnlineAmount).toBeCloseTo(248, 2);
    expect(q.remainderDueAtPickup).toBeCloseTo(q.totalAmount - 248, 2);
    expect(q.bondAmount).toBeCloseTo(1500, 2);
  });

  test("Ducati 10-day with WEEK1 + addons + insurance + delivery: deposit rolls them all in", async () => {
    // Pro-rata base = $496 × 10/7 = $708.57
    // + $50 helmet + $30 lock + $30 phone mount + $120 insurance + $149 delivery
    // = $1,087.57 total
    // Deposit = 50% × $496 (week 1) + $50 + $30 + $30 + $120 + $149 = $627.
    const fake = ducatiQuoteFake({ depositBasis: "WEEK1" });
    (fake as unknown as { addon: { findMany: unknown } }).addon = {
      findMany: vi.fn(async () => [
        { id: "helmet", name: "Helmet", dailyRate: null, flatRate: new Prisma.Decimal(50), isPerDay: false },
        { id: "lock",   name: "Lock & chain", dailyRate: null, flatRate: new Prisma.Decimal(30), isPerDay: false },
        { id: "phone",  name: "Phone mount", dailyRate: null, flatRate: new Prisma.Decimal(30), isPerDay: false },
      ]),
    };
    (fake as unknown as { insuranceOption: { findUnique: unknown } }).insuranceOption = {
      findUnique: vi.fn(async () => ({
        id: "ins-std",
        name: "Standard",
        dailyRate: new Prisma.Decimal(12),
        excessAmount: new Prisma.Decimal(500),
      })),
    };

    const q = await quote(fake, {
      categoryId: "cat-ur",
      vehicleId: "veh-ducati",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-11T10:00:00+10:00"),
      addons: [
        { addonId: "helmet", quantity: 1 },
        { addonId: "lock", quantity: 1 },
        { addonId: "phone", quantity: 1 },
      ],
      insuranceOptionId: "ins-std",
      deliveryFee: 149,
    });

    const baseRental = (496 / 7) * 10;
    expect(q.totalAmount).toBeCloseTo(baseRental + 50 + 30 + 30 + 120 + 149, 2);
    expect(q.payOnlineAmount).toBeCloseTo(248 + 50 + 30 + 30 + 120 + 149, 2); // $627
    expect(q.remainderDueAtPickup).toBeCloseTo(q.totalAmount - q.payOnlineAmount, 2);

    // Breakdown lists every component.
    const labels = q.payOnlineBreakdown.map((b) => b.label);
    expect(labels.some((l) => /deposit \(50%/i.test(l))).toBe(true);
    expect(labels).toContain("Helmet");
    expect(labels).toContain("Lock & chain");
    expect(labels).toContain("Phone mount");
    expect(labels.some((l) => /standard insurance/i.test(l))).toBe(true);
    expect(labels).toContain("Delivery");

    const itemSum = q.payOnlineBreakdown.reduce((acc, b) => acc + b.amount, 0);
    expect(itemSum).toBeCloseTo(q.payOnlineAmount, 2);
  });

  test("Ducati 10-day with TOTAL basis: pay-now = 50% × total", async () => {
    const q = await quote(ducatiQuoteFake({ depositBasis: "TOTAL" }), {
      categoryId: "cat-ur",
      vehicleId: "veh-ducati",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-11T10:00:00+10:00"),
    });
    // Without the WEEK1 lever the deposit reverts to "% of total".
    expect(q.payOnlineAmount).toBeCloseTo(q.totalAmount * 0.5, 2);
  });

  test("Short rental (3 days) with WEEK1: deposit cap kicks in — never exceeds total", async () => {
    // 3 days falls below all PER_WEEK tiers, so hits the FLAT path:
    // $299 × 3 = $897. Week 1 (= min(3, 7) = 3 days) also computes to
    // $897. 50% × $897 = $448.50.
    const q = await quote(ducatiQuoteFake({ depositBasis: "WEEK1" }), {
      categoryId: "cat-ur",
      vehicleId: "veh-ducati",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-04T10:00:00+10:00"), // 3 days
    });
    expect(q.totalAmount).toBeCloseTo(299 * 3, 2);
    expect(q.payOnlineAmount).toBeCloseTo(299 * 3 * 0.5, 2);
    expect(q.payOnlineAmount).toBeLessThanOrEqual(q.totalAmount);
  });
});

describe("payOnlineBreakdown contents", () => {
  function fakeWithStrategy(opts: {
    strategy: "FULL" | "ZERO" | "FLAT" | "PERCENT";
    bookingFeePercent?: number;
    bookingFeeFlat?: number;
    depositBasis?: "TOTAL" | "WEEK1";
  }) {
    return {
      vehicleCategory: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cat1",
          name: "BMW R1250 GS",
          baseDailyRate: new Prisma.Decimal(500),
          baseWeeklyRate: new Prisma.Decimal(3000),
          baseMonthlyRate: new Prisma.Decimal(12000),
          bondAmount: new Prisma.Decimal(2000),
          onlinePaymentStrategy: opts.strategy,
          bookingFeeFlat:
            opts.bookingFeeFlat != null ? new Prisma.Decimal(opts.bookingFeeFlat) : null,
          bookingFeePercent:
            opts.bookingFeePercent != null ? new Prisma.Decimal(opts.bookingFeePercent) : null,
          longTermMinDays: null,
          longTermDefaultFrequency: "WEEKLY" as const,
        })),
      },
      season: { findMany: vi.fn(async () => []) },
      addon: { findMany: vi.fn(async () => []) },
      insuranceOption: { findUnique: vi.fn(async () => null) },
      discount: { findUnique: vi.fn(async () => null) },
      oneWayFee: { findUnique: vi.fn(async () => null) },
      pricingTier: { findMany: vi.fn(async () => []) },
      systemSetting: {
        findMany: vi.fn(async () =>
          opts.depositBasis
            ? [{ key: "pricing.depositBasis", value: opts.depositBasis }]
            : [],
        ),
      },
    } as unknown as Parameters<typeof quote>[0];
  }

  test("FULL strategy: breakdown describes the full rental total", async () => {
    const q = await quote(fakeWithStrategy({ strategy: "FULL" }), {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-08T10:00:00+10:00"), // 7 days
    });
    expect(q.payOnlineBreakdown).toHaveLength(1);
    expect(q.payOnlineBreakdown[0]!.label).toMatch(/full rental/i);
    expect(q.payOnlineBreakdown[0]!.amount).toBeCloseTo(q.payOnlineAmount, 2);
  });

  test("PERCENT/WEEK1 strategy: breakdown shows the formula", async () => {
    const q = await quote(
      fakeWithStrategy({ strategy: "PERCENT", bookingFeePercent: 50, depositBasis: "WEEK1" }),
      {
        categoryId: "cat1",
        pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
        returnDateTime: new Date("2026-06-11T10:00:00+10:00"), // 10 days
      },
    );
    expect(q.payOnlineBreakdown.length).toBeGreaterThanOrEqual(1);
    expect(q.payOnlineBreakdown[0]!.label).toMatch(/50%.*first[- ]week/i);
    expect(q.payOnlineBreakdown[0]!.detail).toMatch(/50%/);
    expect(q.payOnlineBreakdown[0]!.detail).toMatch(/first[- ]week/i);
  });

  test("PERCENT/TOTAL (legacy) strategy: breakdown reads 'of rental total'", async () => {
    const q = await quote(
      fakeWithStrategy({ strategy: "PERCENT", bookingFeePercent: 30 }),
      {
        categoryId: "cat1",
        pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
        returnDateTime: new Date("2026-06-11T10:00:00+10:00"),
      },
    );
    expect(q.payOnlineBreakdown[0]!.label).toMatch(/30%.*rental total/i);
  });

  test("ZERO strategy: amount=0 + 'no deposit' label", async () => {
    const q = await quote(fakeWithStrategy({ strategy: "ZERO" }), {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
      returnDateTime: new Date("2026-06-08T10:00:00+10:00"),
    });
    expect(q.payOnlineAmount).toBe(0);
    expect(q.payOnlineBreakdown[0]!.amount).toBe(0);
    expect(q.payOnlineBreakdown[0]!.label).toMatch(/no deposit/i);
  });

  test("vehicleId surfaces the model name in the base line item", async () => {
    const q = await quote(
      {
        vehicleCategory: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "cat1",
            name: "Unrestricted Motorcycle",
            baseDailyRate: new Prisma.Decimal(140),
            baseWeeklyRate: new Prisma.Decimal(980),
            baseMonthlyRate: new Prisma.Decimal(3920),
            bondAmount: new Prisma.Decimal(1500),
            onlinePaymentStrategy: "FULL" as const,
            bookingFeeFlat: null,
            bookingFeePercent: null,
            longTermMinDays: null,
            longTermDefaultFrequency: "WEEKLY" as const,
          })),
        },
        vehicle: {
          findUnique: vi.fn(async () => ({
            make: "Ducati",
            model: "Monster 659",
            baseRateOverride: null,
            basePeriodHoursOverride: null,
            modelId: null,
            catalogueModel: null,
          })),
        },
        season: { findMany: vi.fn(async () => []) },
        addon: { findMany: vi.fn(async () => []) },
        insuranceOption: { findUnique: vi.fn(async () => null) },
        discount: { findUnique: vi.fn(async () => null) },
        oneWayFee: { findUnique: vi.fn(async () => null) },
        pricingTier: { findMany: vi.fn(async () => []) },
      } as unknown as Parameters<typeof quote>[0],
      {
        categoryId: "cat1",
        vehicleId: "veh-ducati",
        pickupDateTime: new Date("2026-06-01T10:00:00+10:00"),
        returnDateTime: new Date("2026-06-08T10:00:00+10:00"),
      },
    );
    const base = q.lineItems[0]!;
    expect(base.label).toMatch(/Ducati Monster 659/);
    expect(base.label).not.toMatch(/Unrestricted Motorcycle/);
  });
});

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
