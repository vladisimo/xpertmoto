import { describe, it, expect, vi, beforeEach } from "vitest";

// The charge helper issues an AdjustmentNote via invoice-lifecycle after
// commit — stub it so tests stay focused on the Payment + balanceDue side
// effects (its best-effort failure path is asserted explicitly below).
const tryIssueAdjustmentForBooking = vi.fn().mockResolvedValue({ id: "adj_1" });
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...args: unknown[]) => tryIssueAdjustmentForBooking(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyInfringementRecoveryCharge,
  markInfringementPaidOnCapture,
  revertInfringementOnVoid,
} from "@/server/services/infringement-charge";

type PaymentRow = { id: string };

/**
 * Prisma stub tracking the created Payment and the booking balanceDue. The
 * helper runs its Payment + balanceDue writes inside `$transaction(cb)`, so
 * the stub simply hands the same client through as the tx.
 */
function makePrisma(opts: {
  existingPayment?: PaymentRow | null;
  booking?: { balanceDue: number } | null;
}) {
  const state = {
    balanceDue: opts.booking?.balanceDue ?? 0,
    createdPayment: null as null | Record<string, unknown>,
  };
  const paymentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    state.createdPayment = data;
    return { id: "pay_new" };
  });
  const bookingUpdate = vi.fn(async ({ data }: { data: { balanceDue: number } }) => {
    state.balanceDue = data.balanceDue;
    return {};
  });
  const client = {
    payment: {
      findUnique: vi.fn().mockResolvedValue(opts.existingPayment ?? null),
      create: paymentCreate,
    },
    booking: {
      findUnique: vi.fn().mockResolvedValue(opts.booking ?? null),
      update: bookingUpdate,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(client)),
  };
  return { prisma: client as never, state, paymentCreate, bookingUpdate };
}

const baseInf = {
  id: "inf_1",
  referenceNumber: "abc123",
  type: "TOLL",
  issuer: "Linkt-NSW (Fleet)",
  amount: 10.79,
  adminFee: 2.5,
  bookingId: "bk_1",
  customerId: "cust_1",
};

beforeEach(() => {
  tryIssueAdjustmentForBooking.mockClear();
  tryIssueAdjustmentForBooking.mockResolvedValue({ id: "adj_1" });
});

