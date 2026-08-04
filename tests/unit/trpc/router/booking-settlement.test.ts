import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// The router imports writePaymentAudit / writePaymentEvent. We stub the
// modules so tests don't need a real database writer for audit rows.
vi.mock("@/server/services/audit-payment", () => ({
  writePaymentAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/payment-events", () => ({
  writePaymentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/audit", () => ({
  skipAutoAudit: vi.fn(),
  writeAuditAsync: vi.fn(),
  writeAudit: vi.fn().mockResolvedValue(undefined),
  captureBookingId: vi.fn(),
  readCapturedBookingId: vi.fn(),
}));
// Stripe refund + adjustment-note pipeline are stubbed so the refund test
// stays a pure unit test. `refundCharge` succeeds by default;
// `tryIssueAdjustmentForBooking` is asserted on directly.
const refundChargeMock = vi.fn();
const capturePaymentIntentMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
  refundCharge: (...args: unknown[]) => refundChargeMock(...args),
  capturePaymentIntent: (...args: unknown[]) => capturePaymentIntentMock(...args),
}));
const tryIssueAdjustmentForBookingMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...args: unknown[]) =>
    tryIssueAdjustmentForBookingMock(...args),
}));
// captureNow drives an off-session Stripe charge; stub it so the test stays
// a pure unit test. Default: a clean `succeeded` capture.
const chargeOffSessionForUserMock = vi.fn();
vi.mock("@/server/services/stripe-customer", () => ({
  chargeOffSessionForUser: (...args: unknown[]) => chargeOffSessionForUserMock(...args),
}));

import { bookingSettlementRouter } from "../../../../src/server/trpc/router/booking-settlement";

beforeEach(() => {
  vi.clearAllMocks();
});

type TestCtx = {
  prisma: {
    booking: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    payment: {
      create: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    bondLedger: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  session: { user: { id: string; role: "STAFF" } };
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  reqId: string;
};

function makeCtx(overrides: {
  booking?: Record<string, unknown>;
  paymentCreated?: Record<string, unknown>;
  sourcePayment?: Record<string, unknown> | null;
  bondLedger?: Record<string, unknown> | null;
} = {}): TestCtx {
  const booking = {
    id: "b1",
    bookingReference: "SCT-20260420-0001",
    customerId: "cust1",
    balanceDue: 0,
    amountPaid: 0,
    ...overrides.booking,
  };
  const paymentCreated = overrides.paymentCreated ?? { id: "p1" };

  const payment = {
    create: vi.fn().mockResolvedValue(paymentCreated),
    findUniqueOrThrow:
      overrides.sourcePayment === undefined
        ? vi.fn()
        : vi.fn().mockResolvedValue(overrides.sourcePayment),
    update: vi.fn().mockResolvedValue({}),
    // CAS status flips (captureNow / voidPayment) go through updateMany.
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };

  const bondLedger = {
    findUniqueOrThrow:
      overrides.bondLedger === undefined
        ? vi.fn()
        : vi.fn().mockResolvedValue(overrides.bondLedger),
    update: vi.fn().mockResolvedValue({}),
  };

  const booking_ = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
    // applyCaptureToBalanceDue (and captureBond's overflow path) read via
    // findUnique, not findUniqueOrThrow.
    findUnique: vi.fn().mockResolvedValue(booking),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };

  return {
    prisma: {
      booking: booking_,
      payment,
      bondLedger,
      // Run the callback against a tx proxy that reuses the same mocks, so
      // create/update calls inside the transaction are observable.
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ payment, bondLedger, booking: booking_ }),
      ),
    },
    // protectedProcedure reads role off session.user, so the role gate on
    // staffProcedure runs against this value.
    session: { user: { id: "staff1", role: "STAFF" } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };
}

