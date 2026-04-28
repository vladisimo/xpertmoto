import { test, expect, describe } from "vitest";
import { quoteExtension } from "../../src/server/services/pricing";

// Minimal fake prisma that just returns canned rows for the two tables
// `quoteExtension` reads (`vehicleCategory` and `season`). No schema.
function makeFakePrisma({
  category,
  seasons,
}: {
  category: {
    baseDailyRate: number;
    baseWeeklyRate: number;
    baseMonthlyRate: number;
    bondAmount: number;
  };
  seasons: { multiplier: number; startDate: Date; endDate: Date; isActive: boolean }[];
}) {
  return {
    vehicleCategory: {
      findUniqueOrThrow: async () => ({
        id: "cat1",
        name: "125cc Scooter",
        baseDailyRate: category.baseDailyRate,
        baseWeeklyRate: category.baseWeeklyRate,
        baseMonthlyRate: category.baseMonthlyRate,
        bondAmount: category.bondAmount,
      }),
    },
    season: {
      findMany: async (args: {
        where: { isActive: boolean; startDate: { lte: Date }; endDate: { gte: Date } };
      }) =>
        seasons
          .filter(
            (s) =>
              s.isActive &&
              s.startDate <= args.where.startDate.lte &&
              s.endDate >= args.where.endDate.gte,
          )
          .sort((a, b) => b.multiplier - a.multiplier),
    },
    // No tier ladder in these tests → quoteExtension falls back to the
    // legacy daily/weekly/monthly + duration-discount cascade.
    pricingTier: {
      findMany: async () => [],
    },
  } as unknown as Parameters<typeof quoteExtension>[0];
}

const defaultCategory = {
  baseDailyRate: 69,
  baseWeeklyRate: 399,
  baseMonthlyRate: 1149,
  bondAmount: 500,
};

describe("quoteExtension", () => {
  test("single day extension uses daily rate, no discount, no season", async () => {
    const prisma = makeFakePrisma({ category: defaultCategory, seasons: [] });
    const r = await quoteExtension(prisma, {
      categoryId: "cat1",
      oldReturnDateTime: new Date("2026-06-10T10:00:00Z"),
      newReturnDateTime: new Date("2026-06-11T10:00:00Z"),
    });
    expect(r.extensionDays).toBe(1);
    expect(r.baseRate).toBe(69);
    expect(r.seasonMultiplier).toBe(1);
    expect(r.durationDiscountPct).toBe(0);
    expect(r.totalAmount).toBe(69);
    expect(r.gstAmount).toBeCloseTo(6.27, 2);
  });

  test("8-day extension swaps to weekly rate and 10% discount tier", async () => {
    const prisma = makeFakePrisma({ category: defaultCategory, seasons: [] });
    const r = await quoteExtension(prisma, {
      categoryId: "cat1",
      oldReturnDateTime: new Date("2026-06-10T10:00:00Z"),
      newReturnDateTime: new Date("2026-06-18T10:00:00Z"),
    });
    expect(r.extensionDays).toBe(8);
    // weekly rate / 7
    expect(r.baseRate).toBeCloseTo(399 / 7, 2);
    expect(r.durationDiscountPct).toBe(0.1);
    const expected = +((399 / 7) * 8 * 0.9).toFixed(2);
    expect(r.totalAmount).toBe(expected);
  });

  test("season multiplier applied from the extension's window", async () => {
    const prisma = makeFakePrisma({
      category: defaultCategory,
      seasons: [
        {
          multiplier: 1.5,
          startDate: new Date("2026-12-20"),
          endDate: new Date("2027-01-10"),
          isActive: true,
        },
      ],
    });
    const r = await quoteExtension(prisma, {
      categoryId: "cat1",
      oldReturnDateTime: new Date("2026-12-22T10:00:00Z"),
      newReturnDateTime: new Date("2026-12-24T10:00:00Z"),
    });
    expect(r.seasonMultiplier).toBe(1.5);
    expect(r.totalAmount).toBe(+(69 * 2 * 1.5).toFixed(2));
  });

  test("includes per-day addons and insurance in the extension total", async () => {
    const prisma = makeFakePrisma({ category: defaultCategory, seasons: [] });
    const r = await quoteExtension(prisma, {
      categoryId: "cat1",
      oldReturnDateTime: new Date("2026-06-10T10:00:00Z"),
      newReturnDateTime: new Date("2026-06-13T10:00:00Z"),
      perDayAddons: [
        { unitPrice: 5, quantity: 2 }, // 2 helmets @ $5
        { unitPrice: 3, quantity: 1 }, // 1 phone mount @ $3
      ],
      perDayInsuranceRate: 12,
    });
    expect(r.extensionDays).toBe(3);
    // Base: 69 × 3 = 207. Addons: (10 + 3) × 3 = 39. Insurance: 12 × 3 = 36. Total 282.
    expect(r.addonExtension).toBe(39);
    expect(r.insuranceExtension).toBe(36);
    expect(r.totalAmount).toBe(282);
  });

  test("rejects a non-forward extension", async () => {
    const prisma = makeFakePrisma({ category: defaultCategory, seasons: [] });
    await expect(
      quoteExtension(prisma, {
        categoryId: "cat1",
        oldReturnDateTime: new Date("2026-06-10T10:00:00Z"),
        newReturnDateTime: new Date("2026-06-10T10:00:00Z"),
      }),
    ).rejects.toThrow(/forward/i);
  });
});
