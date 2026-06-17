import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the infringement-charge helper. The Prisma client is
 * mocked so these tests focus on the data-shape and transaction
 * orchestration. End-to-end coverage of the e-toll auto-sync wiring
 * lives in the integration test suite.
 */

const paymentFindUnique = vi.fn();
const paymentCreate = vi.fn();
const bookingFindUnique = vi.fn();
const bookingUpdate = vi.fn();
const infringementFindUnique = vi.fn();
const infringementUpdate = vi.fn();

const $transaction = vi.fn(
  async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      payment: { create: paymentCreate },
      booking: { findUnique: bookingFindUnique, update: bookingUpdate },
      infringement: {
        findUnique: infringementFindUnique,
        update: infringementUpdate,
      },
    }),
);

const fakePrisma = {
  $transaction: (cb: (tx: unknown) => Promise<unknown>) => $transaction(cb),
  payment: {
    findUnique: (...args: unknown[]) => paymentFindUnique(...args),
    create: (...args: unknown[]) => paymentCreate(...args),
  },
  booking: {
    findUnique: (...args: unknown[]) => bookingFindUnique(...args),
    update: (...args: unknown[]) => bookingUpdate(...args),
  },
  infringement: {
    findUnique: (...args: unknown[]) => infringementFindUnique(...args),
    update: (...args: unknown[]) => infringementUpdate(...args),
  },
} as unknown as import("@prisma/client").PrismaClient;

const tryIssueAdjustmentForBooking = vi.fn(async (_args: unknown) => undefined);

vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (args: unknown) =>
    tryIssueAdjustmentForBooking(args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  applyAdminFeeOnlyCharge,
  applyInfringementRecoveryCharge,
  markInfringementPaidOnCapture,
  revertInfringementOnVoid,
} from "@/server/services/infringement-charge";

beforeEach(() => {
  paymentFindUnique.mockReset();
  paymentCreate.mockReset();
  bookingFindUnique.mockReset();
  bookingUpdate.mockReset();
  infringementFindUnique.mockReset();
  infringementUpdate.mockReset();
  tryIssueAdjustmentForBooking.mockClear();
  $transaction.mockClear();
});

const baseInf = {
  id: "inf_1",
  referenceNumber: "ref-001",
  type: "TOLL",
  issuer: "NSW E-Toll",
  amount: 4.5,
  adminFee: 0,
  bookingId: "bk_1",
  customerId: "cust_1",
};

describe("applyInfringementRecoveryCharge", () => {
  it("creates a Payment + increments booking.balanceDue + emits AdjustmentNote", async () => {
    paymentFindUnique.mockResolvedValueOnce(null);
    paymentCreate.mockResolvedValueOnce({ id: "pmt_1" });
    bookingFindUnique.mockResolvedValueOnce({ balanceDue: 10 });
    bookingUpdate.mockResolvedValueOnce({});

    const result = await applyInfringementRecoveryCharge({
      prisma: fakePrisma,
      infringement: baseInf,
    });

    expect(result).toEqual({
      paymentId: "pmt_1",
      alreadyExisted: false,
      amount: 4.5,
    });
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "INFR-ref-001",
          type: "INFRINGEMENT_RECOVERY",
          status: "PENDING",
          amount: 4.5,
        }),
      }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: { balanceDue: 14.5 },
    });
    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledTimes(1);
    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "bk_1",
        type: "INCREASE",
        reason: "INFRINGEMENT",
      }),
    );
  });

  it("is idempotent on a duplicate Payment.reference", async () => {
    paymentFindUnique.mockResolvedValueOnce({ id: "pmt_existing" });

    const result = await applyInfringementRecoveryCharge({
      prisma: fakePrisma,
      infringement: baseInf,
    });

    expect(result).toEqual({
      paymentId: "pmt_existing",
      alreadyExisted: true,
      amount: 4.5,
    });
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(tryIssueAdjustmentForBooking).not.toHaveBeenCalled();
  });

  it("includes admin fee in line items + total", async () => {
    paymentFindUnique.mockResolvedValueOnce(null);
    paymentCreate.mockResolvedValueOnce({ id: "pmt_2" });
    bookingFindUnique.mockResolvedValueOnce({ balanceDue: 0 });
    bookingUpdate.mockResolvedValueOnce({});

    await applyInfringementRecoveryCharge({
      prisma: fakePrisma,
      infringement: { ...baseInf, amount: 10, adminFee: 5 },
    });

    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 15 }),
      }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: { balanceDue: 15 },
    });
    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        lineItems: [
          expect.objectContaining({ unitPrice: 10 }),
          expect.objectContaining({
            description: "Administration fee",
            unitPrice: 5,
          }),
        ],
      }),
    );
  });

  it("skips booking + adjustment side-effects when bookingId is null", async () => {
    paymentFindUnique.mockResolvedValueOnce(null);
    paymentCreate.mockResolvedValueOnce({ id: "pmt_3" });

    const result = await applyInfringementRecoveryCharge({
      prisma: fakePrisma,
      infringement: { ...baseInf, bookingId: null },
    });

    expect(result.alreadyExisted).toBe(false);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(bookingFindUnique).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(tryIssueAdjustmentForBooking).not.toHaveBeenCalled();
  });

  it("throws when called without a customer", async () => {
    await expect(
      applyInfringementRecoveryCharge({
        prisma: fakePrisma,
        infringement: { ...baseInf, customerId: null },
      }),
    ).rejects.toThrow(/no customerId/);
  });

  it("throws when total is non-positive", async () => {
    await expect(
      applyInfringementRecoveryCharge({
        prisma: fakePrisma,
        infringement: { ...baseInf, amount: 0, adminFee: 0 },
      }),
    ).rejects.toThrow(/non-positive total/);
  });
});

