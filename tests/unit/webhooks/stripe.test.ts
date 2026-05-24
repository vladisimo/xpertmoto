import { describe, it, expect, vi, beforeEach } from "vitest";

const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentFindFirst = vi.fn().mockResolvedValue(null);
const paymentFindMany = vi.fn().mockResolvedValue([]);
const bookingFindMany = vi.fn().mockResolvedValue([]);
const bookingFindUnique = vi.fn().mockResolvedValue(null);
const bookingUpdate = vi.fn().mockResolvedValue({});
const bondUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const bondFindFirst = vi.fn().mockResolvedValue(null);
const trackServerMock = vi.fn().mockResolvedValue(undefined);
const profileUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const incidentFindFirst = vi.fn().mockResolvedValue(null);
const incidentCreate = vi.fn().mockResolvedValue({ id: "incident_1" });
const userFindMany = vi.fn().mockResolvedValue([]);
const auditCreate = vi.fn().mockResolvedValue({});
const webhookEventCreate = vi.fn().mockResolvedValue({});
const webhookEventUpdate = vi.fn().mockResolvedValue({});
const txFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    payment: { updateMany: paymentUpdateMany },
    dailyRevenue: { upsert: vi.fn().mockResolvedValue({}) },
    auditLog: { create: auditCreate },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      updateMany: paymentUpdateMany,
      findFirst: paymentFindFirst,
      findMany: paymentFindMany,
    },
    booking: { findMany: bookingFindMany, findUnique: bookingFindUnique, update: bookingUpdate },
    bondLedger: { updateMany: bondUpdateMany, findFirst: bondFindFirst },
    customerProfile: { updateMany: profileUpdateMany },
    incident: { findFirst: incidentFindFirst, create: incidentCreate },
    user: { findMany: userFindMany },
    auditLog: { create: auditCreate },
    stripeWebhookEvent: { create: webhookEventCreate, update: webhookEventUpdate },
    $transaction: txFn,
  },
}));

vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] }),
}));

vi.mock("@/server/services/revenue-aggregator", () => ({
  recordRefund: vi.fn().mockResolvedValue(undefined),
  invalidateRevenueCaches: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics", () => ({
  trackServer: (...args: unknown[]) => trackServerMock(...args),
}));

let constructMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  constructWebhookEvent: (...args: unknown[]) => constructMock(...args),
}));

async function post(body: unknown) {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=sig" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  paymentUpdateMany.mockClear();
  paymentFindFirst.mockClear();
  paymentFindFirst.mockResolvedValue(null);
  paymentFindMany.mockClear();
  paymentFindMany.mockResolvedValue([]);
  bookingFindMany.mockClear();
  bookingFindMany.mockResolvedValue([]);
  bookingFindUnique.mockClear();
  bookingFindUnique.mockResolvedValue(null);
  bookingUpdate.mockClear();
  bondUpdateMany.mockClear();
  profileUpdateMany.mockClear();
  incidentFindFirst.mockClear();
  incidentFindFirst.mockResolvedValue(null);
  incidentCreate.mockClear();
  userFindMany.mockClear();
  userFindMany.mockResolvedValue([]);
  auditCreate.mockClear();
  webhookEventCreate.mockClear();
  webhookEventCreate.mockResolvedValue({});
  webhookEventUpdate.mockClear();
  bondFindFirst.mockClear();
  bondFindFirst.mockResolvedValue(null);
  trackServerMock.mockClear();
  constructMock = vi.fn();
});

