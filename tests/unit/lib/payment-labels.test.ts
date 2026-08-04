import { describe, expect, it } from "vitest";
import type { PaymentType } from "@prisma/client";
import {
  PAYMENT_NONCASH_TYPES,
  PAYMENT_OUTFLOW_TYPES,
  isNonCashPayment,
  paymentNetWeight,
  signedPaymentAmount,
} from "../../../src/lib/payment-labels";

describe("paymentNetWeight", () => {
  it("weights refunds, credits and payouts as outflows (-1)", () => {
    for (const t of ["REFUND", "MANUAL_CREDIT", "PARTNER_COMMISSION_PAYOUT"] as PaymentType[]) {
      expect(paymentNetWeight(t)).toBe(-1);
    }
  });

  it("weights booking payments, charges and bond CAPTURE as inflows (+1)", () => {
    for (const t of [
      "BOOKING_PAYMENT",
      "BOND_CAPTURE",
      "DAMAGE_CHARGE",
      "LATE_FEE",
      "MANUAL_CHARGE",
      "GIFT_CARD_PURCHASE",
    ] as PaymentType[]) {
      expect(paymentNetWeight(t)).toBe(1);
    }
  });

  it("weights bond hold/release as non-cash (0) so a lone release can't skew the net", () => {
    expect(paymentNetWeight("BOND_HOLD")).toBe(0);
    expect(paymentNetWeight("BOND_RELEASE")).toBe(0);
  });
});

describe("isNonCashPayment", () => {
  it("flags only bond authorisations", () => {
    expect(isNonCashPayment("BOND_HOLD")).toBe(true);
    expect(isNonCashPayment("BOND_RELEASE")).toBe(true);
    expect(isNonCashPayment("BOND_CAPTURE")).toBe(false);
    expect(isNonCashPayment("REFUND")).toBe(false);
  });
});

describe("signedPaymentAmount", () => {
  it("negates cash outflows and preserves cash inflows", () => {
    expect(signedPaymentAmount("REFUND", 147.5)).toBe(-147.5);
    expect(signedPaymentAmount("BOOKING_PAYMENT", 172.5)).toBe(172.5);
  });

  it("shows non-cash bond rows as a positive magnitude (display only)", () => {
    expect(signedPaymentAmount("BOND_RELEASE", 300)).toBe(300);
  });

  it("normalises a negated zero to +0 so it formats as $0.00 not -$0.00", () => {
    expect(Object.is(signedPaymentAmount("REFUND", 0), 0)).toBe(true);
  });

  it("produces a true cash net once weighted (payment − refund, bond excluded)", () => {
    const net =
      paymentNetWeight("BOOKING_PAYMENT") * 172.5 +
      paymentNetWeight("REFUND") * 147.5 +
      paymentNetWeight("BOND_RELEASE") * 300;
    expect(net).toBeCloseTo(25, 2);
  });
});

describe("payment type sets", () => {
  it("no longer treats BOND_RELEASE as a cash outflow", () => {
    expect(PAYMENT_OUTFLOW_TYPES.has("BOND_RELEASE")).toBe(false);
    expect([...PAYMENT_OUTFLOW_TYPES].sort()).toEqual(
      ["MANUAL_CREDIT", "PARTNER_COMMISSION_PAYOUT", "REFUND"].sort(),
    );
  });

  it("classifies bond hold/release and gift-card redemption as non-cash", () => {
    expect([...PAYMENT_NONCASH_TYPES].sort()).toEqual(
      ["BOND_HOLD", "BOND_RELEASE", "GIFT_CARD_REDEMPTION"].sort(),
    );
  });
});
