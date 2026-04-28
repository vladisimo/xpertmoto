import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G5 — capture-pending-payments job.
 *
 * Covers four outcome branches:
 *   - succeeded           → Payment SUCCEEDED, stripe ids set
 *   - requires_action     → Payment stays PENDING, customer emailed, PI id set
 *   - failed              → Payment FAILED, managers notified
 *   - no stored PM        → skipped counter bumped, Payment untouched
 *
 * The idempotency key shape (`payment-capture:<id>:<reference>`) is
 * asserted so the job can be safely re-run without double-charging.
 */

const findMany = vi.fn();
const update = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});
const userFindMany = vi.fn().mockResolvedValue([{ id: "mgr_1" }]);
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
const chargeOffSessionForUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findMany, update },
    user: { findMany: userFindMany },
    auditLog: { create: auditCreate },
  },
}));

vi.mock("@/server/services/stripe-customer", () => ({
  chargeOffSessionForUser: (...args: unknown[]) => chargeOffSessionForUser(...args),
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn().mockReturnValue(null),
}));

const baseRow = {
  id: "pay_1",
  reference: "DMG-abc",
  customerId: "cust_1",
  bookingId: "book_1",
  type: "DAMAGE_CHARGE" as const,
  amount: { toString: () => "150.00" } as unknown as number, // Prisma Decimal stub
  notes: null,
  booking: { bookingReference: "SCT-20260418-0001" },
};

beforeEach(() => {
  findMany.mockReset();
  update.mockClear();
  auditCreate.mockClear();
  userFindMany.mockClear();
  userFindMany.mockResolvedValue([{ id: "mgr_1" }]);
  sendNotification.mockClear();
  chargeOffSessionForUser.mockReset();
});

describe("capture-pending-payments", () => {
  it("marks Payment SUCCEEDED when off-session charge succeeds", async () => {
    findMany.mockResolvedValue([baseRow]);
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_new_1",
      status: "succeeded",
      chargeId: "ch_new_1",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { runCapturePendingPayments } = await import("@/server/jobs/capture-pending-payments");
    const r = await runCapturePendingPayments();
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(0);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          stripePaymentIntentId: "pi_new_1",
          stripeChargeId: "ch_new_1",
        }),
      }),
    );
    // Idempotency key shape
    expect(chargeOffSessionForUser).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "payment-capture:pay_1:DMG-abc" }),
    );
  });

  it("leaves Payment PENDING and emails customer on requires_action", async () => {
    findMany.mockResolvedValue([baseRow]);
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_action_1",
      status: "requires_action",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { runCapturePendingPayments } = await import("@/server/jobs/capture-pending-payments");
    const r = await runCapturePendingPayments();
    expect(r.requiresAction).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stripePaymentIntentId: "pi_action_1" }),
      }),
    );
    // Customer is emailed — not the managers
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "cust_1" }),
    );
  });

  it("marks Payment FAILED and notifies managers on hard decline", async () => {
    findMany.mockResolvedValue([baseRow]);
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_fail_1",
      status: "failed",
      errorCode: "card_declined",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { runCapturePendingPayments } = await import("@/server/jobs/capture-pending-payments");
    const r = await runCapturePendingPayments();
    expect(r.failed).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "mgr_1" }),
    );
  });

  it("skips when the customer has no stored payment method", async () => {
    findMany.mockResolvedValue([baseRow]);
    chargeOffSessionForUser.mockResolvedValue(null); // service returns null when no PM
    const { runCapturePendingPayments } = await import("@/server/jobs/capture-pending-payments");
    const r = await runCapturePendingPayments();
    expect(r.skippedNoPm).toBe(1);
    expect(r.succeeded).toBe(0);
    // Only the note is updated; status stays PENDING
    const call = update.mock.calls[0]?.[0] as { data: { status?: string; notes?: string } };
    expect(call?.data.status).toBeUndefined();
    expect(call?.data.notes).toContain("no stored PM");
  });

  it("returns zeros when no PENDING rows exist", async () => {
    findMany.mockResolvedValue([]);
    const { runCapturePendingPayments } = await import("@/server/jobs/capture-pending-payments");
    const r = await runCapturePendingPayments();
    expect(r).toEqual({ scanned: 0, succeeded: 0, requiresAction: 0, failed: 0, skippedNoPm: 0 });
    expect(chargeOffSessionForUser).not.toHaveBeenCalled();
  });
});
