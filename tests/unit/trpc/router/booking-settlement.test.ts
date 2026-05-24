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
vi.mock("@/lib/stripe", () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
  refundCharge: (...args: unknown[]) => refundChargeMock(...args),
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
} = {}): TestCtx {
  const booking = {
    id: "b1",
    bookingReference: "SCT-20260420-0001",
    customerId: "cust1",
    balanceDue: 0,
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
  };

  return {
    prisma: {
      booking: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
        // applyCaptureToBalanceDue reads via findUnique, not findUniqueOrThrow.
        findUnique: vi.fn().mockResolvedValue(booking),
        update: vi.fn().mockResolvedValue({}),
      },
      payment,
      // Run the callback against a tx proxy that reuses the same payment mock,
      // so create/update calls inside the transaction are observable.
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ payment })),
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
        data: expect.objectContaining({ balanceDue: 110 }),
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
    customerId: "cust1",
    bookingId: "b1",
    stripePaymentIntentId: "pi_1",
    stripeChargeId: "ch_1",
    processedAt: new Date(),
    createdAt: new Date(),
  };

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
    expect(ctx.prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 50 },
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