describe("applyInfringementRecoveryCharge", () => {
  it("creates a PENDING INFRINGEMENT_RECOVERY payment for toll + admin fee and bumps balanceDue", async () => {
    const { prisma, state, paymentCreate } = makePrisma({ booking: { balanceDue: 100 } });

    const res = await applyInfringementRecoveryCharge({ prisma, infringement: baseInf });

    expect(res).toEqual({ paymentId: "pay_new", alreadyExisted: false, amount: 13.29 });
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(state.createdPayment).toMatchObject({
      reference: "INFR-abc123",
      type: "INFRINGEMENT_RECOVERY",
      method: "STRIPE",
      status: "PENDING",
      amount: 13.29,
      bookingId: "bk_1",
      customerId: "cust_1",
    });
    // 100 + (10.79 + 2.50)
    expect(state.balanceDue).toBe(113.29);
  });

  it("is idempotent: a second call on the same reference does not re-charge or re-bump balanceDue", async () => {
    const { prisma, paymentCreate, bookingUpdate } = makePrisma({
      existingPayment: { id: "pay_existing" },
      booking: { balanceDue: 100 },
    });

    const res = await applyInfringementRecoveryCharge({ prisma, infringement: baseInf });

    expect(res).toEqual({ paymentId: "pay_existing", alreadyExisted: true, amount: 13.29 });
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("raises the charge without touching balanceDue when there is no booking", async () => {
    const { prisma, paymentCreate, bookingUpdate, state } = makePrisma({ booking: null });

    const res = await applyInfringementRecoveryCharge({
      prisma,
      infringement: { ...baseInf, bookingId: null },
    });

    expect(res.alreadyExisted).toBe(false);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(state.createdPayment).toMatchObject({ bookingId: null });
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("throws when the infringement has no customerId (nobody to charge)", async () => {
    const { prisma, paymentCreate } = makePrisma({ booking: { balanceDue: 0 } });
    await expect(
      applyInfringementRecoveryCharge({ prisma, infringement: { ...baseInf, customerId: null } }),
    ).rejects.toThrow(/no customerId/);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("throws on a non-positive total", async () => {
    const { prisma, paymentCreate } = makePrisma({ booking: { balanceDue: 0 } });
    await expect(
      applyInfringementRecoveryCharge({
        prisma,
        infringement: { ...baseInf, amount: 0, adminFee: 0 },
      }),
    ).rejects.toThrow(/non-positive/);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("issues an AdjustmentNote with separate issuer-fine and admin-fee line items", async () => {
    const { prisma } = makePrisma({ booking: { balanceDue: 0 } });
    await applyInfringementRecoveryCharge({ prisma, infringement: baseInf });

    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledTimes(1);
    const arg = tryIssueAdjustmentForBooking.mock.calls[0]![0] as {
      type: string;
      reason: string;
      lineItems: Array<{ description: string; totalPrice: number }>;
    };
    expect(arg.type).toBe("INCREASE");
    expect(arg.reason).toBe("INFRINGEMENT");
    expect(arg.lineItems).toHaveLength(2);
    expect(arg.lineItems[0]!.totalPrice).toBe(10.79);
    expect(arg.lineItems[1]!.description).toBe("Administration fee");
    expect(arg.lineItems[1]!.totalPrice).toBe(2.5);
  });

  it("omits the admin-fee line item when the fee is zero", async () => {
    const { prisma } = makePrisma({ booking: { balanceDue: 0 } });
    await applyInfringementRecoveryCharge({
      prisma,
      infringement: { ...baseInf, adminFee: 0 },
    });
    const arg = tryIssueAdjustmentForBooking.mock.calls[0]![0] as {
      lineItems: unknown[];
    };
    expect(arg.lineItems).toHaveLength(1);
  });

  it("does not roll back the Payment when AdjustmentNote issuance fails (best-effort)", async () => {
    tryIssueAdjustmentForBooking.mockRejectedValueOnce(new Error("invoice service down"));
    const { prisma, paymentCreate } = makePrisma({ booking: { balanceDue: 0 } });

    const res = await applyInfringementRecoveryCharge({ prisma, infringement: baseInf });

    expect(res.alreadyExisted).toBe(false);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
  });
});

describe("markInfringementPaidOnCapture", () => {
  function infPrisma(inf: { id: string; status: string } | null) {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      infringement: { findUnique: vi.fn().mockResolvedValue(inf), update },
    };
    return { prisma: prisma as never, update };
  }

  it("advances the infringement to PAID", async () => {
    const { prisma, update } = infPrisma({ id: "inf_1", status: "CUSTOMER_CHARGED" });
    await markInfringementPaidOnCapture(prisma, "INFR-abc123");
    expect(update).toHaveBeenCalledWith({ where: { id: "inf_1" }, data: { status: "PAID" } });
  });

  it("is a no-op for a non-INFR payment reference", async () => {
    const { prisma, update } = infPrisma({ id: "inf_1", status: "CUSTOMER_CHARGED" });
    await markInfringementPaidOnCapture(prisma, "BOOK-xyz");
    expect(update).not.toHaveBeenCalled();
  });

  it("is idempotent when the infringement is already PAID", async () => {
    const { prisma, update } = infPrisma({ id: "inf_1", status: "PAID" });
    await markInfringementPaidOnCapture(prisma, "INFR-abc123");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("revertInfringementOnVoid", () => {
  function infPrisma(
    inf: { id: string; status: string; nominatedAt: Date | null } | null,
  ) {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      infringement: { findUnique: vi.fn().mockResolvedValue(inf), update },
    };
    return { prisma: prisma as never, update };
  }

  it("steps a charged toll (never nominated) back to RECEIVED", async () => {
    const { prisma, update } = infPrisma({
      id: "inf_1",
      status: "CUSTOMER_CHARGED",
      nominatedAt: null,
    });
    await revertInfringementOnVoid(prisma, "INFR-abc123");
    expect(update).toHaveBeenCalledWith({ where: { id: "inf_1" }, data: { status: "RECEIVED" } });
  });

  it("steps a charged-but-nominated infringement back to NOMINATED", async () => {
    const { prisma, update } = infPrisma({
      id: "inf_1",
      status: "CUSTOMER_CHARGED",
      nominatedAt: new Date("2026-06-01T00:00:00Z"),
    });
    await revertInfringementOnVoid(prisma, "INFR-abc123");
    expect(update).toHaveBeenCalledWith({ where: { id: "inf_1" }, data: { status: "NOMINATED" } });
  });

  it("leaves a non-charged infringement untouched", async () => {
    const { prisma, update } = infPrisma({ id: "inf_1", status: "PAID", nominatedAt: null });
    await revertInfringementOnVoid(prisma, "INFR-abc123");
    expect(update).not.toHaveBeenCalled();
  });
});
