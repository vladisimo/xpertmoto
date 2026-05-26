import { describe, expect, it, vi, beforeEach } from "vitest";

// Stripe mirror refresh is a no-op in unit tests — we feed the ledger directly.
const runStripeReconcileMock = vi.fn().mockResolvedValue({});
vi.mock("@/server/jobs/stripe-reconcile", () => ({
  runStripeReconcile: (...a: unknown[]) => runStripeReconcileMock(...a),
}));

const findManyPayment = vi.fn();
const findManyLedger = vi.fn();
const findManyUnmatched = vi.fn();
const findManyBond = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findMany: (...a: unknown[]) => findManyPayment(...a) },
    stripeFeeLedger: { findMany: (...a: unknown[]) => findManyLedger(...a) },
    unmatchedTransaction: { findMany: (...a: unknown[]) => findManyUnmatched(...a) },
    bondLedger: { findMany: (...a: unknown[]) => findManyBond(...a) },
  },
}));

import { reconcilePayments } from "../../../src/server/services/finance-reconciliation";

const range = { from: new Date("2026-04-30"), to: new Date("2026-05-25") };

function payment(over: Record<string, unknown>) {
  return {
    id: "p",
    reference: "PAY",
    type: "BOOKING_PAYMENT",
    amount: 147.5,
    stripeChargeId: null,
    stripePaymentIntentId: null,
    bookingId: "b1",
    booking: { bookingReference: "XPM-1" },
    customer: { firstName: "Vlad", lastName: "S" },
    ...over,
  };
}

/** A StripeFeeLedger charge row whose gross (net + fee) equals `gross`. */
function chargeLedger(chargeId: string, gross: number, feeCents = 50, paymentIntent: string | null = null) {
  return {
    stripeChargeId: chargeId,
    stripePaymentIntentId: paymentIntent,
    feeType: "stripe_fee",
    feeAmountCents: feeCents,
    netAmountCents: Math.round(gross * 100) - feeCents,
  };
}

/** A StripeFeeLedger refund row (keyed on the refund id) of magnitude `gross`. */
function refundLedger(refundId: string, gross: number) {
  return {
    stripeChargeId: refundId,
    stripePaymentIntentId: null,
    feeType: "refund_fee",
    feeAmountCents: 0,
    netAmountCents: -Math.round(gross * 100),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyUnmatched.mockResolvedValue([]);
  findManyBond.mockResolvedValue([]);
});

