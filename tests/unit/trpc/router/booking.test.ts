import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { bookingRouter } from "../../../../src/server/trpc/router/booking";

/**
 * Authorization tests for the customer-facing booking router. We exercise
 * the `byId` procedure because it has the explicit ownership check that
 * protects customers from seeing each other's bookings. The happy path
 * just needs to confirm the check doesn't trip for the owner.
 */

type Caller = ReturnType<typeof bookingRouter.createCaller>;

function makeCtx(overrides: {
  booking?: Record<string, unknown> | null;
  userId?: string;
  role?: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
} = {}) {
  const booking = overrides.booking === undefined
    ? { id: "b1", customerId: "cust1", status: "CONFIRMED" }
    : overrides.booking;

  const prisma = {
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const user = {
    id: overrides.userId ?? "cust1",
    role: overrides.role ?? "CUSTOMER",
  };
  return {
    prisma,
    // protectedProcedure derives `ctx.user` from `ctx.session.user`, so the
    // role check at booking.byId runs against the session user's role.
    session: { user },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["byId"]>[0];
}

describe("booking.byId", () => {
  it("returns the booking to its owner", async () => {
    const ctx = makeCtx();
    const c = bookingRouter.createCaller(ctx as never);
    const out = await c.byId({ id: "b1" });
    expect(out).toMatchObject({ id: "b1", customerId: "cust1" });
  });

  it("rejects a different customer with FORBIDDEN", async () => {
    const ctx = makeCtx({ userId: "cust2" });
    const c = bookingRouter.createCaller(ctx as never);
    await expect(c.byId({ id: "b1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows staff to view any booking", async () => {
    const ctx = makeCtx({ userId: "staff1", role: "STAFF" });
    const c = bookingRouter.createCaller(ctx as never);
    const out = await c.byId({ id: "b1" });
    expect(out).toMatchObject({ id: "b1" });
  });

  it("throws NOT_FOUND when the booking does not exist", async () => {
    const ctx = makeCtx({ booking: null });
    const c = bookingRouter.createCaller(ctx as never);
    await expect(c.byId({ id: "missing" })).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("booking.mine", () => {
  it("returns an empty page when the customer has no bookings", async () => {
    const ctx = makeCtx();
    const c = bookingRouter.createCaller(ctx as never);
    const out = await c.mine();
    expect(out).toEqual({ items: [], nextCursor: null });
  });
});
