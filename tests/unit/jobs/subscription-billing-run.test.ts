import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * runSubscriptionBilling — the rollover now BILLS: base fee for the new
 * period and overage for the closed period are raised as PENDING
 * SUBSCRIPTION_CHARGE Payments (collected off-session by
 * capture-pending-payments), with deterministic references so re-runs
 * can't double-bill. Usage is read from the SubscriptionUsage row (the
 * table recordSubscriptionUsage writes), not the legacy usageSnapshot.
 */

const subscriptionFindMany = vi.fn();
const subscriptionUpdate = vi.fn().mockResolvedValue({});
const usageFindUnique = vi.fn();
const usageUpsert = vi.fn().mockResolvedValue({});
const paymentCount = vi.fn();
const paymentCreate = vi.fn().mockResolvedValue({});
const txFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    subscriptionUsage: { upsert: usageUpsert },
    subscription: { update: subscriptionUpdate },
    payment: { create: paymentCreate },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findMany: subscriptionFindMany, update: subscriptionUpdate },
    subscriptionUsage: { findUnique: usageFindUnique, upsert: usageUpsert },
    payment: { count: paymentCount, create: paymentCreate },
    $transaction: txFn,
  },
}));

const sendNotification = vi.fn().mockResolvedValue({});
vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));

const periodStart = new Date("2026-06-01T00:00:00Z");
const periodEnd = new Date("2026-07-01T00:00:00Z");

function makeSub(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customerId: "cust_1",
    status: "ACTIVE",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    usageSnapshot: {},
    stripeSubscriptionId: null,
    plan: {
      name: "Commuter 125",
      priceMonthlyAud: "299.00",
      includedDays: 10,
      includedKm: 500,
      overageDayRate: "40",
      overageKmRate: "0.25",
    },
    customer: { firstName: "Vlad" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usageFindUnique.mockResolvedValue(null);
  paymentCount.mockResolvedValue(1); // SUB-<id>-1 raised at subscribe
});

describe("runSubscriptionBilling — billing side effects", () => {
  it("raises the new period's base fee as a PENDING SUBSCRIPTION_CHARGE", async () => {
    subscriptionFindMany.mockResolvedValue([makeSub()]);
    const { runSubscriptionBilling } = await import("@/server/jobs/subscription-billing");
    const r = await runSubscriptionBilling(new Date("2026-07-02T00:00:00Z"));
    expect(r.rolled).toBe(1);
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "SUB-sub_1-2",
          customerId: "cust_1",
          type: "SUBSCRIPTION_CHARGE",
          status: "PENDING",
          amount: 299,
        }),
      }),
    );
  });

  it("reads usage from the SubscriptionUsage row and bills the overage separately", async () => {
    usageFindUnique.mockResolvedValue({ daysUsed: 12, kmUsed: 600 });
    subscriptionFindMany.mockResolvedValue([makeSub()]);
    const { runSubscriptionBilling } = await import("@/server/jobs/subscription-billing");
    const r = await runSubscriptionBilling(new Date("2026-07-02T00:00:00Z"));
    expect(r.overages).toBe(1);
    // 2 days over × $40 + 100 km over × $0.25 = $105
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "SUB-OVER-sub_1-1",
          type: "SUBSCRIPTION_CHARGE",
          status: "PENDING",
          amount: 105,
        }),
      }),
    );
    // Base fee for the new period still raised alongside.
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reference: "SUB-sub_1-2", amount: 299 }),
      }),
    );
    expect(sendNotification).toHaveBeenCalled();
  });

  it("bills no base fee for TRIALING rolls", async () => {
    subscriptionFindMany.mockResolvedValue([makeSub({ status: "TRIALING" })]);
    const { runSubscriptionBilling } = await import("@/server/jobs/subscription-billing");
    await runSubscriptionBilling(new Date("2026-07-02T00:00:00Z"));
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("still rolls the period forward when there is nothing to bill", async () => {
    subscriptionFindMany.mockResolvedValue([
      makeSub({ plan: { name: "Free", priceMonthlyAud: "0", includedDays: null, includedKm: null, overageDayRate: null, overageKmRate: null } }),
    ]);
    const { runSubscriptionBilling } = await import("@/server/jobs/subscription-billing");
    const r = await runSubscriptionBilling(new Date("2026-07-02T00:00:00Z"));
    expect(r.rolled).toBe(1);
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentPeriodStart: periodEnd,
          usageSnapshot: {},
        }),
      }),
    );
  });
});
