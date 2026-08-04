import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Happy path — Stripe events walk a Booking from PENDING_PAYMENT to
 * COMPLETED without manual intervention.
 *
 * This is a unit-mocked happy path (no real DB). The real end-to-end
 * test lives in tests/e2e/booking-payment.spec.ts and hits Stripe test
 * mode. Here we verify the sequence of webhook-driven state changes our
 * code depends on:
 *
 *   payment_intent.succeeded        → Payment SUCCEEDED
 *   payment_intent.amount_capturable_updated → BondLedger HELD
 *   charge.refunded (full)          → Payment REFUNDED, revenue recorded
 */

const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentFindFirst = vi.fn().mockResolvedValue(null);
const bondUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const recordRefund = vi.fn().mockResolvedValue(undefined);
const invalidateRevenueCaches = vi.fn().mockResolvedValue(undefined);
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
const auditCreate = vi.fn().mockResolvedValue({});
const webhookEventCreate = vi.fn().mockResolvedValue({});
const webhookEventUpdate = vi.fn().mockResolvedValue({});
const webhookEventUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      updateMany: paymentUpdateMany,
      findFirst: paymentFindFirst,
      findMany: vi.fn().mockResolvedValue([]),
      // External-refund delta detection: report the refund as fully covered
      // by in-app REFUND rows so no REF-EXT row is booked in this scenario.
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 49 } }),
      create: vi.fn().mockResolvedValue({ id: "pay_created" }),
    },
    booking: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    // payment_intent.succeeded now checks for a gift-card purchase PI.
    giftCard: { findUnique: vi.fn().mockResolvedValue(null) },
    bondLedger: { updateMany: bondUpdateMany, findFirst: vi.fn().mockResolvedValue(null) },
    customerProfile: { updateMany: vi.fn() },
    incident: { findFirst: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: auditCreate },
    stripeWebhookEvent: {
      create: webhookEventCreate,
      update: webhookEventUpdate,
      updateMany: webhookEventUpdateMany,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        payment: { updateMany: paymentUpdateMany },
        dailyRevenue: { upsert: vi.fn().mockResolvedValue({}) },
        auditLog: { create: auditCreate },
      }),
    ),
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordRefund,
  invalidateRevenueCaches,
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
  paymentUpdateMany.mockClear();
  paymentFindFirst.mockClear();
  paymentFindFirst.mockResolvedValue(null);
  bondUpdateMany.mockClear();
  recordRefund.mockClear();
  invalidateRevenueCaches.mockClear();
  sendNotification.mockClear();
  webhookEventCreate.mockClear();
  webhookEventCreate.mockResolvedValue({});
  webhookEventUpdate.mockClear();
  constructMock = vi.fn();
});

describe("happy path — Stripe event sequence", () => {
  it("step 1: payment_intent.succeeded moves Payment to SUCCEEDED", async () => {
    constructMock.mockResolvedValue({
      id: "evt_hp_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_hp_1", latest_charge: "ch_hp_1" } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stripePaymentIntentId: "pi_hp_1",
          status: { notIn: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] },
        },
        data: expect.objectContaining({ status: "SUCCEEDED", stripeChargeId: "ch_hp_1" }),
      }),
    );
  });

  it("step 2: amount_capturable_updated keeps the bond HELD (ready to capture)", async () => {
    constructMock.mockResolvedValue({
      id: "evt_hp_2",
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: "pi_bond_hp" } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(bondUpdateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: "pi_bond_hp" },
      data: { status: "HELD" },
    });
  });

  it("step 3: charge.refunded fully refunds and records revenue reversal", async () => {
    constructMock.mockResolvedValue({
      id: "evt_hp_3",
      type: "charge.refunded",
      data: {
        object: {
          payment_intent: "pi_hp_1",
          amount: 4900,
          amount_refunded: 4900,
        },
      },
    });
    paymentFindFirst.mockResolvedValueOnce({ booking: { depotId: "depot_hp" } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REFUNDED" } }),
    );
    expect(recordRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ depotId: "depot_hp", amount: 49 }),
    );
    expect(invalidateRevenueCaches).toHaveBeenCalledWith("depot_hp");
  });

  it("step 1 writes StripeWebhookEvent log entry (dedup substrate)", async () => {
    constructMock.mockResolvedValue({
      id: "evt_hp_log",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_log_1" } },
    });
    await post();
    expect(webhookEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "evt_hp_log", type: "payment_intent.succeeded" }),
      }),
    );
    expect(webhookEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_hp_log" },
        data: expect.objectContaining({ status: "PROCESSED" }),
      }),
    );
  });
});