describe("reconcilePayments", () => {
  it("reconciles the reported scenario to zero variance (bond release excluded, pending refund absent)", async () => {
    // The pending REFUND never reaches the SUCCEEDED query, so the book side
    // only sees the $147.50 charge + the $300 bond release.
    findManyPayment.mockResolvedValue([
      payment({ id: "p1", reference: "PAY-1", type: "BOOKING_PAYMENT", amount: 147.5, stripeChargeId: "ch_1" }),
      payment({ id: "p3", reference: "BOND-REL-1", type: "BOND_RELEASE", amount: 300, stripeChargeId: null }),
    ]);
    findManyLedger.mockResolvedValue([chargeLedger("ch_1", 147.5)]);

    const res = await reconcilePayments(range);

    expect(res.summary.bookNet).toBeCloseTo(147.5, 2); // bond release contributes 0
    expect(res.summary.stripeNet).toBeCloseTo(147.5, 2);
    expect(res.summary.variance).toBeCloseTo(0, 2);
    expect(res.summary.matchedCount).toBe(1);
    expect(res.summary.unmatchedCount).toBe(0);

    const bond = res.rows.find((r) => r.reference === "BOND-REL-1");
    expect(bond?.status).toBe("NON_CASH");
    const charge = res.rows.find((r) => r.reference === "PAY-1");
    expect(charge?.status).toBe("MATCHED");
    expect(charge?.stripeAmount).toBeCloseTo(147.5, 2);
  });

  it("matches a partially-refunded charge (its status is not SUCCEEDED)", async () => {
    // The booking payment settled then took a partial refund, so its status is
    // PARTIALLY_REFUNDED — it must still match its Stripe charge, not be skipped
    // (which would falsely flag the Stripe charge as MISSING_IN_BOOK).
    findManyPayment.mockResolvedValue([
      payment({ id: "p1", reference: "PAY-1", type: "BOOKING_PAYMENT", amount: 172.5, stripeChargeId: "ch_1" }),
      payment({ id: "p2", reference: "REF-1", type: "REFUND", amount: 147.5, stripeChargeId: "re_1" }),
    ]);
    findManyLedger.mockResolvedValue([chargeLedger("ch_1", 172.5), refundLedger("re_1", 147.5)]);

    const res = await reconcilePayments(range);

    expect(res.rows.find((r) => r.reference === "PAY-1")?.status).toBe("MATCHED");
    expect(res.rows.some((r) => r.status === "MISSING_IN_BOOK")).toBe(false);
    expect(res.summary.bookNet).toBeCloseTo(25, 2); // 172.50 − 147.50

    // The query must include settled-then-refunded statuses, not SUCCEEDED only.
    expect(findManyPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
        }),
      }),
    );
  });

  it("matches a settled refund to its Stripe refund object", async () => {
    findManyPayment.mockResolvedValue([
      payment({ id: "p1", reference: "PAY-1", type: "BOOKING_PAYMENT", amount: 147.5, stripeChargeId: "ch_1" }),
      payment({ id: "p2", reference: "REF-1", type: "REFUND", amount: 50, stripeChargeId: "re_1" }),
    ]);
    findManyLedger.mockResolvedValue([chargeLedger("ch_1", 147.5), refundLedger("re_1", 50)]);

    const res = await reconcilePayments(range);

    expect(res.summary.bookNet).toBeCloseTo(97.5, 2); // 147.50 − 50.00
    const refund = res.rows.find((r) => r.reference === "REF-1");
    expect(refund?.status).toBe("MATCHED"); // linked to its re_… refund, not Unlinked
    expect(refund?.bookAmount).toBeCloseTo(-50, 2);
    expect(refund?.stripeAmount).toBeCloseTo(-50, 2);
    expect(res.summary.unmatchedCount).toBe(0);
  });

  it("flags a refund with a Stripe id that hasn't settled in Stripe as MISSING_IN_STRIPE", async () => {
    findManyPayment.mockResolvedValue([
      payment({ id: "p2", reference: "REF-1", type: "REFUND", amount: 50, stripeChargeId: "re_unsettled" }),
    ]);
    findManyLedger.mockResolvedValue([]); // no refund_fee row yet

    const res = await reconcilePayments(range);
    expect(res.rows.find((r) => r.reference === "REF-1")?.status).toBe("MISSING_IN_STRIPE");
  });

  it("leaves a manual credit with no Stripe reference Unlinked", async () => {
    findManyPayment.mockResolvedValue([
      payment({ id: "p2", reference: "CR-1", type: "MANUAL_CREDIT", amount: 20, stripeChargeId: null }),
    ]);
    findManyLedger.mockResolvedValue([]);

    const res = await reconcilePayments(range);
    expect(res.rows.find((r) => r.reference === "CR-1")?.status).toBe("UNLINKED");
  });

  it("flags an amount mismatch between book and Stripe", async () => {
    findManyPayment.mockResolvedValue([
      payment({ id: "p1", reference: "PAY-1", amount: 147.5, stripeChargeId: "ch_1" }),
    ]);
    findManyLedger.mockResolvedValue([chargeLedger("ch_1", 140.0)]);

    const res = await reconcilePayments(range);
    const row = res.rows.find((r) => r.reference === "PAY-1");
    expect(row?.status).toBe("AMOUNT_MISMATCH");
    expect(res.summary.unmatchedCount).toBe(1);
  });

  it("matches on payment intent when the Payment's charge id was never backfilled", async () => {
    // PAY row carries only a payment-intent id (stripeChargeId null); the Stripe
    // charge carries the same PI. They must collapse into one MATCHED row, with
    // the resolved charge id surfaced — not split into Unlinked + Missing-in-book.
    findManyPayment.mockResolvedValue([
      payment({ id: "p1", reference: "PAY-1", type: "BOOKING_PAYMENT", amount: 172.5, stripeChargeId: null, stripePaymentIntentId: "pi_1" }),
    ]);
    findManyLedger.mockResolvedValue([chargeLedger("ch_1", 172.5, 50, "pi_1")]);

    const res = await reconcilePayments(range);

    const row = res.rows.find((r) => r.reference === "PAY-1");
    expect(row?.status).toBe("MATCHED");
    expect(row?.stripeChargeId).toBe("ch_1"); // resolved charge id surfaced
    expect(row?.stripeAmount).toBeCloseTo(172.5, 2);
    expect(res.rows.some((r) => r.status === "MISSING_IN_BOOK")).toBe(false);
    expect(res.summary.unmatchedCount).toBe(0);
  });

  it("flags a charge present in the book but missing in Stripe", async () => {
    findManyPayment.mockResolvedValue([
      payment({ id: "p1", reference: "PAY-1", amount: 147.5, stripeChargeId: "ch_missing" }),
    ]);
    findManyLedger.mockResolvedValue([]);

    const res = await reconcilePayments(range);
    expect(res.rows.find((r) => r.reference === "PAY-1")?.status).toBe("MISSING_IN_STRIPE");
    expect(res.summary.unmatchedCount).toBe(1);
  });

  it("flags a Stripe charge with no matching Payment", async () => {
    findManyPayment.mockResolvedValue([]);
    findManyLedger.mockResolvedValue([chargeLedger("ch_orphan", 99)]);

    const res = await reconcilePayments(range);
    const row = res.rows.find((r) => r.stripeChargeId === "ch_orphan");
    expect(row?.status).toBe("MISSING_IN_BOOK");
    expect(row?.paymentId).toBeNull();
    expect(row?.stripeAmount).toBeCloseTo(99, 2);
    expect(res.summary.unmatchedCount).toBe(1);
  });

  it("links a bond release to its held Stripe PaymentIntent without counting it as cash", async () => {
    findManyPayment.mockResolvedValue([
      payment({ id: "p3", reference: "BOND-REL-1", type: "BOND_RELEASE", amount: 300, stripeChargeId: null, stripePaymentIntentId: null, bookingId: "b1" }),
    ]);
    findManyLedger.mockResolvedValue([]);
    findManyBond.mockResolvedValue([{ bookingId: "b1", stripePaymentIntentId: "pi_bond" }]);

    const res = await reconcilePayments(range);

    const bond = res.rows.find((r) => r.reference === "BOND-REL-1");
    expect(bond?.status).toBe("NON_CASH");
    expect(bond?.stripeChargeId).toBe("pi_bond"); // linked to the held authorisation
    expect(bond?.stripeAmount).toBeNull(); // never settled cash
    expect(res.summary.bookNet).toBeCloseTo(0, 2); // excluded from the cash total
  });

  it("refreshes the Stripe mirror only when live", async () => {
    findManyPayment.mockResolvedValue([]);
    findManyLedger.mockResolvedValue([]);

    await reconcilePayments(range);
    expect(runStripeReconcileMock).not.toHaveBeenCalled();

    await reconcilePayments({ ...range, live: true });
    expect(runStripeReconcileMock).toHaveBeenCalledWith(
      expect.objectContaining({ advanceCheckpoint: false }),
    );
  });
});
