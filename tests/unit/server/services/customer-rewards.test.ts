import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// pointsPerDollar resolves to 1 in tests.
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  SETTING_DEFAULTS: { "loyalty.pointsPerDollar": 1 },
}));

import {
  computeNetCollected,
  computeCustomerRewards,
  CURRENT_BOOKING_STATUSES,
  POINTS_ELIGIBLE_TYPES,
} from "../../../../src/server/services/customer-rewards";

const d = (n: number) => new Prisma.Decimal(n);
type Pay = { type: string; status: string; amount: Prisma.Decimal };
const pay = (type: string, status: string, amount: number): Pay => ({ type, status, amount: d(amount) });

describe("computeNetCollected", () => {
  it("counts a simple succeeded deposit", () => {
    expect(computeNetCollected([pay("BOOKING_PAYMENT", "SUCCEEDED", 129)] as never).toNumber()).toBe(129);
  });

  it("nets a charged-then-refunded fee to zero (full refund: REFUNDED charge + REFUND row)", () => {
    // The real no-show ledger: deposit + captured extension kept; $50 no-show
    // fee charged then fully refunded; bond held then released.
    const net = computeNetCollected([
      pay("BOOKING_PAYMENT", "SUCCEEDED", 542.72),
      pay("EXTENSION", "SUCCEEDED", 854.97),
      pay("MANUAL_CHARGE", "REFUNDED", 50),
      pay("REFUND", "SUCCEEDED", 50),
      pay("BOND_HOLD", "SUCCEEDED", 1500),
      pay("BOND_RELEASE", "SUCCEEDED", 1500),
    ] as never);
    expect(net.toNumber()).toBeCloseTo(1397.69, 2);
  });

  it("handles a partial refund (PARTIALLY_REFUNDED charge stays at full + REFUND row)", () => {
    const net = computeNetCollected([
      pay("BOOKING_PAYMENT", "PARTIALLY_REFUNDED", 100),
      pay("REFUND", "SUCCEEDED", 30),
    ] as never);
    expect(net.toNumber()).toBe(70);
  });

  it("excludes bond holds/releases but counts a forfeited bond capture", () => {
    expect(
      computeNetCollected([
        pay("BOND_HOLD", "SUCCEEDED", 1500),
        pay("BOND_RELEASE", "SUCCEEDED", 1500),
      ] as never).toNumber(),
    ).toBe(0);
    expect(computeNetCollected([pay("BOND_CAPTURE", "SUCCEEDED", 200)] as never).toNumber()).toBe(200);
  });

  it("points-eligible total excludes penalty revenue but spend includes it", () => {
    const rows = [
      pay("BOOKING_PAYMENT", "SUCCEEDED", 129),
      pay("LATE_FEE", "SUCCEEDED", 2451),
      pay("DAMAGE_CHARGE", "SUCCEEDED", 195),
      pay("BOND_CAPTURE", "SUCCEEDED", 200),
    ] as never;
    expect(computeNetCollected(rows).toNumber()).toBe(2975); // all money drawn down
    expect(computeNetCollected(rows, POINTS_ELIGIBLE_TYPES).toNumber()).toBe(129); // hire only
  });

  it("does not let a refunded penalty reduce the points-eligible total", () => {
    const rows = [
      pay("BOOKING_PAYMENT", "SUCCEEDED", 500),
      pay("MANUAL_CHARGE", "REFUNDED", 50), // no-show fee, fully refunded
      pay("REFUND", "SUCCEEDED", 50),
    ] as never;
    expect(computeNetCollected(rows, POINTS_ELIGIBLE_TYPES).toNumber()).toBe(500);
  });

  it("does not let a PARTIAL refund of a non-points charge reduce points (linked)", () => {
    // Regression: a damage-fee partial refund (parentPaymentId → the damage
    // charge) must not erode points, but must still net against lifetime spend.
    const rows = [
      { id: "p1", type: "BOOKING_PAYMENT", status: "SUCCEEDED", amount: d(500), parentPaymentId: null },
      { id: "p2", type: "DAMAGE_CHARGE", status: "PARTIALLY_REFUNDED", amount: d(100), parentPaymentId: null },
      { id: "r1", type: "REFUND", status: "SUCCEEDED", amount: d(40), parentPaymentId: "p2" },
    ] as never;
    expect(computeNetCollected(rows, POINTS_ELIGIBLE_TYPES).toNumber()).toBe(500); // hire only, refund invisible
    expect(computeNetCollected(rows).toNumber()).toBe(560); // 500 + (100 − 40)
  });

  it("nets a linked partial refund of a points charge against both totals", () => {
    const rows = [
      { id: "p1", type: "BOOKING_PAYMENT", status: "PARTIALLY_REFUNDED", amount: d(200), parentPaymentId: null },
      { id: "r1", type: "REFUND", status: "SUCCEEDED", amount: d(50), parentPaymentId: "p1" },
    ] as never;
    expect(computeNetCollected(rows, POINTS_ELIGIBLE_TYPES).toNumber()).toBe(150);
    expect(computeNetCollected(rows).toNumber()).toBe(150);
  });

  it("nets a linked full refund to zero without double-subtracting", () => {
    const rows = [
      { id: "p1", type: "MANUAL_CHARGE", status: "REFUNDED", amount: d(50), parentPaymentId: null },
      { id: "r1", type: "REFUND", status: "SUCCEEDED", amount: d(50), parentPaymentId: "p1" },
    ] as never;
    expect(computeNetCollected(rows).toNumber()).toBe(0);
  });

  it("clamps over-refund to zero", () => {
    expect(
      computeNetCollected([
        pay("BOOKING_PAYMENT", "SUCCEEDED", 50),
        pay("REFUND", "SUCCEEDED", 80),
      ] as never).toNumber(),
    ).toBe(0);
  });
});

