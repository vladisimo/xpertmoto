import { describe, expect, it, vi, beforeEach } from "vitest";

const listBalanceTransactionsMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  listBalanceTransactions: (...a: unknown[]) => listBalanceTransactionsMock(...a),
}));

const getSecretMock = vi.fn();
const setSecretMock = vi.fn();
vi.mock("@/lib/integration-config", () => ({
  getSecret: (...a: unknown[]) => getSecretMock(...a),
  setSecret: (...a: unknown[]) => setSecretMock(...a),
}));

// The scheduler wiring is irrelevant to runStripeReconcile.
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn(),
  monitorCron: vi.fn(),
  registerWorker: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    stripeFeeLedger: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    payment: { findMany: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    unmatchedTransaction: {
      findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { runStripeReconcile } from "../../../src/server/jobs/stripe-reconcile";

const window = { windowStart: new Date("2026-04-30"), windowEnd: new Date("2026-05-25") };

beforeEach(() => {
  vi.clearAllMocks();
  listBalanceTransactionsMock.mockResolvedValue({ data: [], has_more: false });
  prismaMock.stripeFeeLedger.upsert.mockResolvedValue({});
  prismaMock.stripeFeeLedger.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.stripeFeeLedger.findMany.mockResolvedValue([]);
  prismaMock.payment.findMany.mockResolvedValue([]);
  prismaMock.payment.update.mockResolvedValue({});
  prismaMock.unmatchedTransaction.upsert.mockResolvedValue({});
  prismaMock.unmatchedTransaction.updateMany.mockResolvedValue({ count: 0 });
});

describe("runStripeReconcile", () => {
  it("reconciles an explicit window without advancing the checkpoint", async () => {
    listBalanceTransactionsMock.mockResolvedValue({
      data: [
        { id: "bt_1", type: "charge", source: "ch_1", amount: 14750, fee: 50, net: 14700, currency: "aud", created: 1700000000 },
      ],
      has_more: false,
    });

    await runStripeReconcile(window);

    // Explicit window must not read or write the nightly checkpoint.
    expect(getSecretMock).not.toHaveBeenCalled();
    expect(setSecretMock).not.toHaveBeenCalled();
    expect(prismaMock.stripeFeeLedger.upsert).toHaveBeenCalled();
  });

  it("flags a Stripe charge with no matching Payment (STRIPE_CHARGE direction)", async () => {
    prismaMock.stripeFeeLedger.findMany.mockResolvedValue([
      { stripeChargeId: "ch_orphan", stripePaymentIntentId: "pi_orphan", feeType: "stripe_fee", netAmountCents: 9850, feeAmountCents: 150, balanceTxnCreatedAt: new Date("2026-05-10") },
    ]);
    prismaMock.payment.findMany.mockResolvedValue([]); // no Payment by charge id or PI

    const result = await runStripeReconcile(window);

    expect(result.unmatchedStripeCharges).toBe(1);
    expect(prismaMock.unmatchedTransaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_externalId: { source: "STRIPE_CHARGE", externalId: "ch_orphan" } },
        create: expect.objectContaining({ source: "STRIPE_CHARGE", amountCents: 10000 }),
      }),
    );
  });

  it("backfills the charge id and resolves the discrepancy when matched by payment intent", async () => {
    prismaMock.stripeFeeLedger.findMany.mockResolvedValue([
      { stripeChargeId: "ch_1", stripePaymentIntentId: "pi_1", feeType: "stripe_fee", netAmountCents: 17200, feeAmountCents: 50, balanceTxnCreatedAt: new Date("2026-05-10") },
    ]);
    // Payment carries the PI but its charge id was never backfilled.
    prismaMock.payment.findMany.mockImplementation((args: { where?: { stripeChargeId?: unknown } }) =>
      // The SYSTEM_LEDGER pass (status SUCCEEDED + stripeChargeId not null) finds nothing;
      // the STRIPE_CHARGE pass (OR on charge id / PI) finds the PI-only payment.
      Promise.resolve(
        args.where && "stripeChargeId" in args.where && args.where.stripeChargeId
          ? []
          : [{ id: "pay1", stripeChargeId: null, stripePaymentIntentId: "pi_1" }],
      ),
    );

    const result = await runStripeReconcile(window);

    expect(result.unmatchedStripeCharges).toBe(0);
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { stripeChargeId: "ch_1" },
    });
    // Any stale STRIPE_CHARGE discrepancy for this charge is auto-resolved.
    expect(prismaMock.unmatchedTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: "STRIPE_CHARGE", externalId: "ch_1", resolvedAt: null }),
      }),
    );
    expect(prismaMock.unmatchedTransaction.upsert).not.toHaveBeenCalled();
  });
});
