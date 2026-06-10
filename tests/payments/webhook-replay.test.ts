import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G1 — StripeWebhookEvent insert-then-process dedup.
 *
 * Asserts that delivering the same Stripe event id twice only processes
 * its side-effects once. The second delivery hits the PK unique constraint
 * on `StripeWebhookEvent.id` and short-circuits to a 200 response without
 * touching Payment/BondLedger/Incident tables.
 */

const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentFindFirst = vi.fn().mockResolvedValue(null);
const bondUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const profileUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const auditCreate = vi.fn().mockResolvedValue({});

// Simulates the real unique-constraint collision on a second insert with
// the same id. First call succeeds, second throws Prisma P2002.
class FakeP2002 extends Error {
  code = "P2002" as const;
  constructor() {
    super("Unique constraint failed");
    this.name = "PrismaClientKnownRequestError";
  }
}
const webhookEventCreate = vi.fn();
const webhookEventUpdate = vi.fn().mockResolvedValue({});
const webhookEventUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

vi.mock("@prisma/client", async (importActual) => {
  const actual = await importActual<typeof import("@prisma/client")>();
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      PrismaClientKnownRequestError: FakeP2002,
    },
  };
});

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

vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] }),
}));

vi.mock("@/server/services/revenue-aggregator", () => ({
  recordRefund: vi.fn().mockResolvedValue(undefined),
  invalidateRevenueCaches: vi.fn().mockResolvedValue(undefined),
}));

const constructMock = vi.fn().mockResolvedValue({
  id: "evt_replay_1",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_replay_1", latest_charge: "ch_replay_1" } },
});
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
  bondUpdateMany.mockClear();
  webhookEventCreate.mockReset();
  webhookEventUpdate.mockClear();
  webhookEventUpdateMany.mockClear();
  webhookEventUpdateMany.mockResolvedValue({ count: 1 });
});

describe("Stripe webhook replay", () => {
  it("processes the first delivery, side-effects run once", async () => {
    webhookEventCreate.mockResolvedValueOnce({ id: "evt_replay_1" });
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdateMany).toHaveBeenCalledTimes(1);
    expect(webhookEventUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_replay_1", status: { in: ["RECEIVED", "FAILED"] } },
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
  });

  it("is a no-op on duplicate delivery of a processed event, returns 200 with duplicate flag", async () => {
    webhookEventCreate.mockImplementationOnce(() => {
      throw new FakeP2002();
    });
    // The row exists in PROCESSED (or a concurrent PROCESSING) state, so the
    // status-guarded claim matches nothing.
    webhookEventUpdateMany.mockResolvedValueOnce({ count: 0 });
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; duplicate?: boolean };
    expect(body.duplicate).toBe(true);
    // Core side-effects must NOT fire on the duplicate
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(webhookEventUpdate).not.toHaveBeenCalled();
  });

  it("reprocesses a redelivery of a FAILED event (B2 — failed events must be replayable)", async () => {
    // Row already exists (first attempt failed), so the insert collides…
    webhookEventCreate.mockImplementationOnce(() => {
      throw new FakeP2002();
    });
    // …but the claim succeeds because status is FAILED.
    webhookEventUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; duplicate?: boolean };
    expect(body.duplicate).toBeUndefined();
    // Side-effects run again on the replay.
    expect(paymentUpdateMany).toHaveBeenCalledTimes(1);
    // And the row is marked PROCESSED with the stale error cleared.
    expect(webhookEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_replay_1" },
        data: expect.objectContaining({ status: "PROCESSED", errorReason: null }),
      }),
    );
  });
});
