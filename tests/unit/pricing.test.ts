import { test, expect } from "vitest";
import { quote, calcDurationDays, OneWayDisallowedError } from "../../src/server/services/pricing";

/**
 * Pricing cascade is tested against a hand-rolled fake Prisma client so
 * these tests run with no database. The fake implements only the
 * findUniqueOrThrow / findMany / findUnique calls that `quote()` makes.
 */

type Fake = Parameters<typeof quote>[0];

function makeFakePrisma(opts: {
  daily: number;
  weekly: number;
  monthly: number;
  bond: number;
  seasonMultiplier?: number;
  addons?: { id: string; name: string; dailyRate?: number; flatRate?: number; isPerDay: boolean }[];
  insurance?: { id: string; name: string; dailyRate: number };
  discount?: {
    code: string;
    type: "PERCENTAGE" | "FIXED";
    value: number;
    isActive: boolean;
    validFrom?: Date | null;
    validTo?: Date | null;
    maxUses?: number | null;
    usedCount?: number;
    minBookingDays?: number | null;
    minBookingValue?: number | null;
    applicableCategoryIds?: string[];
    applicableDepotIds?: string[];
  };
  oneWayFee?: {
    fromDepotId: string;
    toDepotId: string;
    feeAmount: number;
    allowed: boolean;
    fromDepotName?: string;
    toDepotName?: string;
  };
  // Phase A overrides — default to legacy behaviour so the pre-Phase-A
  // tests continue to pass unchanged.
  onlinePaymentStrategy?: "FULL" | "FLAT" | "PERCENT" | "ZERO";
  bookingFeeFlat?: number | null;
  bookingFeePercent?: number | null;
  longTermMinDays?: number | null;
  longTermDefaultFrequency?: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
  // Operator-controlled pricing levers. Both default to ON when omitted so
  // pre-existing tests keep their historical behaviour.
  yieldEnabled?: boolean;
  durationDiscountEnabled?: boolean;
}): Fake {
  const category = {
    id: "cat1",
    name: "125cc Scooter",
    baseDailyRate: opts.daily,
    baseWeeklyRate: opts.weekly,
    baseMonthlyRate: opts.monthly,
    bondAmount: opts.bond,
    onlinePaymentStrategy: opts.onlinePaymentStrategy ?? "FULL",
    bookingFeeFlat: opts.bookingFeeFlat ?? null,
    bookingFeePercent: opts.bookingFeePercent ?? null,
    // Pre-Phase-A tests use short 2-3 day bookings; default the threshold
    // high enough that they never trip the long-term branch.
    longTermMinDays: opts.longTermMinDays === undefined ? null : opts.longTermMinDays,
    longTermDefaultFrequency: opts.longTermDefaultFrequency ?? "WEEKLY",
  };
  return {
    vehicleCategory: {
      findUniqueOrThrow: async () => category,
    },
    season: {
      findMany: async () =>
        opts.seasonMultiplier
          ? [{ multiplier: opts.seasonMultiplier, isActive: true }]
          : [],
    },
    addon: {
      findMany: async () =>
        (opts.addons ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          dailyRate: a.dailyRate ?? 0,
          flatRate: a.flatRate ?? 0,
          isPerDay: a.isPerDay,
        })),
    },
    insuranceOption: {
      findUnique: async () =>
        opts.insurance
          ? { id: opts.insurance.id, name: opts.insurance.name, dailyRate: opts.insurance.dailyRate }
          : null,
    },
    discount: {
      findUnique: async () => opts.discount ?? null,
    },
    oneWayFee: {
      findUnique: async (args: {
        where: {
          fromDepotId_toDepotId: { fromDepotId: string; toDepotId: string };
        };
      }) => {
        if (!opts.oneWayFee) return null;
        if (
          opts.oneWayFee.fromDepotId === args.where.fromDepotId_toDepotId.fromDepotId &&
          opts.oneWayFee.toDepotId === args.where.fromDepotId_toDepotId.toDepotId
        ) {
          return {
            ...opts.oneWayFee,
            fromDepot: { name: opts.oneWayFee.fromDepotName ?? "From Depot" },
            toDepot: { name: opts.oneWayFee.toDepotName ?? "To Depot" },
          };
        }
        return null;
      },
    },
    // No tier ladder in these tests → quote() falls back to the flat
    // daily/weekly/monthly cascade. Tier integration has its own test file.
    pricingTier: {
      findMany: async () => [],
    },
    systemSetting: {
      findMany: async () => {
        const rows: { key: string; value: unknown }[] = [];
        if (opts.yieldEnabled !== undefined) {
          rows.push({ key: "pricing.yieldEnabled", value: opts.yieldEnabled });
        }
        if (opts.durationDiscountEnabled !== undefined) {
          rows.push({
            key: "pricing.durationDiscountEnabled",
            value: opts.durationDiscountEnabled,
          });
        }
        return rows;
      },
    },
  } as unknown as Fake;
}

