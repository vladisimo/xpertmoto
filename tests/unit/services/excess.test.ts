import { beforeEach, describe, expect, it, vi } from "vitest";

// The setting fallback is the last rung of the ladder — pin it so the test
// doesn't depend on a live SystemSetting row.
const getSettingMock = vi.fn();
vi.mock("@/lib/settings", () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  SETTING_DEFAULTS: { "insurance.defaultExcessAmount": 3000 },
}));

import {
  applyExcessCap,
  getBookingExcess,
  getDamageLiabilityUsed,
} from "../../../src/server/services/excess";

type PrismaMock = {
  bookingInsurance: { findMany: ReturnType<typeof vi.fn> };
  insuranceOption: { findFirst: ReturnType<typeof vi.fn> };
  damageCharge: { findMany: ReturnType<typeof vi.fn> };
  payment: { findMany: ReturnType<typeof vi.fn> };
};

function makePrisma(over: {
  insuranceRows?: unknown[];
  defaultOption?: unknown;
  charges?: unknown[];
  payments?: unknown[][];
} = {}): PrismaMock {
  // payment.findMany is called twice (INC-% rows, then refunds); queue the
  // provided arrays in order.
  const paymentQueue = [...(over.payments ?? [[], []])];
  return {
    bookingInsurance: { findMany: vi.fn(async () => over.insuranceRows ?? []) },
    insuranceOption: { findFirst: vi.fn(async () => over.defaultOption ?? null) },
    damageCharge: { findMany: vi.fn(async () => over.charges ?? []) },
    payment: { findMany: vi.fn(async () => paymentQueue.shift() ?? []) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettingMock.mockResolvedValue(3000);
});

describe("getBookingExcess — fallback ladder", () => {
  it("takes the LOWEST excessAmountSnapshot across the booking's insurance rows", async () => {
    const prisma = makePrisma({
      insuranceRows: [
        { excessAmountSnapshot: 2000, insuranceOption: { name: "Basic", excessAmount: 2500 } },
        { excessAmountSnapshot: 500, insuranceOption: { name: "Premium", excessAmount: 900 } },
      ],
    });
    const out = await getBookingExcess(prisma as never, "b1");
    expect(out).toEqual({ excess: 500, source: "BOOKING_INSURANCE", tierName: "Premium" });
  });

  it("falls back to the option's live excessAmount for a row missing its snapshot", async () => {
    const prisma = makePrisma({
      insuranceRows: [
        { excessAmountSnapshot: null, insuranceOption: { name: "Basic", excessAmount: 1800 } },
      ],
    });
    const out = await getBookingExcess(prisma as never, "b1");
    expect(out).toEqual({ excess: 1800, source: "BOOKING_INSURANCE", tierName: "Basic" });
  });

  it("uses the active isDefault option when the booking has no insurance", async () => {
    const prisma = makePrisma({
      defaultOption: { name: "Standard", excessAmount: 2200 },
    });
    const out = await getBookingExcess(prisma as never, "b1");
    expect(out).toEqual({ excess: 2200, source: "DEFAULT_OPTION", tierName: "Standard" });
    expect(prisma.insuranceOption.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isDefault: true, isActive: true } }),
    );
  });

  it("no insurance and no default option → the insurance.defaultExcessAmount setting", async () => {
    getSettingMock.mockResolvedValue(4500);
    const prisma = makePrisma({});
    const out = await getBookingExcess(prisma as never, "b1");
    expect(out).toEqual({ excess: 4500, source: "SETTING", tierName: null });
  });
});

describe("getDamageLiabilityUsed — aggregation and dedupe", () => {
  it("sums CONFIRMED/CAPTURED damage charges plus unlinked INC-% payments, deduping linked ones", async () => {
    const prisma = makePrisma({
      charges: [
        { amount: 300, capturedPaymentId: "pay-inc-1" },
        { amount: 150, capturedPaymentId: null },
      ],
      payments: [
        // INC-% DAMAGE_CHARGE rows: pay-inc-1 is linked from a charge above
        // (already counted via the charge's amount) — must NOT double count.
        [
          { id: "pay-inc-1", amount: 300 },
          { id: "pay-inc-2", amount: 200 },
        ],
        // no refunds
        [],
      ],
    });
    const used = await getDamageLiabilityUsed(prisma as never, "b1");
    expect(used).toBe(650); // 300 + 150 + 200 (pay-inc-1 deduped)
  });

  it("nets out REFUND rows raised against damage-charge payments", async () => {
    const prisma = makePrisma({
      charges: [{ amount: 500, capturedPaymentId: "pay-dmg-1" }],
      payments: [
        [],
        [{ amount: 120 }], // refund against a DAMAGE_CHARGE parent
      ],
    });
    const used = await getDamageLiabilityUsed(prisma as never, "b1");
    expect(used).toBe(380);
  });

  it("floors at zero when refunds exceed recoveries", async () => {
    const prisma = makePrisma({
      charges: [{ amount: 100, capturedPaymentId: null }],
      payments: [[], [{ amount: 250 }]],
    });
    expect(await getDamageLiabilityUsed(prisma as never, "b1")).toBe(0);
  });
});

describe("applyExcessCap", () => {
  it("passes an in-cap charge through untouched", () => {
    expect(applyExcessCap({ proposed: 400, used: 100, excess: 1000 })).toEqual({
      chargeable: 400,
      cappedBy: 0,
      capRemaining: 900,
    });
  });

  it("clamps to the remaining headroom", () => {
    expect(applyExcessCap({ proposed: 800, used: 700, excess: 1000 })).toEqual({
      chargeable: 300,
      cappedBy: 500,
      capRemaining: 300,
    });
  });

  it("accumulates per-hire across sequential charges (finalise → close-out → incident)", () => {
    const excess = 1000;
    let used = 0;
    // Return-assessment standard line.
    const a = applyExcessCap({ proposed: 600, used, excess });
    used += a.chargeable;
    // Quote close-out later.
    const b = applyExcessCap({ proposed: 300, used, excess });
    used += b.chargeable;
    // Incident charge after that — only 100 of headroom left.
    const c = applyExcessCap({ proposed: 500, used, excess });
    expect(a.chargeable).toBe(600);
    expect(b.chargeable).toBe(300);
    expect(c).toEqual({ chargeable: 100, cappedBy: 400, capRemaining: 100 });
  });

  it("zeroes a charge once the cap is exhausted", () => {
    expect(applyExcessCap({ proposed: 250, used: 1200, excess: 1000 })).toEqual({
      chargeable: 0,
      cappedBy: 250,
      capRemaining: 0,
    });
  });

  it("voided incident lifts the cap but still reports headroom", () => {
    expect(applyExcessCap({ proposed: 5000, used: 900, excess: 1000, voided: true })).toEqual({
      chargeable: 5000,
      cappedBy: 0,
      capRemaining: 100,
    });
  });

  it("manager override lifts the cap for the single charge", () => {
    expect(
      applyExcessCap({ proposed: 2000, used: 1000, excess: 1000, managerOverride: true }),
    ).toEqual({ chargeable: 2000, cappedBy: 0, capRemaining: 0 });
  });
});
