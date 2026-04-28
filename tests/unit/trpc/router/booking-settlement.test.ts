import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// The router imports writePaymentAudit / writePaymentEvent. We stub the
// modules so tests don't need a real database writer for audit rows.
vi.mock("@/server/services/audit-payment", () => ({
  writePaymentAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/payment-events", () => ({
  writePaymentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/audit", () => ({
  skipAutoAudit: vi.fn(),
  writeAuditAsync: vi.fn(),
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { bookingSettlementRouter } from "../../../../src/server/trpc/router/booking-settlement";

beforeEach(() => {
  vi.clearAllMocks();
});

type TestCtx = {
  prisma: {
    booking: { findUniqueOrThrow: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    payment: {
      create: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  session: { user: { id: string; role: "STAFF" } };
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  reqId: string;
};

function makeCtx(overrides: {
  booking?: Record<string, unknown>;
  paymentCreated?: Record<string, unknown>;
} = {}): TestCtx {
  const booking = {
    id: "b1",
    bookingReference: "SCT-20260420-0001",
    customerId: "cust1",
    balanceDue: 0,
    ...overrides.booking,
  };
  const paymentCreated = overrides.paymentCreated ?? { id: "p1" };

  return {
    prisma: {
      booking: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
        update: vi.fn().mockResolvedValue({}),
      },
      payment: {
        create: vi.fn().mockResolvedValue(paymentCreated),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
    },
    // protectedProcedure reads role off session.user, so the role gate on
    // staffProcedure runs against this value.
    session: { user: { id: "staff1", role: "STAFF" } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };
}

describe("bookingSettlement.addManualCharge", () => {
  it("computes GST-inclusive split and bumps booking balance", async () => {
    const ctx = makeCtx();
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await c.addManualCharge({
      bookingId: "b1",
      amount: 110,
      description: "Cleaning fee",
    });

    const createCall = ctx.prisma.payment.create.mock.calls[0]?.[0] as {
      data: { amount: number; gstAmount: unknown; type: string; status: string };
    };
    expect(createCall.data.amount).toBe(110);
    // 110 / 11 = 10.00 — gstFromInclusive returns Prisma.Decimal; coerce for comparison.
    expect(Number(createCall.data.gstAmount)).toBe(10);
    expect(createCall.data.type).toBe("MANUAL_CHARGE");
    expect(createCall.data.status).toBe("PENDING");
    expect(ctx.prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balanceDue: 110 }),
      }),
    );
  });

  it("zeroes GST when caller opts out of GST-inclusive", async () => {
    const ctx = makeCtx();
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await c.addManualCharge({
      bookingId: "b1",
      amount: 100,
      description: "Tax-exempt fee",
      gstInclusive: false,
    });
    expect(ctx.prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 100, gstAmount: 0 }),
      }),
    );
  });

  it("rejects non-positive amounts at the zod boundary", async () => {
    const ctx = makeCtx();
    const c = bookingSettlementRouter.createCaller(ctx as never);
    await expect(
      c.addManualCharge({ bookingId: "b1", amount: 0, description: "Zero" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