describe("applyAdminFeeOnlyCharge", () => {
  it("charges the admin fee only (no issuer line) + increments balanceDue", async () => {
    paymentFindUnique.mockResolvedValueOnce(null);
    paymentCreate.mockResolvedValueOnce({ id: "pmt_af" });
    bookingFindUnique.mockResolvedValueOnce({ balanceDue: 20 });
    bookingUpdate.mockResolvedValueOnce({});

    const result = await applyAdminFeeOnlyCharge({
      prisma: fakePrisma,
      infringement: { ...baseInf, type: "SPEEDING", adminFee: 55 },
    });

    expect(result).toEqual({ paymentId: "pmt_af", alreadyExisted: false, amount: 55 });
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "INFR-ref-001",
          type: "INFRINGEMENT_RECOVERY",
          amount: 55,
        }),
      }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: { balanceDue: 75 },
    });
    // Only the administration fee line — never the issuer fine.
    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        lineItems: [
          expect.objectContaining({ description: "Administration fee — driver nomination", unitPrice: 55 }),
        ],
      }),
    );
  });

  it("is idempotent on a duplicate Payment.reference", async () => {
    paymentFindUnique.mockResolvedValueOnce({ id: "pmt_dupe" });
    const result = await applyAdminFeeOnlyCharge({
      prisma: fakePrisma,
      infringement: { ...baseInf, adminFee: 55 },
    });
    expect(result).toEqual({ paymentId: "pmt_dupe", alreadyExisted: true, amount: 55 });
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("throws when the admin fee is non-positive", async () => {
    await expect(
      applyAdminFeeOnlyCharge({
        prisma: fakePrisma,
        infringement: { ...baseInf, adminFee: 0 },
      }),
    ).rejects.toThrow(/non-positive admin fee/);
  });

  it("throws when called without a customer", async () => {
    await expect(
      applyAdminFeeOnlyCharge({
        prisma: fakePrisma,
        infringement: { ...baseInf, adminFee: 55, customerId: null },
      }),
    ).rejects.toThrow(/no customerId/);
  });
});

describe("markInfringementPaidOnCapture", () => {
  it("flips CUSTOMER_CHARGED → PAID for an INFR-prefixed reference", async () => {
    infringementFindUnique.mockResolvedValueOnce({
      id: "inf_1",
      status: "CUSTOMER_CHARGED",
    });

    await markInfringementPaidOnCapture(fakePrisma, "INFR-ref-001");

    expect(infringementUpdate).toHaveBeenCalledWith({
      where: { id: "inf_1" },
      data: { status: "PAID" },
    });
  });

  it("ignores non-infringement payment references", async () => {
    await markInfringementPaidOnCapture(fakePrisma, "MAN-12345");
    expect(infringementFindUnique).not.toHaveBeenCalled();
    expect(infringementUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when infringement is already PAID", async () => {
    infringementFindUnique.mockResolvedValueOnce({
      id: "inf_2",
      status: "PAID",
    });

    await markInfringementPaidOnCapture(fakePrisma, "INFR-ref-002");
    expect(infringementUpdate).not.toHaveBeenCalled();
  });
});

describe("revertInfringementOnVoid", () => {
  it("steps CUSTOMER_CHARGED back to NOMINATED when nominatedAt is set", async () => {
    infringementFindUnique.mockResolvedValueOnce({
      id: "inf_1",
      status: "CUSTOMER_CHARGED",
      customerId: "cust_1",
      nominatedAt: new Date("2026-04-20"),
    });

    await revertInfringementOnVoid(fakePrisma, "INFR-ref-001");

    expect(infringementUpdate).toHaveBeenCalledWith({
      where: { id: "inf_1" },
      data: { status: "NOMINATED" },
    });
  });

  it("steps CUSTOMER_CHARGED back to RECEIVED when nominatedAt is null", async () => {
    infringementFindUnique.mockResolvedValueOnce({
      id: "inf_1",
      status: "CUSTOMER_CHARGED",
      customerId: "cust_1",
      nominatedAt: null,
    });

    await revertInfringementOnVoid(fakePrisma, "INFR-ref-001");

    expect(infringementUpdate).toHaveBeenCalledWith({
      where: { id: "inf_1" },
      data: { status: "RECEIVED" },
    });
  });

  it("ignores non-infringement payment references", async () => {
    await revertInfringementOnVoid(fakePrisma, "BOND-CAP-12345");
    expect(infringementFindUnique).not.toHaveBeenCalled();
  });

  it("is a no-op when infringement is in a non-CUSTOMER_CHARGED state", async () => {
    infringementFindUnique.mockResolvedValueOnce({
      id: "inf_1",
      status: "NOMINATED",
      customerId: "cust_1",
      nominatedAt: new Date(),
    });

    await revertInfringementOnVoid(fakePrisma, "INFR-ref-001");
    expect(infringementUpdate).not.toHaveBeenCalled();
  });
});
