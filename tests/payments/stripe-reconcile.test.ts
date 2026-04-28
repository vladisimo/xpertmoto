import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G3 — stripe-reconcile job.
 *
 * Unit-mocked: we stub `listBalanceTransactions` to feed synthetic pages,
 * and assert:
 *   - StripeFeeLedger upsert for charge-type rows
 *   - StripeFeeLedger updateMany (payout linking) for payout-type rows
 *   - UnmatchedTransaction upsert for system-ledger-only payments
 *   - Checkpoint advance persisted via setSecret
 */

const feeUpsert = vi.fn().mockResolvedValue({});
const feeUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const feeFindMany = vi.fn().mockResolvedValue([]);
const paymentFindMany = vi.fn().mockResolvedValue([]);
const unmatchedUpsert = vi.fn().mockResolvedValue({});
const listBalanceTransactions = vi.fn();
const getSecret = vi.fn().mockResolvedValue(null);
const setSecret = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeFeeLedger: { upsert: feeUpsert, updateMany: feeUpdateMany, findMany: feeFindMany },
    payment: { findMany: paymentFindMany },
    unmatchedTransaction: { upsert: unmatchedUpsert },
  },
}));

vi.mock("@/lib/stripe", () => ({
  listBalanceTransactions: (...args: unknown[]) => listBalanceTransactions(...args),
}));

vi.mock("@/lib/integration-config", () => ({
  getSecret: (...args: unknown[]) => getSecret(...args),
  setSecret: (...args: unknown[]) => setSecret(...args),
}));

vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));

beforeEach(() => {
  feeUpsert.mockClear();
  feeUpdateMany.mockClear();
  feeFindMany.mockClear();
  feeFindMany.mockResolvedValue([]);
  paymentFindMany.mockClear();
  paymentFindMany.mockResolvedValue([]);
  unmatchedUpsert.mockClear();
  listBalanceTransactions.mockReset();
  getSecret.mockReset();
  getSecret.mockResolvedValue(null);
  setSecret.mockClear();
});

describe("stripe-reconcile", () => {
  it("upserts StripeFeeLedger for charge txns and advances checkpoint", async () => {
    const nowSec = Math.floor(Date.now() / 1000) - 3600; // within default window
    listBalanceTransactions
      .mockResolvedValueOnce({
        data: [
          {
            id: "txn_1",
            type: "charge",
            source: "ch_1",
            amount: 4900,
            fee: 160,
            net: 4740,
            currency: "aud",
            created: nowSec,
          },
        ],
        has_more: false,
        last_id: "txn_1",
      });

    const { runStripeReconcile } = await import("@/server/jobs/stripe-reconcile");
    const r = await runStripeReconcile();

    expect(r.balanceTxnsProcessed).toBe(1);
    expect(r.feeRowsUpserted).toBe(1);
    expect(feeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeChargeId: "ch_1" },
        create: expect.objectContaining({
          stripeChargeId: "ch_1",
          feeAmountCents: 160,
          netAmountCents: 4740,
        }),
      }),
    );
    expect(setSecret).toHaveBeenCalled();
  });

  it("links fee rows to a payout when payout txn seen", async () => {
    listBalanceTransactions.mockResolvedValueOnce({
      data: [
        {
          id: "txn_payout",
          type: "payout",
          source: "po_1",
          amount: -5000,
          fee: 0,
          net: -5000,
          currency: "aud",
          created: 1744100000,
        },
      ],
      has_more: false,
      last_id: "txn_payout",
    });
    feeUpdateMany.mockResolvedValueOnce({ count: 3 });

    const { runStripeReconcile } = await import("@/server/jobs/stripe-reconcile");
    const r = await runStripeReconcile();
    expect(r.payoutsLinked).toBe(3);
    expect(feeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripePayoutId: null }),
        data: expect.objectContaining({ stripePayoutId: "po_1" }),
      }),
    );
  });

  it("flags UnmatchedTransaction when DB Payment has no matching Stripe row", async () => {
    listBalanceTransactions.mockResolvedValueOnce({ data: [], has_more: false });
    // The cross-check path runs regardless.
    paymentFindMany.mockResolvedValueOnce([
      {
        id: "pay_1",
        stripeChargeId: "ch_orphan",
        amount: "49.00",
        createdAt: new Date(),
      },
    ]);
    feeFindMany.mockResolvedValueOnce([]); // no fee ledger row for ch_orphan

    const { runStripeReconcile } = await import("@/server/jobs/stripe-reconcile");
    const r = await runStripeReconcile();
    expect(r.unmatchedSystemLedger).toBe(1);
    expect(unmatchedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_externalId: { source: "SYSTEM_LEDGER", externalId: "ch_orphan" } },
      }),
    );
  });

  it("paginates through multiple pages when has_more=true", async () => {
    listBalanceTransactions
      .mockResolvedValueOnce({
        data: [
          {
            id: "t1",
            type: "charge",
            source: "ch_p1",
            amount: 100,
            fee: 10,
            net: 90,
            currency: "aud",
            created: 1744000000,
          },
        ],
        has_more: true,
        last_id: "t1",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "t2",
            type: "charge",
            source: "ch_p2",
            amount: 200,
            fee: 20,
            net: 180,
            currency: "aud",
            created: 1744000001,
          },
        ],
        has_more: false,
        last_id: "t2",
      });

    const { runStripeReconcile } = await import("@/server/jobs/stripe-reconcile");
    const r = await runStripeReconcile();
    expect(r.balanceTxnsProcessed).toBe(2);
    expect(listBalanceTransactions).toHaveBeenCalledTimes(2);
  });
});
