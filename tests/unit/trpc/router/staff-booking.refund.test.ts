import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Heavy service deps are stubbed so importing the router stays cheap and the
// refundPayment path can be exercised as a pure unit test. Only the pieces
// refundPayment actually touches need real behaviour.
const refundChargeMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  refundCharge: (...args: unknown[]) => refundChargeMock(...args),
}));

const tryIssueAdjustmentForBookingMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...args: unknown[]) =>
    tryIssueAdjustmentForBookingMock(...args),
}));

vi.mock("@/server/services/audit", () => ({
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
  captureBookingId: vi.fn(),
  readCapturedBookingId: vi.fn(),
  skipAutoAudit: vi.fn(),
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  writeCustomerAuditAsync: vi.fn(),
}));

import { staffBookingRouter } from "../../../../src/server/trpc/router/staff-booking";

beforeEach(() => {
  vi.clearAllMocks();
});

const source = {
  id: "src1",
  reference: "PAY-123",
  status: "SUCCEEDED",
  amount: 110,
  gstAmount: 10,
  customerId: "cust1",
  bookingId: "b1",
  stripePaymentIntentId: "pi_1",
  stripeChargeId: "ch_1",
  booking: { id: "b1", bookingReference: "SCT-20260420-0001", customerId: "cust1" },
};

function makeCtx(sourcePayment: Record<string, unknown> | null) {
  const payment = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(sourcePayment),
    create: vi.fn().mockResolvedValue({ id: "refund1" }),
    update: vi.fn().mockResolvedValue({}),
  };
  return {
    prisma: {
      payment,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ payment })),
    },
    session: { user: { id: "staff1", role: "STAFF" } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };
}

describe("staffBooking.refundPayment", () => {
  it("issues a DECREASE/REFUND adjustment note when the Stripe refund succeeds", async () => {
    refundChargeMock.mockResolvedValueOnce({ id: "re_1", status: "succeeded", amountCents: 11000 });
    const ctx = makeCtx(source);
    const c = staffBookingRouter.createCaller(ctx as never);

    const res = await c.refundPayment({ paymentId: "src1", reason: "Overcharge" });

    expect(res.status).toBe("SUCCEEDED");
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
    const ctx = makeCtx(source);
    const c = staffBookingRouter.createCaller(ctx as never);

    const res = await c.refundPayment({ paymentId: "src1", reason: "Overcharge" });

    expect(res.status).toBe("FAILED");
    expect(tryIssueAdjustmentForBookingMock).not.toHaveBeenCalled();
  });

  it("rejects refunds against a non-SUCCEEDED source payment", async () => {
    const ctx = makeCtx({ ...source, status: "PENDING" });
    const c = staffBookingRouter.createCaller(ctx as never);

    await expect(
      c.refundPayment({ paymentId: "src1", reason: "x" }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(tryIssueAdjustmentForBookingMock).not.toHaveBeenCalled();
  });
});
