import { describe, it, expect, vi, beforeEach } from "vitest";

const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentFindFirst = vi.fn().mockResolvedValue(null);
const paymentFindMany = vi.fn().mockResolvedValue([]);
const bookingFindMany = vi.fn().mockResolvedValue([]);
const bookingFindUnique = vi.fn().mockResolvedValue(null);
const bookingUpdate = vi.fn().mockResolvedValue({});
const bondUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const bondUpdate = vi.fn().mockResolvedValue({});
const bondFindFirst = vi.fn().mockResolvedValue(null);
const trackServerMock = vi.fn().mockResolvedValue(undefined);
const profileUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const incidentFindFirst = vi.fn().mockResolvedValue(null);
const incidentCreate = vi.fn().mockResolvedValue({ id: "incident_1" });
const userFindMany = vi.fn().mockResolvedValue([]);
const auditCreate = vi.fn().mockResolvedValue({});
const webhookEventCreate = vi.fn().mockResolvedValue({});
const webhookEventUpdate = vi.fn().mockResolvedValue({});
const webhookEventUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentAggregate = vi.fn().mockResolvedValue({ _sum: { amount: null } });
const paymentCreate = vi.fn().mockResolvedValue({ id: "pay_ext" });
const paymentEventCreate = vi.fn().mockResolvedValue({});
const giftCardFindUnique = vi.fn().mockResolvedValue(null);
const incidentUpdate = vi.fn().mockResolvedValue({});
const txFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    payment: { updateMany: paymentUpdateMany, create: paymentCreate },
    // The succeeded handler applies the balanceDue decrement on the same tx
    // as the status flip — route the tx's booking model to the same spies.
    booking: { findUnique: bookingFindUnique, update: bookingUpdate },
    dailyRevenue: { upsert: vi.fn().mockResolvedValue({}) },
    auditLog: { create: auditCreate },
    paymentEvent: { create: paymentEventCreate },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      updateMany: paymentUpdateMany,
      findFirst: paymentFindFirst,
      findMany: paymentFindMany,
      aggregate: paymentAggregate,
    },
    booking: { findMany: bookingFindMany, findUnique: bookingFindUnique, update: bookingUpdate },
    bondLedger: { updateMany: bondUpdateMany, update: bondUpdate, findFirst: bondFindFirst },
    customerProfile: { updateMany: profileUpdateMany },
    giftCard: { findUnique: giftCardFindUnique },
    incident: { findFirst: incidentFindFirst, create: incidentCreate, update: incidentUpdate },
    paymentEvent: { create: paymentEventCreate },
    user: { findMany: userFindMany },
    auditLog: { create: auditCreate },
    stripeWebhookEvent: {
      create: webhookEventCreate,
      update: webhookEventUpdate,
      updateMany: webhookEventUpdateMany,
    },
    $transaction: txFn,
  },
}));

const loggerWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
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