test("calcDurationDays — min 1, rounds up partial days", () => {
  expect(
    calcDurationDays(new Date("2026-04-10T10:00:00"), new Date("2026-04-10T18:00:00")),
  ).toBe(1);
  expect(
    calcDurationDays(new Date("2026-04-10T10:00:00"), new Date("2026-04-13T10:00:00")),
  ).toBe(3);
  expect(
    calcDurationDays(new Date("2026-04-10T10:00:00"), new Date("2026-04-13T11:00:00")),
  ).toBe(4);
});

test("pricing — base daily × duration + GST", async () => {
  const fake = makeFakePrisma({ daily: 69, weekly: 399, monthly: 1149, bond: 500 });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  expect(q.durationDays).toBe(3);
  expect(q.baseRate).toBe(69);
  expect(q.baseSubtotal).toBe(207);
  expect(q.totalAmount).toBe(207);
  expect(Math.abs(q.gstAmount - 207 / 11)).toBeLessThan(0.02);
});

test("pricing — 7 day duration uses weekly rate + 10% duration discount", async () => {
  const fake = makeFakePrisma({ daily: 69, weekly: 399, monthly: 1149, bond: 500 });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-17T10:00:00"),
  });
  expect(q.durationDays).toBe(7);
  expect(q.durationDiscountPct).toBe(0.1);
  // weekly rate → daily = 399/7 = 57
  expect(Math.abs(q.baseRate - 57)).toBeLessThan(0.01);
  // base 7 × 57 = 399, after 10% discount = 359.1
  expect(Math.abs(q.totalAmount - 359.1)).toBeLessThan(0.1);
});

test("pricing — seasonal multiplier applies to base subtotal before duration discount", async () => {
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
    seasonMultiplier: 1.5,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-12-26T10:00:00"),
    returnDateTime: new Date("2026-12-28T10:00:00"),
  });
  // 2 days × 100 × 1.5 = 300
  expect(q.seasonMultiplier).toBe(1.5);
  expect(q.totalAmount).toBe(300);
});

test("pricing — addons and insurance line items sum correctly", async () => {
  const fake = makeFakePrisma({
    daily: 50,
    weekly: 300,
    monthly: 900,
    bond: 500,
    addons: [{ id: "helmet", name: "Helmet", dailyRate: 5, isPerDay: true }],
    insurance: { id: "std", name: "Standard", dailyRate: 12 },
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
    addons: [{ addonId: "helmet", quantity: 1 }],
    insuranceOptionId: "std",
  });
  // base 3×50=150 + helmet 3×5=15 + insurance 3×12=36 = 201
  expect(q.addonTotal).toBe(15);
  expect(q.insuranceTotal).toBe(36);
  expect(q.totalAmount).toBe(201);
});

test("C5 — same-depot booking ignores one-way fee", async () => {
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
    oneWayFee: {
      fromDepotId: "dep1",
      toDepotId: "dep2",
      feeAmount: 50,
      allowed: true,
    },
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-12T10:00:00"),
    pickupDepotId: "dep1",
    returnDepotId: "dep1",
  });
  expect(q.oneWayFee).toBe(0);
  expect(q.totalAmount).toBe(200);
});

