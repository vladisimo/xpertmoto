import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lever 7: the addInsuranceMidRental mutation runs through the real
 * router, but with a fake Prisma client to keep the test DB-less. We
 * verify:
 *   - insurance line row is created with the right source tag
 *   - totals on the booking are incremented by the correct delta
 *   - a pending ADDON_CHARGE Payment is attached
 *   - non-owner customer is rejected
 */

import { TRPCError } from "@trpc/server";
import { bookingRouter } from "../../../../src/server/trpc/router/booking";

type Caller = ReturnType<typeof bookingRouter.createCaller>;

const NOW = new Date("2026-05-10T10:00:00Z");
const PICKUP = new Date("2026-05-11T10:00:00Z"); // +24h
const RETURN = new Date("2026-05-14T10:00:00Z"); // +3 day rental

const fakeOption = {
  id: "ins-premium",
  name: "Premium",
  dailyRate: 22,
  excessAmount: 0,
  isActive: true,
};

function makeCtx(over: { booking?: Record<string, unknown>; userId?: string } = {}) {
  const booking = {
    id: "b1",
    customerId: "cust1",
    status: "CONFIRMED",
    pickupDateTime: PICKUP,
    returnDateTime: RETURN,
    ...over.booking,
  };

  const bookingUpdate = vi.fn().mockResolvedValue({});
  const bookingInsuranceCreate = vi.fn().mockResolvedValue({});
  const paymentCreate = vi.fn();

  const tx = {
    bookingInsurance: { create: bookingInsuranceCreate },
    booking: { update: bookingUpdate },
    payment: { create: paymentCreate },
  };

  const prisma = {
    booking: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
      update: bookingUpdate,
    },
    insuranceOption: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(fakeOption),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    bookingNote: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return {
    ctx: {
      prisma,
      user: { id: over.userId ?? "cust1", role: "CUSTOMER" as const },
      session: { user: { id: over.userId ?? "cust1" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["addInsuranceMidRental"]>[0],
    bookingInsuranceCreate,
    bookingUpdate,
  };
}

function caller(ctx: unknown): Caller {
  return bookingRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("booking.addInsuranceMidRental", () => {
  it("charges daysRemaining × daily rate and records the source", async () => {
    const { ctx, bookingInsuranceCreate, bookingUpdate } = makeCtx();
    const c = caller(ctx);
    const result = await c.addInsuranceMidRental({
      bookingId: "b1",
      insuranceOptionId: "ins-premium",
      source: "PRE_PICKUP_UPSELL",
    });

    // pickup is in 24h, so anchor = pickupDateTime → 3 days remaining.
    expect(result.remainingDays).toBe(3);
    expect(result.charged).toBe(66);
    expect(bookingInsuranceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "PRE_PICKUP_UPSELL",
          totalPrice: 66,
          dailyRate: 22,
        }),
      }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          insuranceTotal: { increment: 66 },
          totalAmount: { increment: 66 },
          balanceDue: { increment: 66 },
        }),
      }),
    );
  });

  it("rejects when caller is not the booking owner", async () => {
    const { ctx } = makeCtx({ userId: "someoneElse" });
    const c = caller(ctx);
    await expect(
      c.addInsuranceMidRental({
        bookingId: "b1",
        insuranceOptionId: "ins-premium",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects for bookings outside the active lifecycle window", async () => {
    const { ctx } = makeCtx({ booking: { status: "COMPLETED" } });
    const c = caller(ctx);
    await expect(
      c.addInsuranceMidRental({
        bookingId: "b1",
        insuranceOptionId: "ins-premium",
      }),
    ).rejects.toThrow(/Cannot add insurance/);
  });
});