const confirmBookingPaymentMock = vi.fn();
vi.mock("@/server/services/booking-confirmation", () => ({
  confirmBookingPayment: (...a: unknown[]) => confirmBookingPaymentMock(...a),
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
  bondUpdate.mockClear();
  bondUpdate.mockResolvedValue({});
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
  loggerWarn.mockClear();
  confirmBookingPaymentMock.mockClear();
  confirmBookingPaymentMock.mockResolvedValue({
    booking: { id: "b1" },
    alreadyConfirmed: false,
  });
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
        where: {
          stripePaymentIntentId: "pi_123",
          status: { notIn: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] },
        },
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
    bookingFindUnique.mockResolvedValueOnce({ balanceDue: 904.97, amountPaid: 100 });
    constructMock.mockResolvedValue({
      id: "evt_cap",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_ext", latest_charge: "ch_ext" } },
    });

    const res = await post({});
    expect(res.status).toBe(200);
    // balanceDue 904.97 − 854.97 = 50; amountPaid 100 + 854.97 = 954.97.
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: 50, amountPaid: 954.97 },
    });
  });

  it("fails the event (500) when the balanceDue decrement throws, so Stripe retries", async () => {
    paymentFindFirst.mockResolvedValueOnce({
      bookingId: "b1",
      type: "EXTENSION",
      amount: 100,
      status: "PENDING",
    });
    // The decrement's booking read blows up mid-transaction — the flip must
    // roll back with it (shared tx) and the delivery must NOT be PROCESSED.
    bookingFindUnique.mockRejectedValueOnce(new Error("db connection reset"));
    constructMock.mockResolvedValue({
      id: "evt_torn",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_torn", latest_charge: "ch_torn" } },
    });

    const res = await post({});
    expect(res.status).toBe(500);
    expect(webhookEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_torn" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
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
    bondFindFirst.mockResolvedValueOnce({
      id: "bond_1",
      bookingId: "b1",
      customerId: "cust_1",
      heldAmount: 500,
      capturedAmount: 0,
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

  it("releases the full held amount (not 0) so the terminal-state CHECK holds", async () => {
    // Regression: the canceled handler used to hardcode releasedAmount: 0,
    // which violates BondLedger_terminal_state_chk (captured + released must
    // equal held for a RELEASED row). Release must net out the held amount.
    bondFindFirst.mockResolvedValueOnce({
      id: "bond_1",
      bookingId: "b1",
      customerId: "cust_1",
      heldAmount: 300,
      capturedAmount: 0,
      booking: { pickupDepot: { slug: "brisbane-cbd" } },
    });
    constructMock.mockResolvedValue({
      id: "evt_pi_cancel_amount",
      type: "payment_intent.canceled",
      data: { object: { id: "pi_bond" } },
    });
    await post({});
    expect(bondUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bond_1" },
        data: expect.objectContaining({ status: "RELEASED" }),
      }),
    );
    const releasedArg = bondUpdate.mock.calls[0]?.[0]?.data?.releasedAmount;
    expect(Number(releasedArg)).toBe(300);
  });

  it("does not emit bond.released when no held bond was cancelled", async () => {
    bondFindFirst.mockResolvedValueOnce(null);
    constructMock.mockResolvedValue({
      id: "evt_pi_cancel_noop",
      type: "payment_intent.canceled",
      data: { object: { id: "pi_bond" } },
    });
    await post({});
    expect(bondUpdate).not.toHaveBeenCalled();
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

describe("Stripe webhook — charge.refund.updated deferred settlement", () => {
  function refundUpdatedEvent(object: Record<string, unknown>) {
    return {
      id: "evt_refund_upd",
      type: "charge.refund.updated",
      data: { object },
    };
  }

  it("flips a cancellation-created PENDING refund WITHOUT a second amountPaid decrement", async () => {
    // booking-cancellation.ts decrements amountPaid at creation even for
    // PENDING rows (any Stripe-accepted card slice counts as settled), so
    // the webhook must only flip the status for non-SWAP-REF rows.
    paymentFindFirst.mockResolvedValueOnce({
      id: "pay_cancel_ref",
      bookingId: "b1",
      amount: 110,
      reference: "REF-1723",
    });
    constructMock.mockResolvedValue(
      refundUpdatedEvent({ id: "re_1", status: "succeeded", payment_intent: "pi_1" }),
    );

    const res = await post({});

    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: "pay_cancel_ref", status: "PENDING" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    expect(bookingFindUnique).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("flips a SWAP-REF row and applies the single, clamped deferred decrement", async () => {
    paymentFindFirst.mockResolvedValueOnce({
      id: "pay_swap_ref",
      bookingId: "b1",
      amount: 110,
      reference: "SWAP-REF-swapd-1",
    });
    // amountPaid 90 − 110 must clamp to 0, never go negative.
    bookingFindUnique.mockResolvedValueOnce({ amountPaid: 90 });
    constructMock.mockResolvedValue(
      refundUpdatedEvent({ id: "re_2", status: "succeeded", payment_intent: null }),
    );

    const res = await post({});

    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: "pay_swap_ref", status: "PENDING" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    expect(bookingUpdate).toHaveBeenCalledTimes(1);
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { amountPaid: 0 },
    });
  });

  it("prefers the refund-id match over the PI when both would hit", async () => {
    // Two PENDING refunds share pi_shared; the row carrying re_3 in
    // stripeChargeId must win and the PI fallback must never run.
    paymentFindFirst.mockResolvedValueOnce({
      id: "pay_by_refund_id",
      bookingId: "b1",
      amount: 50,
      reference: "SWAP-REF-swapd-2",
    });
    bookingFindUnique.mockResolvedValueOnce({ amountPaid: 200 });
    constructMock.mockResolvedValue(
      refundUpdatedEvent({ id: "re_3", status: "succeeded", payment_intent: "pi_shared" }),
    );

    await post({});

    expect(paymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripeChargeId: "re_3", status: "PENDING" }),
      }),
    );
    expect(paymentFindMany).not.toHaveBeenCalled();
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay_by_refund_id", status: "PENDING" } }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { amountPaid: 150 },
    });
  });

  it("falls back to an unambiguous PI-only match", async () => {
    paymentFindFirst.mockResolvedValueOnce(null);
    paymentFindMany.mockResolvedValueOnce([
      { id: "pay_pi_only", bookingId: "b1", amount: 30, reference: "SWAP-REF-swapd-3" },
    ]);
    bookingFindUnique.mockResolvedValueOnce({ amountPaid: 100 });
    constructMock.mockResolvedValue(
      refundUpdatedEvent({ id: "re_5", status: "succeeded", payment_intent: "pi_solo" }),
    );

    await post({});

    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripePaymentIntentId: "pi_solo" }),
      }),
    );
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay_pi_only", status: "PENDING" } }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { amountPaid: 70 },
    });
  });

  it("skips settlement with a log when only an ambiguous PI match exists", async () => {
    paymentFindFirst.mockResolvedValueOnce(null);
    paymentFindMany.mockResolvedValueOnce([
      { id: "pay_a", bookingId: "b1", amount: 10, reference: "SWAP-REF-a" },
      { id: "pay_b", bookingId: "b1", amount: 20, reference: "REF-b" },
    ]);
    constructMock.mockResolvedValue(
      refundUpdatedEvent({ id: "re_4", status: "succeeded", payment_intent: "pi_shared" }),
    );

    const res = await post({});

    expect(res.status).toBe(200);
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: "re_4", paymentIntentId: "pi_shared" }),
      expect.stringContaining("skipping settlement"),
    );
  });
});