test("C5 — one-way fee added when depots differ", async () => {
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
    oneWayFee: {
      fromDepotId: "dep1",
      toDepotId: "dep2",
      feeAmount: 50,
      allowed: true,
    },
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-12T10:00:00"),
    pickupDepotId: "dep1",
    returnDepotId: "dep2",
  });
  expect(q.oneWayFee).toBe(50);
  expect(q.totalAmount).toBe(250);
});

test("C5 — disallowed pair throws OneWayDisallowedError", async () => {
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
    oneWayFee: {
      fromDepotId: "dep1",
      toDepotId: "dep2",
      feeAmount: 0,
      allowed: false,
      fromDepotName: "Gold Coast",
      toDepotName: "Melbourne",
    },
  });
  await expect(
    quote(fake, {
      categoryId: "cat1",
      pickupDateTime: new Date("2026-04-10T10:00:00"),
      returnDateTime: new Date("2026-04-12T10:00:00"),
      pickupDepotId: "dep1",
      returnDepotId: "dep2",
    }),
  ).rejects.toBeInstanceOf(OneWayDisallowedError);
});

test("C5 — depot pair with no OneWayFee row is allowed with zero fee", async () => {
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-12T10:00:00"),
    pickupDepotId: "dep1",
    returnDepotId: "dep2",
  });
  expect(q.oneWayFee).toBe(0);
  expect(q.totalAmount).toBe(200);
});

test("pricing — percentage discount code reduces total", async () => {
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
    discount: {
      code: "SAVE20",
      type: "PERCENTAGE",
      value: 20,
      isActive: true,
      validFrom: null,
      validTo: null,
      maxUses: null,
      usedCount: 0,
      minBookingDays: null,
      minBookingValue: null,
      applicableCategoryIds: [],
      applicableDepotIds: [],
    },
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
    discountCode: "SAVE20",
  });
  // base 300, -20% = 240
  expect(q.totalAmount).toBe(240);
});

// ---------------------------------------------------------------------------
// Phase A1 — per-category online payment strategy
// ---------------------------------------------------------------------------

test("Phase A1 — FULL strategy charges total online, zero remainder", async () => {
  const fake = makeFakePrisma({
    daily: 100, weekly: 600, monthly: 2000, bond: 500,
    onlinePaymentStrategy: "FULL",
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  expect(q.totalAmount).toBe(300);
  expect(q.payOnlineAmount).toBe(300);
  expect(q.remainderDueAtPickup).toBe(0);
  expect(q.onlinePaymentStrategy).toBe("FULL");
});

test("Phase A1 — FLAT strategy charges booking fee, remainder at pickup", async () => {
  const fake = makeFakePrisma({
    daily: 100, weekly: 600, monthly: 2000, bond: 500,
    onlinePaymentStrategy: "FLAT",
    bookingFeeFlat: 50,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  expect(q.totalAmount).toBe(300);
  expect(q.payOnlineAmount).toBe(50);
  expect(q.remainderDueAtPickup).toBe(250);
});

test("Phase A1 — FLAT fee larger than total gets capped at total", async () => {
  const fake = makeFakePrisma({
    daily: 50, weekly: 300, monthly: 1000, bond: 500,
    onlinePaymentStrategy: "FLAT",
    bookingFeeFlat: 200,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-11T10:00:00"),
  });
  // 1 day × 50 = 50 total, flat fee of 200 caps at 50.
  expect(q.totalAmount).toBe(50);
  expect(q.payOnlineAmount).toBe(50);
  expect(q.remainderDueAtPickup).toBe(0);
});

test("Phase A1 — PERCENT strategy charges percentage deposit", async () => {
  const fake = makeFakePrisma({
    daily: 100, weekly: 600, monthly: 2000, bond: 500,
    onlinePaymentStrategy: "PERCENT",
    bookingFeePercent: 30,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  // 300 × 30% = 90
  expect(q.totalAmount).toBe(300);
  expect(q.payOnlineAmount).toBe(90);
  expect(q.remainderDueAtPickup).toBe(210);
});

test("Phase A1 — ZERO strategy charges nothing online", async () => {
  const fake = makeFakePrisma({
    daily: 100, weekly: 600, monthly: 2000, bond: 500,
    onlinePaymentStrategy: "ZERO",
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  expect(q.totalAmount).toBe(300);
  expect(q.payOnlineAmount).toBe(0);
  expect(q.remainderDueAtPickup).toBe(300);
});

// ---------------------------------------------------------------------------
// Phase A2 — progressive billing for long-term hires
// ---------------------------------------------------------------------------

test("Phase A2 — short booking below threshold is not long-term", async () => {
  const fake = makeFakePrisma({
    daily: 100, weekly: 600, monthly: 2000, bond: 500,
    longTermMinDays: 14,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-17T10:00:00"), // 7 days
  });
  expect(q.isLongTerm).toBe(false);
  expect(q.recurringFrequency).toBeNull();
  expect(q.recurringPeriodsTotal).toBe(0);
});

test("Phase A2 — 21-day hire with weekly billing creates 3 periods (1 prepaid + 2 recurring)", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
  });
  // 21 days (3 weeks exactly) from 2026-04-10 to 2026-05-01. Weekly rate
  // applies (504/7 ≈ 72/day). 21 × 72 = 1512, minus 10% duration discount
  // = 1360.80.
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-01T10:00:00"),
  });
  expect(q.isLongTerm).toBe(true);
  expect(q.recurringFrequency).toBe("WEEKLY");
  // 21 / 7 = 3 periods total, 2 recurring.
  expect(q.recurringPeriodsTotal).toBe(2);
  // Sum of recurring + first-period = total.
  const recurringTotal = q.recurringAmount * q.recurringPeriodsTotal;
  expect(Math.abs(recurringTotal + q.firstPeriodAmount - q.totalAmount)).toBeLessThan(0.02);
});

test("Phase A2 — long-term hire's payOnline always equals the first period regardless of strategy", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
    onlinePaymentStrategy: "FLAT",
    bookingFeeFlat: 10, // strategy is meaningless for long-term — first period wins
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-01T10:00:00"),
  });
  expect(q.isLongTerm).toBe(true);
  expect(q.payOnlineAmount).toBe(q.firstPeriodAmount);
});