function makeDb(opts: {
  bookings: { id: string; status: string; pickupDateTime: Date | null; actualReturnDateTime: Date | null; createdAt: Date }[];
  payments: Pay[];
  ledger: { direction: string; points: number; reason: string }[];
}) {
  return {
    booking: { findMany: vi.fn(async () => opts.bookings) },
    payment: { findMany: vi.fn(async () => opts.payments) },
    loyaltyLedger: { findMany: vi.fn(async () => opts.ledger) },
    customerProfile: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
}

describe("computeCustomerRewards", () => {
  it("derives spend from net collected, counts completed+current, points incl. bonuses", async () => {
    const t0 = new Date("2026-04-29T05:30:00Z");
    const db = makeDb({
      bookings: [
        { id: "b-done", status: "COMPLETED", pickupDateTime: t0, actualReturnDateTime: t0, createdAt: t0 },
        { id: "b-noshow", status: "NO_SHOW", pickupDateTime: t0, actualReturnDateTime: null, createdAt: t0 },
        { id: "b-active", status: "ACTIVE", pickupDateTime: t0, actualReturnDateTime: null, createdAt: t0 },
        { id: "b-cancelled", status: "CANCELLED", pickupDateTime: t0, actualReturnDateTime: null, createdAt: t0 },
      ],
      // Completed: $129 hire + $2451 late fee + $195 damage (penalties).
      // No-show: $542.72 deposit + $854.97 extension; $50 fee refunded.
      payments: [
        pay("BOOKING_PAYMENT", "SUCCEEDED", 129),
        pay("LATE_FEE", "SUCCEEDED", 2451),
        pay("DAMAGE_CHARGE", "SUCCEEDED", 195),
        pay("BOOKING_PAYMENT", "SUCCEEDED", 542.72),
        pay("EXTENSION", "SUCCEEDED", 854.97),
        pay("MANUAL_CHARGE", "REFUNDED", 50),
        pay("REFUND", "SUCCEEDED", 50),
      ],
      ledger: [
        { direction: "EARN", points: 129, reason: "Booking SCT-20260428-5885" }, // legacy spend → ignored
        { direction: "BURN", points: 100, reason: "Burn on booking" },
      ],
    });

    const snap = await computeCustomerRewards(db as never, "cust1");

    // Spend reflects ALL money drawn down (incl. $2646 penalties).
    expect(snap.totalSpend.toNumber()).toBeCloseTo(4172.69, 2);
    expect(snap.completedBookings).toBe(1);
    expect(snap.totalBookings).toBe(2); // completed + active; no-show & cancelled excluded
    // Points only on hire spend: floor(129 + 542.72 + 854.97) = 1526.
    // Penalties ($2646) earn nothing → stays SILVER, not GOLD.
    expect(snap.lifetimePoints).toBe(1526);
    expect(snap.loyaltyPoints).toBe(1426); // minus 100 burned
    expect(snap.loyaltyTier).toBe("SILVER");
  });

  it("treats RETURNED as a current (counted) booking", () => {
    expect(CURRENT_BOOKING_STATUSES).toContain("RETURNED");
  });
});
