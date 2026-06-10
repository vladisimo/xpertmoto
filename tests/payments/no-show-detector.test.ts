import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G22 — no-show detector.
 *
 *   - CONFIRMED bookings past pickup + grace → status NO_SHOW, bond
 *     fully captured (forfeiture), vehicle freed.
 *   - When no bond ledger exists, fall back to a MANUAL_CHARGE for the
 *     configured no-show fee.
 *   - Bookings within the grace window stay CONFIRMED (SQL filter).
 *   - Settings-driven: `booking.noShowGraceHours` shifts the cutoff.
 *   - Idempotent / handles zero candidates cleanly.
 */

const bookingFindMany = vi.fn();
const bookingUpdate = vi.fn().mockResolvedValue({});
const bondUpdate = vi.fn().mockResolvedValue({});
const paymentCreate = vi.fn().mockResolvedValue({});
const vehicleUpdate = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});
const billingPlanUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
const txFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    booking: { update: bookingUpdate },
    bondLedger: { update: bondUpdate },
    payment: { create: paymentCreate },
    vehicle: { update: vehicleUpdate },
    bookingBillingPlan: { updateMany: billingPlanUpdateMany },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: bookingFindMany, update: bookingUpdate },
    bondLedger: { update: bondUpdate },
    payment: { create: paymentCreate },
    vehicle: { update: vehicleUpdate },
    auditLog: { create: auditCreate },
    bookingBillingPlan: { updateMany: billingPlanUpdateMany },
    $transaction: txFn,
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));

// The forfeiture path now captures the bond hold at Stripe before writing.
const capturePaymentIntent = vi
  .fn()
  .mockResolvedValue({ id: "pi_bond_1", status: "succeeded", amountReceivedCents: 20000, latestChargeId: "ch_bond_1", captured: true });
vi.mock("@/lib/stripe", () => ({ capturePaymentIntent }));

vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));

const getSettings = vi.fn();
vi.mock("@/lib/settings", () => ({ getSettings }));

beforeEach(() => {
  bookingFindMany.mockReset();
  bookingUpdate.mockClear();
  bondUpdate.mockClear();
  paymentCreate.mockClear();
  vehicleUpdate.mockClear();
  auditCreate.mockClear();
  billingPlanUpdateMany.mockClear();
  sendNotification.mockClear();
  capturePaymentIntent.mockClear();
  getSettings.mockReset();
  getSettings.mockResolvedValue({
    "booking.noShowGraceHours": 2,
    "cancellation.noShowFee": 50,
  });
});