describe("Stripe webhook", () => {
  it("returns 503 when Stripe isn't configured", async () => {
    constructMock.mockResolvedValue(null);
    const res = await post({});
    expect(res.status).toBe(503);
  });

  it("returns 400 when signature verification throws", async () => {
    constructMock.mockRejectedValue(new Error("bad sig"));
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("marks Payment SUCCEEDED on payment_intent.succeeded", async () => {
    constructMock.mockResolvedValue({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123", latest_charge: "ch_123" } },
    });
    const res = await post({});
    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripePaymentIntentId: "pi_123" },
        data: expect.objectContaining({ status: "SUCCEEDED", stripeChargeId: "ch_123" }),
      }),
    );
  });

  it("decrements Booking.balanceDue when a PENDING ancillary charge captures", async () => {
    // First findFirst = the pre-flip read for the balanceDue decrement;
    // second = the receipt lookup (return null to skip the receipt path).
    paymentFindFirst
      .mockResolvedValueOnce({
        bookingId: "b1",
        type: "EXTENSION",
        amount: 854.97,
        status: "PENDING",
      })
      .mockResolvedValueOnce(null);
    bookingFindUnique.mockResolvedValueOnce({ balanceDue: 904.97 });
    constructMock.mockResolvedValue({
      id: "evt_cap",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_ext", latest_charge: "ch_ext" } },
    });

    const res = await post({});
    expect(res.status).toBe(200);
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 50 },
    });
  });

  it("does not decrement balanceDue when the charge was already SUCCEEDED (redelivery)", async () => {
    paymentFindFirst
      .mockResolvedValueOnce({
        bookingId: "b1",
        type: "EXTENSION",
        amount: 854.97,
        status: "SUCCEEDED",
      })
      .mockResolvedValueOnce(null);
    constructMock.mockResolvedValue({
      id: "evt_redeliver",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_ext", latest_charge: "ch_ext" } },
    });

    await post({});
    expect(bookingFindUnique).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("does not decrement balanceDue for the deposit (BOOKING_PAYMENT)", async () => {
    paymentFindFirst
      .mockResolvedValueOnce({
        bookingId: "b1",
        type: "BOOKING_PAYMENT",
        amount: 542.72,
        status: "PENDING",
      })
      .mockResolvedValueOnce(null);
    constructMock.mockResolvedValue({
      id: "evt_deposit",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_dep", latest_charge: "ch_dep" } },
    });

    await post({});
    expect(bookingFindUnique).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("marks Payment REFUNDED on full refund", async () => {
    constructMock.mockResolvedValue({
      id: "evt_2",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_r", amount: 1000, amount_refunded: 1000 } },
    });
    await post({});
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REFUNDED" } }),
    );
  });

  it("marks Payment PARTIALLY_REFUNDED on partial refund", async () => {
    constructMock.mockResolvedValue({
      id: "evt_3",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_r", amount: 1000, amount_refunded: 400 } },
    });
    await post({});
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PARTIALLY_REFUNDED" } }),
    );
  });

  it("marks BondLedger HELD on amount_capturable_updated", async () => {
    constructMock.mockResolvedValue({
      id: "evt_4",
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: "pi_bond" } },
    });
    await post({});
    expect(bondUpdateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: "pi_bond" },
      data: { status: "HELD" },
    });
  });

  it("verifies customer licence on identity.verification_session.verified", async () => {
    constructMock.mockResolvedValue({
      id: "evt_5",
      type: "identity.verification_session.verified",
      data: { object: { metadata: { customerId: "cust_1" } } },
    });
    await post({});
    expect(profileUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "cust_1" },
        data: expect.objectContaining({ licenceVerifiedAt: expect.any(Date) }),
      }),
    );
    expect(trackServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "identity.verified", distinctId: "cust_1" }),
    );
  });

  it("emits bond.held_updated with depot group on amount_capturable_updated", async () => {
    bondFindFirst.mockResolvedValueOnce({
      bookingId: "b1",
      customerId: "cust_1",
      heldAmount: 500,
      booking: { pickupDepot: { slug: "brisbane-cbd" } },
    });
    constructMock.mockResolvedValue({
      id: "evt_bond_hold",
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: "pi_bond" } },
    });
    await post({});
    expect(trackServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "bond.held_updated",
        distinctId: "cust_1",
        groups: { depot: "brisbane-cbd" },
      }),
    );
  });

  it("emits bond.released when a held bond is cancelled", async () => {
    bondUpdateMany.mockResolvedValueOnce({ count: 1 });
    bondFindFirst.mockResolvedValueOnce({
      bookingId: "b1",
      customerId: "cust_1",
      heldAmount: 500,
      booking: { pickupDepot: { slug: "brisbane-cbd" } },
    });
    constructMock.mockResolvedValue({
      id: "evt_pi_cancel",
      type: "payment_intent.canceled",
      data: { object: { id: "pi_bond" } },
    });
    await post({});
    expect(trackServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "bond.released", distinctId: "cust_1" }),
    );
  });

  it("does not emit bond.released when no held bond was cancelled", async () => {
    bondUpdateMany.mockResolvedValueOnce({ count: 0 });
    constructMock.mockResolvedValue({
      id: "evt_pi_cancel_noop",
      type: "payment_intent.canceled",
      data: { object: { id: "pi_bond" } },
    });
    await post({});
    expect(bondFindFirst).not.toHaveBeenCalled();
    expect(trackServerMock).not.toHaveBeenCalled();
  });

  it("emits payment.failed for each failed payment with a customer", async () => {
    paymentFindMany.mockResolvedValueOnce([
      {
        id: "pay_1",
        customerId: "cust_1",
        bookingId: "b1",
        amount: 120,
        type: "EXTENSION",
        booking: { pickupDepot: { slug: "brisbane-cbd" } },
      },
    ]);
    constructMock.mockResolvedValue({
      id: "evt_fail",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_fail" } },
    });
    await post({});
    expect(trackServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "payment.failed",
        distinctId: "cust_1",
        groups: { depot: "brisbane-cbd" },
      }),
    );
  });

  it("emits payment.refunded with depot group on charge.refunded", async () => {
    paymentFindFirst.mockResolvedValueOnce({
      id: "pay_1",
      customerId: "cust_1",
      bookingId: "b1",
      booking: { depotId: "d1", pickupDepot: { slug: "brisbane-cbd" } },
    });
    constructMock.mockResolvedValue({
      id: "evt_refund_ph",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_r", amount: 1000, amount_refunded: 1000 } },
    });
    await post({});
    expect(trackServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "payment.refunded",
        distinctId: "cust_1",
        groups: { depot: "brisbane-cbd" },
      }),
    );
  });
});
