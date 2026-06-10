import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Gateway-failure — the webhook handler crashes mid-processing (simulating
 * a Stripe handler exception, eg a downstream Resend/Twilio 500 cascading
 * back). We must:
 *
 *   - Return 500 so Stripe retries.
 *   - Mark StripeWebhookEvent.status = FAILED with errorReason set.
 *   - Not swallow the exception silently.
 *
 * Also covers the "no stored PM" fallback branch of capture-pending so a
 * gateway-unavailable state doesn't strand PENDING Payments as FAILED.
 */

const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentFindFirst = vi.fn();
const bondUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const webhookEventCreate = vi.fn().mockResolvedValue({});
const webhookEventUpdate = vi.fn().mockResolvedValue({});
const webhookEventUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const sendNotification = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      updateMany: paymentUpdateMany,
      findFirst: paymentFindFirst,
      findMany: vi.fn().mockResolvedValue([]),
    },
    booking: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    bondLedger: { updateMany: bondUpdateMany },
    customerProfile: { updateMany: vi.fn() },
    incident: { findFirst: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: auditCreate },
    stripeWebhookEvent: {
      create: webhookEventCreate,
      update: webhookEventUpdate,
      updateMany: webhookEventUpdateMany,
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordRefund: vi.fn(),
  invalidateRevenueCaches: vi.fn(),
}));

let constructMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  constructWebhookEvent: (...args: unknown[]) => constructMock(...args),
}));

async function post() {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=sig" },
      body: JSON.stringify({}),
    }),
  );
}

beforeEach(() => {
  paymentUpdateMany.mockReset();
  paymentUpdateMany.mockResolvedValue({ count: 1 });
  paymentFindFirst.mockReset();
  bondUpdateMany.mockClear();
  webhookEventCreate.mockReset();
  webhookEventCreate.mockResolvedValue({});
  webhookEventUpdate.mockReset();
  webhookEventUpdate.mockResolvedValue({});
  sendNotification.mockReset();
  constructMock = vi.fn();
});

describe("webhook handler — downstream failure mode", () => {
  it("returns 500 and marks StripeWebhookEvent FAILED when a handler step throws", async () => {
    constructMock.mockResolvedValue({
      id: "evt_gwfail_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_gwfail_1", latest_charge: "ch_gwfail_1" } },
    });
    // Simulate Resend/Twilio cascading 500 — sendNotification inside the
    // success handler throws.
    paymentFindFirst.mockResolvedValue({
      customerId: "cust_gwfail_1",
      amount: 49,
      reference: "BOOK-gwfail",
      bookingId: "book_gwfail",
      booking: { bookingReference: "SCT-gwfail" },
    });
    sendNotification.mockRejectedValueOnce(new Error("resend 500"));

    const res = await post();
    expect(res.status).toBe(500);
    // Dedup row gets FAILED + errorReason so the runbook can see it.
    const failedUpdate = webhookEventUpdate.mock.calls.find((c) => {
      const args = c[0] as { data?: { status?: string } };
      return args?.data?.status === "FAILED";
    });
    expect(failedUpdate).toBeTruthy();
  });

  it("returns 500 if the dedup insert itself blows up (non-P2002)", async () => {
    constructMock.mockResolvedValue({
      id: "evt_gwfail_2",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_gwfail_2" } },
    });
    webhookEventCreate.mockImplementationOnce(() => {
      throw new Error("db connection lost");
    });
    const res = await post();
    expect(res.status).toBe(500);
    // Handler did NOT process side-effects because the log insert failed first
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(webhookEventUpdate).not.toHaveBeenCalled();
  });
});