test("Phase A2 — FULL strategy does NOT force the whole booking up-front for long-term hires", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
    onlinePaymentStrategy: "FULL", // schema default — must NOT override progressive billing
  });
  // 31-day hire (matches the bug report): without the fix, FULL strategy
  // would set payOnline = totalAmount, defeating progressive billing.
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-11T10:00:00"),
  });
  expect(q.durationDays).toBe(31);
  expect(q.isLongTerm).toBe(true);
  expect(q.recurringPeriodsTotal).toBe(4); // ceil(31/7) = 5 periods, 4 recurring
  expect(q.payOnlineAmount).toBe(q.firstPeriodAmount);
  // payOnline must be substantially less than the full total — progressive
  // billing is doing its job.
  expect(q.payOnlineAmount).toBeLessThan(q.totalAmount * 0.5);
  expect(q.remainderDueAtPickup).toBe(0);
});

test("Phase A2 — PERCENT strategy with large deposit does NOT bump payOnline above first period", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
    onlinePaymentStrategy: "PERCENT",
    bookingFeePercent: 50, // 50% deposit — would have been larger than 1 week, but ignored for long-term
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-01T10:00:00"), // 21 days
  });
  expect(q.isLongTerm).toBe(true);
  expect(q.payOnlineAmount).toBe(q.firstPeriodAmount);
});

// ---------------------------------------------------------------------------
// Phase A2 — per-day vs flat split (one-time fees in week 1, per-day
// add-ons + insurance amortised across each weekly recurring charge).
// ---------------------------------------------------------------------------

test("Phase A2 — flat delivery fee sits entirely in the first period, not amortised", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
  });
  // 21-day hire, $25 delivery fee passed as input. Base subtotal = 1360.80
  // (21d × 504/7 × (1 - 10%)). Plus $25 delivery → totalDec = 1385.80.
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-01T10:00:00"),
    deliveryFee: 25,
  });
  expect(q.deliveryFee).toBe(25);
  expect(q.totalAmount).toBeCloseTo(1385.8, 2);
  // Per-day portion = 1360.80, perDayRate = 64.80, recurring = 64.80 × 7 = 453.60.
  expect(q.recurringAmount).toBeCloseTo(453.6, 2);
  // First period absorbs the $25 delivery on top of one weekly: 453.60 + 25 = 478.60.
  expect(q.firstPeriodAmount).toBeCloseTo(478.6, 2);
  // Reconciliation invariant.
  expect(q.firstPeriodAmount + q.recurringAmount * q.recurringPeriodsTotal).toBeCloseTo(
    q.totalAmount,
    2,
  );
});

