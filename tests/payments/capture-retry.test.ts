import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G8 — capture-retry exponential backoff.
 *
 * Covers:
 *   - happy path: succeeded on retry → Payment SUCCEEDED
 *   - still-transient: requeues with next attempt
 *   - exhausted: at MAX_ATTEMPTS marks FAILED + notifies managers
 *   - missing row: returns "missing" without side-effects
 *   - idempotent enqueue: same (paymentId, attempt) tuple only enqueues once (BullMQ jobId)
 */

const paymentFindUnique = vi.fn();
const paymentUpdate = vi.fn().mockResolvedValue({});
const chargeOffSessionForUser = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
const paymentEventCreate = vi.fn().mockResolvedValue({});
const userFindMany = vi.fn().mockResolvedValue([{ id: "mgr_1" }]);
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });

const queueAdd = vi.fn().mockResolvedValue(undefined);

// The success path now runs a CAS + balanceDue decrement inside a
// transaction (shared contract with the other capture paths).
const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const bookingFindUnique = vi.fn().mockResolvedValue({ balanceDue: 150, amountPaid: 0 });
const bookingUpdate = vi.fn().mockResolvedValue({});
const txFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    payment: { updateMany: paymentUpdateMany },
    booking: { findUnique: bookingFindUnique, update: bookingUpdate },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findUnique: paymentFindUnique, update: paymentUpdate },
    auditLog: { create: auditCreate },
    paymentEvent: { create: paymentEventCreate },
    user: { findMany: userFindMany },
    $transaction: txFn,
  },
}));

vi.mock("@/server/services/stripe-customer", () => ({
  chargeOffSessionForUser: (...args: unknown[]) => chargeOffSessionForUser(...args),
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));

vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue({ add: queueAdd }),
  registerWorker: vi.fn(),
}));

const basePaymentRow = {
  id: "pay_retry_1",
  reference: "LATE-abc",
  customerId: "cust_1",
  bookingId: "book_1",
  type: "LATE_FEE" as const,
  amount: "25.00",
  status: "PENDING" as const,
  booking: { bookingReference: "SCT-0001" },
};

beforeEach(() => {
  paymentFindUnique.mockReset();
  paymentUpdate.mockClear();
  chargeOffSessionForUser.mockReset();
  auditCreate.mockClear();
  paymentEventCreate.mockClear();
  userFindMany.mockClear();
  userFindMany.mockResolvedValue([{ id: "mgr_1" }]);
  sendNotification.mockClear();
  queueAdd.mockClear();
});

describe("capture-retry", () => {
  it("succeeded on retry → Payment SUCCEEDED", async () => {
    paymentFindUnique.mockResolvedValue(basePaymentRow);
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_ok",
      status: "succeeded",
      chargeId: "ch_ok",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { runCaptureRetry } = await import("@/server/jobs/capture-retry");
    const outcome = await runCaptureRetry({ paymentId: "pay_retry_1", attempt: 2 });
    expect(outcome).toBe("succeeded");
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_retry_1", status: "PENDING" },
        data: expect.objectContaining({ status: "SUCCEEDED", stripePaymentIntentId: "pi_ok" }),
      }),
    );
  });

  it("still-transient → requeues with attempt+1", async () => {
    paymentFindUnique.mockResolvedValue(basePaymentRow);
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_trans",
      status: "failed",
      errorCode: "processing_error",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { runCaptureRetry } = await import("@/server/jobs/capture-retry");
    const outcome = await runCaptureRetry({ paymentId: "pay_retry_1", attempt: 2 });
    expect(outcome).toBe("requeued");
    expect(queueAdd).toHaveBeenCalled();
    const callArgs = queueAdd.mock.calls[0]![1] as { attempt: number };
    expect(callArgs.attempt).toBe(3);
  });

  it("at MAX_ATTEMPTS marks FAILED + notifies manager", async () => {
    paymentFindUnique.mockResolvedValue(basePaymentRow);
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_exh",
      status: "failed",
      errorCode: "card_declined",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { runCaptureRetry } = await import("@/server/jobs/capture-retry");
    const outcome = await runCaptureRetry({ paymentId: "pay_retry_1", attempt: 5 });
    expect(outcome).toBe("exhausted");
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "mgr_1" }));
  });

  it("missing Payment row → returns 'missing' without side-effects", async () => {
    paymentFindUnique.mockResolvedValue(null);
    const { runCaptureRetry } = await import("@/server/jobs/capture-retry");
    const outcome = await runCaptureRetry({ paymentId: "pay_missing", attempt: 1 });
    expect(outcome).toBe("missing");
    expect(chargeOffSessionForUser).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("row no longer PENDING → returns 'missing' without charging", async () => {
    paymentFindUnique.mockResolvedValue({ ...basePaymentRow, status: "SUCCEEDED" });
    const { runCaptureRetry } = await import("@/server/jobs/capture-retry");
    const outcome = await runCaptureRetry({ paymentId: "pay_retry_1", attempt: 1 });
    expect(outcome).toBe("missing");
    expect(chargeOffSessionForUser).not.toHaveBeenCalled();
  });

  it("enqueueCaptureRetry uses stable jobId for idempotency", async () => {
    const { enqueueCaptureRetry } = await import("@/server/jobs/capture-retry");
    await enqueueCaptureRetry({ paymentId: "pay_retry_1", attempt: 3 });
    expect(queueAdd).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ paymentId: "pay_retry_1", attempt: 3 }),
      expect.objectContaining({ jobId: "pay_retry_1:3" }),
    );
  });
});
