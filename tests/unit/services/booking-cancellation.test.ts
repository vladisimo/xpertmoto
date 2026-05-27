import { describe, expect, it, vi, beforeEach } from "vitest";

// External side-effects are stubbed so the test stays a pure unit test that
// only exercises the cancellation refund maths + the Payment row it writes.
const refundChargeMock = vi.fn();
const cancelPaymentIntentMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  refundCharge: (...a: unknown[]) => refundChargeMock(...a),
  cancelPaymentIntent: (...a: unknown[]) => cancelPaymentIntentMock(...a),
}));
vi.mock("@/lib/settings", () => ({ getSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("@/server/services/notification-sender", () => ({ sendNotification: vi.fn() }));
vi.mock("@/server/services/revenue-aggregator", () => ({ invalidateRevenueCaches: vi.fn() }));
vi.mock("@/server/services/staff-tasks", () => ({ supersedeByTarget: vi.fn() }));
vi.mock("@/server/services/audit", () => ({ writeAudit: vi.fn() }));
const tryIssueCancellationAdjustmentMock = vi.fn();
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueCancellationAdjustment: (...a: unknown[]) => tryIssueCancellationAdjustmentMock(...a),
}));
vi.mock("@/lib/analytics", () => ({ trackServer: vi.fn() }));
vi.mock("@/lib/branding", () => ({ getBranding: vi.fn().mockResolvedValue({ siteName: "X" }) }));
vi.mock("@react-email/render", () => ({ render: vi.fn().mockResolvedValue("<html></html>") }));

import { cancel } from "../../../src/server/services/booking-cancellation";

beforeEach(() => {
  vi.clearAllMocks();
  refundChargeMock.mockResolvedValue({ id: "re_1", status: "succeeded" });
});

function makeMockPrisma(paymentCreate: ReturnType<typeof vi.fn>, pickupDateTime?: Date) {
  const booking = {
    id: "b1",
    bookingReference: "SCT-20260420-0001",
    status: "CONFIRMED",
    subscriptionId: null,
    extensionOfId: null,
    customerId: "cust1",
    depotId: "depot1",
    vehicleId: null,
    // >72h before pickup → full refund less admin fee (default).
    pickupDateTime: pickupDateTime ?? new Date(Date.now() + 30 * 86_400_000),
    amountPaid: 135,
    customer: { id: "cust1", firstName: "Vlad" },
    pickupDepot: { slug: "brisbane" },
    bondLedger: null,
    payments: [{ stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    extensions: [],
  };
  const tx = {
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() },
    bookingBillingPlan: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    bookingStatusLog: { create: vi.fn() },
    bondLedger: { update: vi.fn() },
    payment: { create: paymentCreate },
  };
  return {
    booking: { findUniqueOrThrow: vi.fn().mockResolvedValue(booking) },
    vehicle: { update: vi.fn() },
    payment: { findFirst: vi.fn().mockResolvedValue({ id: "ref1" }) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  } as never;
}

describe("booking cancel — refund GST", () => {
  it("credits proportional GST on the cancellation refund Payment row", async () => {
    const paymentCreate = vi.fn().mockResolvedValue({ id: "ref1" });
    const prisma = makeMockPrisma(paymentCreate);

    const res = await cancel(
      { bookingId: "b1", reason: "Change of plans", source: "CUSTOMER", actorUserId: "u1" },
      prisma,
    );

    const refund = paymentCreate.mock.calls
      .map(([arg]) => (arg as { data: { type: string; amount: number; gstAmount: unknown } }).data)
      .find((d) => d.type === "REFUND");

    expect(refund).toBeDefined();
    expect(res.refundAmount).toBeGreaterThan(0);
    // GST credit must be the GST-inclusive portion of the refunded amount.
    expect(Number(refund!.gstAmount)).toBeGreaterThan(0);
    expect(Number(refund!.gstAmount)).toBeCloseTo(Number(refund!.amount) / 11, 2);
  });

  it("sizes the cancellation adjustment to the retained consideration, not the refund", async () => {
    // amountPaid=135, >72h → full refund less $25 admin fee → refund=110.
    // The adjustment must credit the invoice down to the retained $25, so it
    // is sized to the consideration change (which also writes off any
    // never-collected balance), not the $110 cash refunded.
    const paymentCreate = vi.fn().mockResolvedValue({ id: "ref1" });
    const prisma = makeMockPrisma(paymentCreate);

    const res = await cancel(
      { bookingId: "b1", reason: "Change of plans", source: "CUSTOMER", actorUserId: "u1" },
      prisma,
    );

    expect(res.refundAmount).toBeCloseTo(110, 2);
    expect(tryIssueCancellationAdjustmentMock).toHaveBeenCalledTimes(1);
    const arg = tryIssueCancellationAdjustmentMock.mock.calls[0]![0] as {
      bookingId: string;
      retained: number;
      refundAmount: number;
      paymentId: string | null;
    };
    expect(arg.bookingId).toBe("b1");
    expect(arg.retained).toBeCloseTo(25, 2); // amountPaid − refundAmount
    expect(arg.refundAmount).toBeCloseTo(110, 2);
    expect(arg.paymentId).toBe("ref1"); // refund Payment linked
  });

  it("still issues the adjustment in the no-refund window (refund = 0)", async () => {
    // <24h before pickup → refundPct 0 → no refund. The invoice for a
    // cancelled (non-rendered) booking must still be credited: retained =
    // amountPaid (the full deposit kept), no refund Payment to link.
    const paymentCreate = vi.fn().mockResolvedValue({ id: "ref1" });
    // 2h before pickup → inside the no-refund window.
    const prisma = makeMockPrisma(paymentCreate, new Date(Date.now() + 2 * 3_600_000));

    const res = await cancel(
      { bookingId: "b1", reason: "Too late", source: "CUSTOMER", actorUserId: "u1" },
      prisma,
    );

    expect(res.refundAmount).toBe(0);
    expect(tryIssueCancellationAdjustmentMock).toHaveBeenCalledTimes(1);
    const arg = tryIssueCancellationAdjustmentMock.mock.calls[0]![0] as {
      retained: number;
      refundAmount: number;
      paymentId: string | null;
    };
    expect(arg.retained).toBeCloseTo(135, 2); // full deposit retained
    expect(arg.refundAmount).toBe(0);
    expect(arg.paymentId).toBeNull();
  });
});