describe("bookingSettlement.addManualCharge", () => {
  it("computes GST-inclusive split and bumps booking balance", async () => {
    const ctx = makeCtx();
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await c.addManualCharge({
      bookingId: "b1",
      amount: 110,
      description: "Cleaning fee",
    });

    const createCall = ctx.prisma.payment.create.mock.calls[0]?.[0] as {
      data: { amount: number; gstAmount: unknown; type: string; status: string };
    };
    expect(createCall.data.amount).toBe(110);
    // 110 / 11 = 10.00 — gstFromInclusive returns Prisma.Decimal; coerce for comparison.
    expect(Number(createCall.data.gstAmount)).toBe(10);
    expect(createCall.data.type).toBe("MANUAL_CHARGE");
    expect(createCall.data.status).toBe("PENDING");
    expect(ctx.prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balanceDue: { increment: 110 } }),
      }),
    );
  });

  it("zeroes GST when caller opts out of GST-inclusive", async () => {
    const ctx = makeCtx();
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await c.addManualCharge({
      bookingId: "b1",
      amount: 100,
      description: "Tax-exempt fee",
      gstInclusive: false,
    });
    expect(ctx.prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 100, gstAmount: 0 }),
      }),
    );
  });

  it("rejects non-positive amounts at the zod boundary", async () => {
    const ctx = makeCtx();
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.addManualCharge({ bookingId: "b1", amount: 0, description: "Zero" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("bookingSettlement.refund", () => {
  const source = {
    id: "src1",
    status: "SUCCEEDED",
    amount: 110,
    gstAmount: 10,
    customerId: "cust1",
    bookingId: "b1",
    stripePaymentIntentId: "pi_1",
    stripeChargeId: "ch_1",
    processedAt: new Date(),
    createdAt: new Date(),
  };

  it("credits GST on the refund row, proportional to the slice refunded", async () => {
    refundChargeMock.mockResolvedValueOnce({ id: "re_2", status: "succeeded", amountCents: 5500 });
    const ctx = makeCtx({ sourcePayment: source, paymentCreated: { id: "refund3" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    // Refund half of the $110 (incl. $10 GST) charge → $5.00 GST credit.
    await c.refund({ paymentId: "src1", amount: 55, reason: "Partial goodwill" });

    const refundCreate = ctx.prisma.payment.create.mock.calls.find(
      ([arg]) => (arg as { data: { type: string } }).data.type === "REFUND",
    )?.[0] as { data: { amount: number; gstAmount: unknown } };
    expect(refundCreate.data.amount).toBe(55);
    expect(Number(refundCreate.data.gstAmount)).toBeCloseTo(5, 2);
  });

  it("issues a DECREASE/REFUND adjustment note when the Stripe refund succeeds", async () => {
    refundChargeMock.mockResolvedValueOnce({ id: "re_1", status: "succeeded", amountCents: 11000 });
    const ctx = makeCtx({ sourcePayment: source, paymentCreated: { id: "refund1" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    await c.refund({ paymentId: "src1", reason: "Customer goodwill" });

    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledTimes(1);
    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "b1",
        type: "DECREASE",
        reason: "REFUND",
        paymentId: "refund1",
        issuedById: "staff1",
        lineItems: [
          expect.objectContaining({ totalPrice: 110, unitPrice: 110, gstIncluded: true }),
        ],
      }),
    );
  });

  it("does not issue an adjustment note when the Stripe refund fails", async () => {
    refundChargeMock.mockRejectedValueOnce(new Error("card_declined"));
    const ctx = makeCtx({ sourcePayment: source, paymentCreated: { id: "refund2" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    await c.refund({ paymentId: "src1", reason: "Customer goodwill" });

    expect(tryIssueAdjustmentForBookingMock).not.toHaveBeenCalled();
  });

  it("rejects refunds against a non-SUCCEEDED source payment", async () => {
    const ctx = makeCtx({ sourcePayment: { ...source, status: "PENDING" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.refund({ paymentId: "src1", reason: "x" }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(tryIssueAdjustmentForBookingMock).not.toHaveBeenCalled();
  });
});

describe("bookingSettlement.captureNow", () => {
  const pendingCharge = {
    id: "pay1",
    amount: 854.97,
    customerId: "cust1",
    bookingId: "b1",
    status: "PENDING",
    type: "EXTENSION",
    reference: "EXT-123",
    booking: { bookingReference: "SCT-20260420-0001" },
  };

  it("decrements balanceDue by the captured amount on a successful capture", async () => {
    chargeOffSessionForUserMock.mockResolvedValueOnce({
      status: "succeeded",
      id: "pi_1",
      chargeId: "ch_1",
    });
    const ctx = makeCtx({
      sourcePayment: pendingCharge,
      booking: { id: "b1", balanceDue: 904.97 },
    });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    const res = await c.captureNow({ paymentId: "pay1" });

    expect(res.status).toBe("SUCCEEDED");
    // 904.97 − 854.97 = 50.00 — the no-show fee that remains genuinely owed.
    // The captured amount is mirrored onto amountPaid (0 + 854.97).
    expect(ctx.prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 50, amountPaid: 854.97 },
    });
  });

  it("does not touch balanceDue when the off-session charge does not succeed", async () => {
    chargeOffSessionForUserMock.mockResolvedValueOnce({
      status: "requires_action",
      id: "pi_2",
    });
    const ctx = makeCtx({
      sourcePayment: pendingCharge,
      booking: { id: "b1", balanceDue: 904.97 },
    });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    const res = await c.captureNow({ paymentId: "pay1" });

    expect(res.status).toBe("REQUIRES_ACTION");
    expect(ctx.prisma.booking.update).not.toHaveBeenCalled();
  });

  it("rejects capturing a payment that is not PENDING", async () => {
    const ctx = makeCtx({ sourcePayment: { ...pendingCharge, status: "SUCCEEDED" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(c.captureNow({ paymentId: "pay1" })).rejects.toBeInstanceOf(TRPCError);
    expect(chargeOffSessionForUserMock).not.toHaveBeenCalled();
  });
});

describe("bookingSettlement.captureBond", () => {
  const heldBond = {
    id: "bl1",
    bookingId: "b1",
    customerId: "cust1",
    status: "HELD",
    heldAmount: 200,
    capturedAmount: 0,
    releasedAmount: 0,
    deductions: [],
    stripePaymentIntentId: "pi_bond_1",
  };

  it("captures the hold once and lands the ledger terminal (FULLY_CAPTURED + releasedAmount)", async () => {
    capturePaymentIntentMock.mockResolvedValueOnce({
      id: "pi_bond_1",
      status: "succeeded",
      amountReceivedCents: 8000,
      latestChargeId: "ch_bond_1",
      captured: true,
    });
    const ctx = makeCtx({ bondLedger: heldBond, paymentCreated: { id: "bondpay1" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    const res = await c.captureBond({ bookingId: "b1", amount: 80, deductionLabel: "Front fairing scratch" });

    // Captured the requested amount from Stripe, keyed on the ledger id.
    expect(capturePaymentIntentMock).toHaveBeenCalledWith("pi_bond_1", {
      amountToCaptureCents: 8000,
      idempotencyKey: "bond-capture-bl1",
    });
    // Ledger lands terminal: captured 80, released 120 (= held − captured).
    expect(ctx.prisma.bondLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          capturedAmount: 80,
          releasedAmount: 120,
          status: "FULLY_CAPTURED",
        }),
      }),
    );
    // BOND_CAPTURE row carries the Stripe ids so reconcile can match it.
    const bondCreate = ctx.prisma.payment.create.mock.calls.find(
      ([arg]) => (arg as { data: { type: string } }).data.type === "BOND_CAPTURE",
    )?.[0] as { data: Record<string, unknown> };
    expect(bondCreate.data).toMatchObject({
      amount: 80,
      status: "SUCCEEDED",
      stripePaymentIntentId: "pi_bond_1",
      stripeChargeId: "ch_bond_1",
    });
    // Adjustment note for the bond-funded amount.
    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "INCREASE",
        lineItems: [expect.objectContaining({ totalPrice: 80 })],
      }),
    );
    expect(res).toEqual({ capturedAmount: 80, overflowToCard: 0, status: "FULLY_CAPTURED" });
  });

  it("rejects a second capture — a Stripe hold is single-capture", async () => {
    const ctx = makeCtx({ bondLedger: { ...heldBond, capturedAmount: 50 } });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.captureBond({ bookingId: "b1", amount: 30, deductionLabel: "More damage" }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
  });

  it("captures the full hold and bills the overflow to the card as PENDING", async () => {
    capturePaymentIntentMock.mockResolvedValueOnce({
      id: "pi_bond_1",
      status: "succeeded",
      amountReceivedCents: 20000,
      latestChargeId: "ch_bond_2",
      captured: true,
    });
    const ctx = makeCtx({
      bondLedger: { ...heldBond, heldAmount: 100 },
      booking: { id: "b1", balanceDue: 0 },
      paymentCreated: { id: "bondpay2" },
    });
    const c = bookingSettlementRouter.createCaller(ctx as never);

    const res = await c.captureBond({ bookingId: "b1", amount: 150, deductionLabel: "Total loss bar end" });

    // Only the held amount is captured from the bond.
    expect(capturePaymentIntentMock).toHaveBeenCalledWith(
      "pi_bond_1",
      expect.objectContaining({ amountToCaptureCents: 10000 }),
    );
    // Overflow becomes a PENDING DAMAGE_CHARGE on the card.
    const overflow = ctx.prisma.payment.create.mock.calls.find(
      ([arg]) => (arg as { data: { type: string } }).data.type === "DAMAGE_CHARGE",
    )?.[0] as { data: Record<string, unknown> };
    expect(overflow.data).toMatchObject({ amount: 50, status: "PENDING" });
    // ...and is added to balanceDue (0 + 50).
    expect(ctx.prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balanceDue: 50 }) }),
    );
    expect(res).toEqual({ capturedAmount: 100, overflowToCard: 50, status: "FULLY_CAPTURED" });
  });

  it("rejects when the bond is already terminal", async () => {
    const ctx = makeCtx({ bondLedger: { ...heldBond, status: "FULLY_CAPTURED" } });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.captureBond({ bookingId: "b1", amount: 10, deductionLabel: "x" }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
  });
});

describe("bookingSettlement.writeOffBalance (bad-debt lever)", () => {
  function managerCtx(booking: Record<string, unknown>) {
    const ctx = makeCtx({ booking });
    // writeOffBalance is managerProcedure — STAFF must be rejected.
    ctx.session = { user: { id: "mgr1", role: "MANAGER" as never } } as never;
    // Open charge rows the write-off must terminal-ise.
    (ctx.prisma.payment as Record<string, unknown>).findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "pay_open_1", notes: null },
        { id: "pay_open_2", notes: "capture-pending: failed" },
      ]);
    return ctx;
  }

  it("flips open rows to WRITTEN_OFF, zeroes balanceDue and issues a DECREASE adjustment", async () => {
    const ctx = managerCtx({ balanceDue: 180 });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    const res = await c.writeOffBalance({ bookingId: "b1", reason: "Debtor uncontactable 90+ days" });
    expect(res).toEqual({ amount: 180, rowsClosed: 2 });
    expect(ctx.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_open_1" },
        data: expect.objectContaining({ status: "WRITTEN_OFF" }),
      }),
    );
    expect(ctx.prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balanceDue: 0 }),
      }),
    );
    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DECREASE", bookingId: "b1" }),
    );
  });

  it("rejects when nothing is owed", async () => {
    const ctx = managerCtx({ balanceDue: 0 });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.writeOffBalance({ bookingId: "b1", reason: "nothing to do here" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("is manager-gated — STAFF cannot write off debt", async () => {
    const ctx = makeCtx({ booking: { balanceDue: 100 } });
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.writeOffBalance({ bookingId: "b1", reason: "staff trying it on" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