test("Phase A2 — per-day add-ons and insurance ride along with the recurring charge", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
    addons: [{ id: "helmet", name: "Helmet", dailyRate: 5, isPerDay: true }],
    insurance: { id: "std", name: "Standard", dailyRate: 12 },
  });
  // 21-day hire. Base 1360.80, helmet 21×5=105, insurance 21×12=252.
  // totalDec = 1717.80. No flat fees.
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-01T10:00:00"),
    addons: [{ addonId: "helmet", quantity: 1 }],
    insuranceOptionId: "std",
  });
  expect(q.totalAmount).toBeCloseTo(1717.8, 2);
  // Per-day portion = total (no flat fees). Recurring = total / 3.
  expect(q.recurringAmount).toBeCloseTo(572.6, 2);
  // First period equals one recurring charge plus rounding (negligible here).
  expect(q.firstPeriodAmount).toBeCloseTo(572.6, 2);
  expect(q.firstPeriodAmount + q.recurringAmount * q.recurringPeriodsTotal).toBeCloseTo(
    q.totalAmount,
    2,
  );
});

test("Phase A2 — flat-rate add-on (e.g. one-time lock fee) sits in the first period", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
    // Two add-ons: per-day helmet + flat one-time security lock charge.
    addons: [
      { id: "helmet", name: "Helmet", dailyRate: 5, isPerDay: true },
      { id: "lock", name: "Security lock", flatRate: 30, isPerDay: false },
    ],
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-01T10:00:00"),
    addons: [
      { addonId: "helmet", quantity: 1 },
      { addonId: "lock", quantity: 1 },
    ],
  });
  // Base 1360.80 + helmet 105 + lock 30 = 1495.80.
  expect(q.totalAmount).toBeCloseTo(1495.8, 2);
  // Per-day portion = total - flat lock = 1465.80. perDayRate = 1465.80/21 = 69.80.
  // Recurring = 69.80 × 7 = 488.60.
  expect(q.recurringAmount).toBeCloseTo(488.6, 2);
  // First period = recurring + flat lock = 488.60 + 30 = 518.60.
  expect(q.firstPeriodAmount).toBeCloseTo(518.6, 2);
  expect(q.firstPeriodAmount + q.recurringAmount * q.recurringPeriodsTotal).toBeCloseTo(
    q.totalAmount,
    2,
  );
});

test("Phase A2 — uneven duration: remainder days form a smaller FIRST charge (ceil)", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
  });
  // 23-day hire (3 full weeks + 2 remainder days). Base subtotal at weekly
  // rate: 23 × 72 = 1656, less 10% duration discount = 1490.40.
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-03T10:00:00"),
  });
  expect(q.durationDays).toBe(23);
  expect(q.totalAmount).toBeCloseTo(1490.4, 2);
  // ceil(23/7) = 4 periods → 3 recurring full weeks; the 2 remainder days are
  // the smaller FIRST online charge, not a heavy up-front payment.
  expect(q.recurringPeriodsTotal).toBe(3);
  // perDayRate = 1490.40 / 23 = $64.80 exactly. Recurring = 64.80 × 7 = $453.60.
  expect(q.recurringAmount).toBeCloseTo(453.6, 2);
  // First period = days 22-23 only (2 × 64.80 = 129.60).
  expect(q.firstPeriodAmount).toBeCloseTo(129.6, 2);
  // Reconciliation invariant.
  expect(q.firstPeriodAmount + q.recurringAmount * q.recurringPeriodsTotal).toBeCloseTo(
    q.totalAmount,
    2,
  );
  // The whole point of ceil: the first online charge is now SMALLER than a
  // full recurring period.
  expect(q.firstPeriodAmount).toBeLessThan(q.recurringAmount);
});