describe("no-show-detector", () => {
  it("forfeits the held bond, frees the vehicle, marks NO_SHOW", async () => {
    const pickup = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
    bookingFindMany.mockResolvedValue([
      {
        id: "book_noshow",
        bookingReference: "SCT-0001",
        customerId: "cust_1",
        vehicleId: "veh_1",
        pickupDateTime: pickup,
        bondAmount: "200.00",
        pickupDepot: { slug: "gold-coast" },
        bondLedger: {
          id: "bond_1",
          status: "HELD",
          heldAmount: "200.00",
          capturedAmount: "0",
          releasedAmount: "0",
          deductions: [],
          stripePaymentIntentId: "pi_bond_1",
        },
      },
    ]);
    const { runNoShowDetector } = await import("@/server/jobs/no-show-detector");
    const r = await runNoShowDetector();
    expect(r.markedNoShow).toBe(1);
    // The bond hold is actually captured at Stripe (full forfeiture).
    expect(capturePaymentIntent).toHaveBeenCalledWith("pi_bond_1", {
      amountToCaptureCents: 20000,
      idempotencyKey: "bond-capture-noshow-book_noshow",
    });
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "NO_SHOW" }),
      }),
    );
    // Lands terminal: captured 200, released 0 (= held − captured).
    expect(bondUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FULLY_CAPTURED",
          capturedAmount: 200,
          releasedAmount: 0,
        }),
      }),
    );
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "BOND_CAPTURE",
          amount: 200,
          reference: "BOND-CAP-NOSHOW-book_noshow",
          status: "SUCCEEDED",
        }),
      }),
    );
    expect(vehicleUpdate).toHaveBeenCalledWith({
      where: { id: "veh_1" },
      data: { status: "AVAILABLE" },
    });
    expect(sendNotification).toHaveBeenCalled();
  });

  it("skips the booking (no phantom) when the Stripe bond capture fails", async () => {
    capturePaymentIntent.mockRejectedValueOnce(new Error("payment_intent_unexpected_state"));
    bookingFindMany.mockResolvedValue([
      {
        id: "book_fail",
        bookingReference: "SCT-0009",
        customerId: "cust_9",
        vehicleId: "veh_9",
        pickupDateTime: new Date(Date.now() - 3 * 3600 * 1000),
        bondAmount: "200.00",
        pickupDepot: { slug: "gold-coast" },
        bondLedger: {
          id: "bond_9",
          status: "HELD",
          heldAmount: "200.00",
          capturedAmount: "0",
          releasedAmount: "0",
          deductions: [],
          stripePaymentIntentId: "pi_bond_9",
        },
      },
    ]);
    const { runNoShowDetector } = await import("@/server/jobs/no-show-detector");
    const r = await runNoShowDetector();
    expect(r.markedNoShow).toBe(0);
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(bondUpdate).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("falls back to a MANUAL_CHARGE no-show fee when no bond is held", async () => {
    bookingFindMany.mockResolvedValue([
      {
        id: "book_no_bond",
        bookingReference: "SCT-0002",
        customerId: "cust_2",
        vehicleId: null,
        pickupDateTime: new Date(Date.now() - 4 * 3600 * 1000),
        bondAmount: "0",
        pickupDepot: { slug: "gold-coast" },
        bondLedger: null,
      },
    ]);
    const { runNoShowDetector } = await import("@/server/jobs/no-show-detector");
    await runNoShowDetector();
    expect(bondUpdate).not.toHaveBeenCalled();
    expect(vehicleUpdate).not.toHaveBeenCalled();
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "MANUAL_CHARGE",
          amount: 50,
          reference: "NOSHOW-book_no_bond",
        }),
      }),
    );
    // The no-show fee is owed until collected, so it's added to balanceDue
    // (the capture-pending job nets it out on capture).
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "book_no_bond" },
        data: { balanceDue: { increment: 50 } },
      }),
    );
  });

  it("cancels any long-term billing plan in the same transaction (F4)", async () => {
    bookingFindMany.mockResolvedValue([
      {
        id: "book_lt",
        bookingReference: "SCT-0003",
        customerId: "cust_3",
        vehicleId: null,
        pickupDateTime: new Date(Date.now() - 5 * 3600 * 1000),
        bondAmount: "0",
        pickupDepot: { slug: "gold-coast" },
        bondLedger: null,
      },
    ]);
    const { runNoShowDetector } = await import("@/server/jobs/no-show-detector");
    await runNoShowDetector();
    expect(billingPlanUpdateMany).toHaveBeenCalledWith({
      where: { bookingId: "book_lt", status: { notIn: ["CANCELLED", "COMPLETED"] } },
      data: { status: "CANCELLED", cancelReason: "Booking marked as no-show" },
    });
  });

  it("respects the grace hours from SystemSetting", async () => {
    getSettings.mockResolvedValue({
      "booking.noShowGraceHours": 4,
      "cancellation.noShowFee": 50,
    });
    bookingFindMany.mockResolvedValue([]);
    const { runNoShowDetector } = await import("@/server/jobs/no-show-detector");
    await runNoShowDetector();
    const args = bookingFindMany.mock.calls[0]![0] as { where: { pickupDateTime: { lt: Date } } };
    const diffMs = Date.now() - args.where.pickupDateTime.lt.getTime();
    expect(diffMs).toBeGreaterThan(3.9 * 3600 * 1000);
    expect(diffMs).toBeLessThan(4.1 * 3600 * 1000);
  });

  it("handles zero candidates cleanly", async () => {
    bookingFindMany.mockResolvedValue([]);
    const { runNoShowDetector } = await import("@/server/jobs/no-show-detector");
    const r = await runNoShowDetector();
    expect(r.markedNoShow).toBe(0);
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(bondUpdate).not.toHaveBeenCalled();
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });
});
