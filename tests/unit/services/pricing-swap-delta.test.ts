import { describe, expect, test, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { quoteSwapDelta } from "@/server/services/pricing";

// quoteSwapDelta computes the pro-rata price difference for the remaining
// rental window at today's rates for the old vs new category. Addons and
// insurance are intentionally not re-quoted (v1 holds them frozen).

function makeCategory(overrides: {
  id: string;
  baseDailyRate: number;
  baseWeeklyRate?: number;
  baseMonthlyRate?: number;
}) {
  return {
    id: overrides.id,
    name: `Cat ${overrides.id}`,
    slug: overrides.id,
    baseDailyRate: new Prisma.Decimal(overrides.baseDailyRate),
    baseWeeklyRate: new Prisma.Decimal(
      overrides.baseWeeklyRate ?? overrides.baseDailyRate * 7,
    ),
    baseMonthlyRate: new Prisma.Decimal(
      overrides.baseMonthlyRate ?? overrides.baseDailyRate * 30,
    ),
    bondAmount: new Prisma.Decimal(500),
    minAge: 18,
    isActive: true,
  };
}

function makePrisma(
  categories: Record<string, ReturnType<typeof makeCategory>>,
  seasons: Array<{ multiplier: number }> = [],
) {
  return {
    vehicleCategory: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const cat = categories[where.id];
        if (!cat) throw new Error(`Missing category ${where.id}`);
        return cat;
      }),
    },
    season: {
      findMany: vi.fn(async () =>
        seasons.map((s) => ({ multiplier: new Prisma.Decimal(s.multiplier) })),
      ),
    },
    // No tier ladders in these tests → falls back to the flat rate cascade.
    pricingTier: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as Parameters<typeof quoteSwapDelta>[0];
}

describe("quoteSwapDelta", () => {
  const swapAt = new Date("2026-06-01T10:00:00+10:00");
  const returnAt = new Date("2026-06-04T10:00:00+10:00"); // 3 days remaining

  test("same category produces zero delta, direction NONE", async () => {
    const prisma = makePrisma({
      A: makeCategory({ id: "A", baseDailyRate: 50 }),
    });
    const q = await quoteSwapDelta(prisma, {
      oldCategoryId: "A",
      newCategoryId: "A",
      swapAt,
      returnDateTime: returnAt,
    });
    expect(q.deltaAmount).toBe(0);
    expect(q.direction).toBe("NONE");
  });

  test("upgrade to a higher daily rate → positive delta, direction CHARGE", async () => {
    const prisma = makePrisma({
      A: makeCategory({ id: "A", baseDailyRate: 50 }),
      B: makeCategory({ id: "B", baseDailyRate: 70 }),
    });
    const q = await quoteSwapDelta(prisma, {
      oldCategoryId: "A",
      newCategoryId: "B",
      swapAt,
      returnDateTime: returnAt,
    });
    // 3 days × ($70 − $50) = $60, no season, no duration discount at 3 days.
    expect(q.remainingDays).toBe(3);
    expect(q.deltaAmount).toBeCloseTo(60, 2);
    expect(q.direction).toBe("CHARGE");
    // GST 1/11 of 60 = 5.4545... round to cents.
    expect(q.gstAmount).toBeCloseTo(5.45, 2);
  });

  test("downgrade to a lower daily rate → negative delta, direction REFUND", async () => {
    const prisma = makePrisma({
      A: makeCategory({ id: "A", baseDailyRate: 70 }),
      B: makeCategory({ id: "B", baseDailyRate: 50 }),
    });
    const q = await quoteSwapDelta(prisma, {
      oldCategoryId: "A",
      newCategoryId: "B",
      swapAt,
      returnDateTime: returnAt,
    });
    expect(q.deltaAmount).toBeCloseTo(-60, 2);
    expect(q.direction).toBe("REFUND");
    expect(q.gstAmount).toBeCloseTo(5.45, 2);
  });

  test("season multiplier applied equally to both sides keeps delta proportional", async () => {
    const prisma = makePrisma(
      {
        A: makeCategory({ id: "A", baseDailyRate: 50 }),
        B: makeCategory({ id: "B", baseDailyRate: 70 }),
      },
      [{ multiplier: 1.5 }],
    );
    const q = await quoteSwapDelta(prisma, {
      oldCategoryId: "A",
      newCategoryId: "B",
      swapAt,
      returnDateTime: returnAt,
    });
    // 3 days × ($70 − $50) × 1.5 = $90
    expect(q.deltaAmount).toBeCloseTo(90, 2);
    expect(q.direction).toBe("CHARGE");
    expect(q.seasonMultiplier).toBe(1.5);
  });

  test("duration-discount bracket applies to both sides", async () => {
    // 7 days remaining triggers the 10% duration discount bracket.
    const prisma = makePrisma({
      A: makeCategory({ id: "A", baseDailyRate: 50, baseWeeklyRate: 280 }),
      B: makeCategory({ id: "B", baseDailyRate: 70, baseWeeklyRate: 420 }),
    });
    const weekLaterReturn = new Date("2026-06-08T10:00:00+10:00");
    const q = await quoteSwapDelta(prisma, {
      oldCategoryId: "A",
      newCategoryId: "B",
      swapAt,
      returnDateTime: weekLaterReturn,
    });
    expect(q.remainingDays).toBe(7);
    expect(q.durationDiscountPct).toBeCloseTo(0.1, 5);
    // New subtotal = 60 × 7 × 0.9 = 378 ($60/day at the weekly rate × 7 days × 90%)
    // Old subtotal = 40 × 7 × 0.9 = 252
    expect(q.oldRemainderAmount).toBeCloseTo(252, 2);
    expect(q.newRemainderAmount).toBeCloseTo(378, 2);
    expect(q.deltaAmount).toBeCloseTo(126, 2);
  });

  test("rejects returnDateTime <= swapAt with BAD_REQUEST", async () => {
    const prisma = makePrisma({
      A: makeCategory({ id: "A", baseDailyRate: 50 }),
    });
    await expect(
      quoteSwapDelta(prisma, {
        oldCategoryId: "A",
        newCategoryId: "A",
        swapAt,
        returnDateTime: swapAt,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