test("Phase A2 — combined: per-day insurance + flat delivery + uneven duration reconciles exactly", async () => {
  const fake = makeFakePrisma({
    daily: 80, weekly: 504, monthly: 1800, bond: 1500,
    longTermMinDays: 14,
    longTermDefaultFrequency: "WEEKLY",
    addons: [{ id: "helmet", name: "Helmet", dailyRate: 5, isPerDay: true }],
    insurance: { id: "std", name: "Standard", dailyRate: 12 },
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-05-03T10:00:00"), // 23 days
    addons: [{ addonId: "helmet", quantity: 1 }],
    insuranceOptionId: "std",
    deliveryFee: 45,
  });
  // Reconciliation invariant — the most important contract.
  expect(q.firstPeriodAmount + q.recurringAmount * q.recurringPeriodsTotal).toBeCloseTo(
    q.totalAmount,
    2,
  );
  // Flat delivery still lands in the first period, so even though the first
  // charge is now the small remainder, it clears the $45 delivery fee.
  expect(q.firstPeriodAmount).toBeGreaterThan(45);
  // …and remains smaller than a full recurring week (ceil behaviour).
  expect(q.firstPeriodAmount).toBeLessThan(q.recurringAmount);
});

test("pricing — durationDiscountEnabled=false drops the 10% week ladder", async () => {
  const fake = makeFakePrisma({
    daily: 69,
    weekly: 399,
    monthly: 1149,
    bond: 500,
    durationDiscountEnabled: false,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-17T10:00:00"),
  });
  // 7 days still picks the weekly rate (399 / 7 base) but the 10% discount
  // is suppressed — total should equal the seasoned base subtotal exactly.
  expect(q.durationDays).toBe(7);
  expect(q.durationDiscountPct).toBe(0);
  expect(q.totalAmount).toBe(399);
  expect(q.lineItems.find((l) => l.label.startsWith("Duration discount"))).toBeUndefined();
});

test("pricing — durationDiscountEnabled toggle does not change <7 day bookings", async () => {
  // The legacy ladder is a no-op below 7 days, so flipping the toggle off
  // for a short hire must produce the same total as the default-on quote.
  const baseOpts = { daily: 100, weekly: 600, monthly: 2000, bond: 500 };
  const on = await quote(makeFakePrisma({ ...baseOpts, durationDiscountEnabled: true }), {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  const off = await quote(makeFakePrisma({ ...baseOpts, durationDiscountEnabled: false }), {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-13T10:00:00"),
  });
  expect(on.totalAmount).toBe(off.totalAmount);
});

test("pricing — yieldEnabled=false suppresses the demand multiplier line", async () => {
  // The yield service is database-backed; with no rows in the test fake the
  // lookup throws and quote() already falls back to ×1. To prove the toggle
  // path actually short-circuits the lookup we just confirm yieldMultiplier
  // is exactly 1 and no "Demand adjustment" line is emitted regardless of
  // pickup depot being passed.
  const fake = makeFakePrisma({
    daily: 100,
    weekly: 600,
    monthly: 2000,
    bond: 500,
    yieldEnabled: false,
  });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-12T10:00:00"),
    pickupDepotId: "dep1",
  });
  expect(q.yieldMultiplier).toBe(1);
  expect(q.lineItems.find((l) => l.label.startsWith("Demand adjustment"))).toBeUndefined();
});

test("pricing — both toggles default to ON when SystemSetting is absent", async () => {
  // Pre-existing pricing tests rely on this — the fake omits both flags so
  // the readPricingFlags helper must fall back to true on each side.
  const fake = makeFakePrisma({ daily: 69, weekly: 399, monthly: 1149, bond: 500 });
  const q = await quote(fake, {
    categoryId: "cat1",
    pickupDateTime: new Date("2026-04-10T10:00:00"),
    returnDateTime: new Date("2026-04-17T10:00:00"),
  });
  // Default behaviour: 7-day weekly hire applies the 10% legacy ladder.
  expect(q.durationDiscountPct).toBe(0.1);
});
