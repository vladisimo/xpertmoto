import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G2 — Dispute / chargeback workflow.
 *
 * `charge.dispute.created` must:
 *   1. Flip the matching Payment to DISPUTED.
 *   2. Create a CHARGEBACK Incident (`CBK-<disputeId>`) if the booking has
 *      a vehicle, idempotent via the unique incidentNumber.
 *   3. Notify every MANAGER / ADMIN / SUPER_ADMIN.
 *   4. Write an audit row via writePaymentAudit.
 *
 * When no vehicle can be resolved (edge case), the workflow still notifies
 * managers but skips Incident creation — confirmed here so we don't block
 * post-lease infringement disputes.
 */

const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentFindFirst = vi.fn();
const bondUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const profileUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const incidentFindFirst = vi.fn().mockResolvedValue(null);
const incidentCreate = vi.fn().mockResolvedValue({ id: "incident_created_1" });
const userFindMany = vi.fn();
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
const auditCreate = vi.fn().mockResolvedValue({});
const webhookEventCreate = vi.fn().mockResolvedValue({ id: "evt_dispute_1" });
const webhookEventUpdate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      updateMany: paymentUpdateMany,
      findFirst: paymentFindFirst,
      findMany: vi.fn().mockResolvedValue([]),
    },
    booking: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    bondLedger: { updateMany: bondUpdateMany },
    customerProfile: { updateMany: profileUpdateMany },
    incident: { findFirst: incidentFindFirst, create: incidentCreate },
    user: { findMany: userFindMany },
    auditLog: { create: auditCreate },
    stripeWebhookEvent: { create: webhookEventCreate, update: webhookEventUpdate },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordRefund: vi.fn(),
  invalidateRevenueCaches: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  constructWebhookEvent: (...args: unknown[]) => constructMock(...args),
}));

let constructMock = vi.fn();

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
  paymentFindFirst.mockReset();
  incidentFindFirst.mockReset();
  incidentFindFirst.mockResolvedValue(null);
  incidentCreate.mockClear();
  userFindMany.mockReset();
  sendNotification.mockClear();
  auditCreate.mockClear();
  webhookEventCreate.mockClear();
  webhookEventCreate.mockResolvedValue({ id: "evt_dispute_1" });
  webhookEventUpdate.mockClear();
  constructMock = vi.fn();
});

describe("Stripe webhook — charge.dispute.created", () => {
  it("creates Incident and notifies managers when vehicleId is resolvable", async () => {
    constructMock.mockResolvedValue({
      id: "evt_dispute_1",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_1",
          payment_intent: "pi_disputed_1",
          reason: "fraudulent",
          amount: 4900,
        },
      },
    });
    paymentFindFirst.mockResolvedValue({
      id: "pay_1",
      bookingId: "book_1",
      customerId: "cust_1",
      amount: 49,
      booking: { vehicleId: "veh_1", depotId: "depot_1", bookingReference: "SCT-20260418-0001" },
    });
    userFindMany.mockResolvedValue([{ id: "mgr_1" }, { id: "mgr_2" }]);

    const res = await post();
    expect(res.status).toBe(200);

    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripePaymentIntentId: "pi_disputed_1" },
        data: { status: "DISPUTED" },
      }),
    );
    expect(incidentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentNumber: "CBK-dp_1",
          type: "OTHER",
          vehicleId: "veh_1",
          bookingId: "book_1",
          customerId: "cust_1",
        }),
      }),
    );
    // Two managers → two emails
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "mgr_1",
        type: "INCIDENT_REPORTED",
        channels: expect.arrayContaining(["EMAIL", "IN_APP"]),
      }),
    );
    expect(auditCreate).toHaveBeenCalled();
  });

  it("skips Incident creation when no vehicle is resolvable but still notifies", async () => {
    constructMock.mockResolvedValue({
      id: "evt_dispute_2",
      type: "charge.dispute.created",
      data: {
        object: { id: "dp_2", payment_intent: "pi_postlease", reason: "general", amount: 2500 },
      },
    });
    // Payment exists but its booking has no vehicle (e.g. decommissioned
    // post-return infringement dispute).
    paymentFindFirst.mockResolvedValue({
      id: "pay_2",
      bookingId: "book_2",
      customerId: "cust_2",
      amount: 25,
      booking: { vehicleId: null, depotId: "depot_2", bookingReference: "SCT-20260101-0099" },
    });
    userFindMany.mockResolvedValue([{ id: "mgr_1" }]);

    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
    // Still notify — the runbook depends on it to begin investigation.
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a replay of the same dispute does not double-create", async () => {
    constructMock.mockResolvedValue({
      id: "evt_dispute_3",
      type: "charge.dispute.created",
      data: {
        object: { id: "dp_3", payment_intent: "pi_3", reason: "duplicate", amount: 1000 },
      },
    });
    paymentFindFirst.mockResolvedValue({
      id: "pay_3",
      bookingId: "book_3",
      customerId: "cust_3",
      amount: 10,
      booking: { vehicleId: "veh_3", depotId: "depot_3", bookingReference: "SCT-20260418-0003" },
    });
    // Simulate existing incident for the same dispute id.
    incidentFindFirst.mockResolvedValue({ id: "existing_incident" });
    userFindMany.mockResolvedValue([{ id: "mgr_1" }]);

    await post();
    expect(incidentCreate).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
