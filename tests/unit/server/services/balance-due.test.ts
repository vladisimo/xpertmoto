import { describe, it, expect, vi } from "vitest";
import {
  applyCaptureToBalanceDue,
  isBalanceAffectingCharge,
  BALANCE_AFFECTING_CHARGE_TYPES,
} from "@/server/services/balance-due";

function makeDb(balanceDue: number | null) {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue(
    balanceDue === null ? null : { balanceDue },
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
    const { db, update } = makeDb(904.97);
    const res = await applyCaptureToBalanceDue(db, {
      bookingId: "b1",
      type: "EXTENSION",
      amount: 854.97,
      previousStatus: "PENDING",
    });
    expect(res).toEqual({ applied: true, newBalanceDue: 50 });
    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { balanceDue: 50 } });
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
    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { balanceDue: 0 } });
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
