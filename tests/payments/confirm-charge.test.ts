import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G4 — return.confirmCharge
 *
 * Transitions a DamageCharge from PROVISIONAL → CONFIRMED and creates a
 * PENDING Payment row. The capture-pending-payments job (G5) then attempts
 * off-session capture on the next tick.
 *
 * Covered branches:
 *   - happy path: STANDARD / amount > 0 → Payment created, DamageCharge
 *     moves to CONFIRMED with capturedPaymentId set
 *   - idempotent: second confirmCharge is a no-op returning current state
 *   - zero-amount: transitions CONFIRMED without creating a Payment
 *   - unsealed assessment: rejects with BAD_REQUEST
 *   - wrong resolution (QUOTE_PENDING): rejects — quote workflow owns it
 *   - WAIVED: rejects — nothing to confirm
 */

import { TRPCError } from "@trpc/server";
import { returnRouter } from "@/server/trpc/router/return";

type PrismaMock = {
  damageCharge: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  payment: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  auditLog: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function makePrisma(overrides: Partial<PrismaMock> = {}): PrismaMock {
  const damageChargeUpdate = vi.fn().mockResolvedValue({
    id: "dmg_1",
    status: "CONFIRMED",
    capturedPaymentId: "pay_new_1",
    resolvedById: "staff_1",
    resolvedAt: new Date(),
  });
  const paymentCreate = vi.fn().mockResolvedValue({
    id: "pay_new_1",
    reference: "DMG-dmg_1",
    status: "PENDING",
    amount: 150,
  });
  const paymentFindUnique = vi.fn().mockResolvedValue(null);
  const prisma: PrismaMock = {
    damageCharge: { findUniqueOrThrow: vi.fn(), update: damageChargeUpdate },
    payment: { findUnique: paymentFindUnique, create: paymentCreate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        payment: { findUnique: paymentFindUnique, create: paymentCreate },
        damageCharge: { update: damageChargeUpdate },
      }),
    ),
    ...overrides,
  };
  return prisma;
}

function makeCtx(prisma: PrismaMock) {
  return {
    prisma,
    user: { id: "staff_1", role: "STAFF" as const },
    session: { user: { id: "staff_1", role: "STAFF" as const } },
    ipAddress: "127.0.0.1",
    userAgent: "test",
  };
}

async function callConfirmCharge(prisma: PrismaMock, input: { damageChargeId: string }) {
  const caller = returnRouter.createCaller(makeCtx(prisma) as unknown as never);
  return caller.confirmCharge(input);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("return.confirmCharge", () => {
  it("creates a Payment and moves PROVISIONAL → CONFIRMED on happy path", async () => {
    const prisma = makePrisma();
    prisma.damageCharge.findUniqueOrThrow.mockResolvedValue({
      id: "dmg_1",
      status: "PROVISIONAL",
      resolution: "STANDARD",
      amount: 150,
      capturedPaymentId: null,
      description: "Front fender scuff",
      returnAssessment: {
        id: "ra_1",
        status: "SIGNED",
        bookingId: "book_1",
        booking: { customerId: "cust_1", bookingReference: "SCT-20260418-0001" },
      },
      inspection: { id: "insp_1" },
    });
    const r = await callConfirmCharge(prisma, { damageChargeId: "dmg_1" });
    expect(r.paymentId).toBe("pay_new_1");
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "DMG-dmg_1",
          type: "DAMAGE_CHARGE",
          status: "PENDING",
          method: "STRIPE",
          customerId: "cust_1",
          bookingId: "book_1",
        }),
      }),
    );
    expect(prisma.damageCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dmg_1" },
        data: expect.objectContaining({
          status: "CONFIRMED",
          capturedPaymentId: "pay_new_1",
        }),
      }),
    );
  });

  it("is idempotent — re-running on CONFIRMED returns current paymentId without writing", async () => {
    const prisma = makePrisma();
    prisma.damageCharge.findUniqueOrThrow.mockResolvedValue({
      id: "dmg_2",
      status: "CONFIRMED",
      resolution: "STANDARD",
      amount: 150,
      capturedPaymentId: "pay_existing",
      description: "already done",
      returnAssessment: {
        id: "ra_2",
        status: "SIGNED",
        bookingId: "book_2",
        booking: { customerId: "cust_2", bookingReference: "SCT-0002" },
      },
      inspection: { id: "insp_2" },
    });
    const r = await callConfirmCharge(prisma, { damageChargeId: "dmg_2" });
    expect(r.paymentId).toBe("pay_existing");
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.damageCharge.update).not.toHaveBeenCalled();
  });

  it("zero-amount charges move to CONFIRMED with no Payment row", async () => {
    const prisma = makePrisma();
    prisma.damageCharge.findUniqueOrThrow.mockResolvedValue({
      id: "dmg_3",
      status: "PROVISIONAL",
      resolution: "STANDARD",
      amount: 0,
      capturedPaymentId: null,
      description: "cosmetic only",
      returnAssessment: {
        id: "ra_3",
        status: "SIGNED",
        bookingId: "book_3",
        booking: { customerId: "cust_3", bookingReference: "SCT-0003" },
      },
      inspection: { id: "insp_3" },
    });
    const r = await callConfirmCharge(prisma, { damageChargeId: "dmg_3" });
    expect(r.paymentId).toBeNull();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.damageCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONFIRMED" }),
      }),
    );
  });

  it("rejects unsealed (DRAFT) assessments", async () => {
    const prisma = makePrisma();
    prisma.damageCharge.findUniqueOrThrow.mockResolvedValue({
      id: "dmg_4",
      status: "PROVISIONAL",
      resolution: "STANDARD",
      amount: 50,
      capturedPaymentId: null,
      description: "draft",
      returnAssessment: {
        id: "ra_4",
        status: "DRAFT",
        bookingId: "book_4",
        booking: { customerId: "cust_4", bookingReference: "SCT-0004" },
      },
      inspection: { id: "insp_4" },
    });
    await expect(callConfirmCharge(prisma, { damageChargeId: "dmg_4" })).rejects.toBeInstanceOf(
      TRPCError,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("rejects charges with resolution QUOTE_PENDING", async () => {
    const prisma = makePrisma();
    prisma.damageCharge.findUniqueOrThrow.mockResolvedValue({
      id: "dmg_5",
      status: "PROVISIONAL",
      resolution: "QUOTE_PENDING",
      amount: 0,
      quoteCapAmount: 500,
      capturedPaymentId: null,
      description: "pending quote",
      returnAssessment: {
        id: "ra_5",
        status: "SIGNED",
        bookingId: "book_5",
        booking: { customerId: "cust_5", bookingReference: "SCT-0005" },
      },
      inspection: { id: "insp_5" },
    });
    await expect(callConfirmCharge(prisma, { damageChargeId: "dmg_5" })).rejects.toBeInstanceOf(
      TRPCError,
    );
  });

  it("rejects WAIVED charges", async () => {
    const prisma = makePrisma();
    prisma.damageCharge.findUniqueOrThrow.mockResolvedValue({
      id: "dmg_6",
      status: "WAIVED",
      resolution: "STANDARD",
      amount: 50,
      capturedPaymentId: null,
      description: "waived",
      returnAssessment: {
        id: "ra_6",
        status: "SIGNED",
        bookingId: "book_6",
        booking: { customerId: "cust_6", bookingReference: "SCT-0006" },
      },
      inspection: { id: "insp_6" },
    });
    await expect(callConfirmCharge(prisma, { damageChargeId: "dmg_6" })).rejects.toBeInstanceOf(
      TRPCError,
    );
  });
});