describe("Stripe webhook — C1 paid-booking rescue", () => {
  function succeededEvent(metadata: Record<string, string>, extra: Record<string, unknown> = {}) {
    return {
      id: "evt_rescue",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123", latest_charge: "ch_123", metadata, ...extra } },
    };
  }

  it("confirms a PENDING_PAYMENT booking whose client never confirmed", async () => {
    bookingFindUnique.mockResolvedValueOnce({
      status: "PENDING_PAYMENT",
      bookingReference: "XPM-1",
    });
    constructMock.mockResolvedValue(succeededEvent({ bookingId: "b1" }));

    const res = await post({});

    expect(res.status).toBe(200);
    expect(confirmBookingPaymentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: "b1",
        paymentIntentId: "pi_123",
        source: "stripe-webhook",
      }),
    );
  });

  it("does not attempt the rescue for bond holds", async () => {
    constructMock.mockResolvedValue(
      succeededEvent(
        { bookingId: "b1", type: "bond" },
        { capture_method: "manual", amount: 5000, amount_received: 0 },
      ),
    );

    await post({});

    expect(confirmBookingPaymentMock).not.toHaveBeenCalled();
  });

  it("does not touch an already-CONFIRMED booking", async () => {
    bookingFindUnique.mockResolvedValueOnce({
      status: "CONFIRMED",
      bookingReference: "XPM-1",
    });
    constructMock.mockResolvedValue(succeededEvent({ bookingId: "b1" }));

    await post({});

    expect(confirmBookingPaymentMock).not.toHaveBeenCalled();
  });

  it("still acknowledges the event (200) when the rescue confirm fails", async () => {
    bookingFindUnique.mockResolvedValueOnce({
      status: "PENDING_PAYMENT",
      bookingReference: "XPM-1",
    });
    confirmBookingPaymentMock.mockRejectedValueOnce(new Error("lock timeout"));
    constructMock.mockResolvedValue(succeededEvent({ bookingId: "b1" }));

    const res = await post({});

    expect(res.status).toBe(200);
  });

  it("links the bond PI to the booking's ledger when no row matches by PI id", async () => {
    bondUpdateMany.mockResolvedValueOnce({ count: 0 });
    constructMock.mockResolvedValue({
      id: "evt_bond_link",
      type: "payment_intent.amount_capturable_updated",
      data: {
        object: {
          id: "pi_bond_9",
          metadata: { bookingId: "b1", type: "bond" },
        },
      },
    });

    await post({});

    expect(bondUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { bookingId: "b1", stripePaymentIntentId: null },
        data: { stripePaymentIntentId: "pi_bond_9", status: "HELD" },
      }),
    );
  });
});
