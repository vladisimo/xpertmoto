import { describe, it, expect, vi } from "vitest";
import {
  applyCaptureToBalanceDue,
  isBalanceAffectingCharge,
  BALANCE_AFFECTING_CHARGE_TYPES,
} from "@/server/services/balance-due";

function makeDb(balanceDue: number | null, amountPaid = 0) {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue(
    balanceDue === null ? null : { balanceDue, amountPaid },
  );
  return { db: { booking: { findUnique, update } }, findUnique, update };
}

describe("isBalanceAffectingCharge", () => {
  it("treats ancillary charges as balance-affecting", () => {
    expect(isBalanceAffectingCharge("EXTENSION")).toBe(true);
    expect(isBalanceAffectingCharge("MANUAL_CHARGE")).toBe(true);
    expect(isBalanceAffectingCharge("LATE_FEE")).toBe(true);
  });

  it("excludes the deposit, bonds and refunds — they never enter balanceDue", () => {
    expect(isBalanceAffectingCharge("BOOKING_PAYMENT")).toBe(false);
    expect(isBalanceAffectingCharge("BOND_HOLD")).toBe(false);
    expect(isBalanceAffectingCharge("BOND_CAPTURE")).toBe(false);
    expect(isBalanceAffectingCharge("REFUND")).toBe(false);
    expect(isBalanceAffectingCharge("GIFT_CARD_PURCHASE")).toBe(false);
  });

  it("never lists BOOKING_PAYMENT in the affecting set", () => {
    expect(BALANCE_AFFECTING_CHARGE_TYPES).not.toContain("BOOKING_PAYMENT");
  });
});

describe("applyCaptureToBalanceDue", () => {
  it("decrements balanceDue by the captured amount and clamps nothing when funds remain", async () => {
    const { db, update } = makeDb(904.97, 100);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "EXTENSION",
      amount: 854.97,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: true, newBalanceDue: 50 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 50, amountPaid: 954.97 },
    });
  });

  it("clamps at zero — balanceDue can never go negative", async () => {
    const { db, update } = makeDb(854.97);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "EXTENSION",
      amount: 854.97,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: true, newBalanceDue: 0 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 0, amountPaid: 854.97 },
    });
  });

  it("mirrors the decrement onto amountPaid so collected money is reflected", async () => {
    const { db, update } = makeDb(700, 300);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "SUBSCRIPTION_CHARGE",
      amount: 85.5,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: true, newBalanceDue: 614.5 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 614.5, amountPaid: 385.5 },
    });
  });

  it("rounds to cents to avoid float drift", async () => {
    const { db } = makeDb(100.1);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "LATE_FEE",
      amount: 0.2,
      previousStatus: "PENDING",
    });
    expect(res.newBalanceDue).toBe(99.9);
  });

  it("skips the deposit (BOOKING_PAYMENT) — it was never added to balanceDue", async () => {
    const { db, findUnique, update } = makeDb(500);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "BOOKING_PAYMENT",
      amount: 500,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: false });
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("is idempotent: skips when the charge was already SUCCEEDED (webhook redelivery)", async () => {
    const { db, findUnique, update } = makeDb(854.97);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "EXTENSION",
      amount: 854.97,
      previousStatus: "SUCCEEDED",
    });
    expect(res).toEqual({ applied: false });
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("skips when there is no booking attached", async () => {
    const { db, findUnique } = makeDb(100);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: null,
      type: "EXTENSION",
      amount: 50,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: false });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("walks a long-term hire's balanceDue from R×N down to exactly 0 (F2 regression)", async () => {
    // Confirmation pre-loads balanceDue = recurringAmount × periodsTotal.
    // booking-billing enqueues each SUBSCRIPTION_CHARGE without touching
    // balanceDue; only the capture (here) decrements it. After N captures the
    // balance must reach exactly 0 and amountPaid must accumulate the full R×N.
    const R = 85.5;
    const N = 11;
    let balanceDue = +(R * N).toFixed(2); // 940.5
    let amountPaid = 120; // first period already collected at confirm
    const db = {
      booking: {
        findUnique: vi.fn(async () => ({ balanceDue, amountPaid })),
        update: vi.fn(async ({ data }: { data: { balanceDue: number; amountPaid: number } }) => {
          balanceDue = data.balanceDue;
          amountPaid = data.amountPaid;
          return {};
        }),
      },
    };

    for (let i = 0; i < N; i++) {
      const res = await applyCaptureToBalanceDue(db, {
        bookingId: "lt1",
        type: "SUBSCRIPTION_CHARGE",
        amount: R,
        previousStatus: "PENDING",
      });
      expect(res.applied).toBe(true);
    }

    expect(balanceDue).toBe(0);
    expect(amountPaid).toBe(+(120 + R * N).toFixed(2)); // 1060.5
  });

  it("skips when the booking row no longer exists", async () => {
    const { db, update } = makeDb(null);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "gone",
      type: "EXTENSION",
      amount: 50,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: false });
    expect(update).not.toHaveBeenCalled();
  });
});
