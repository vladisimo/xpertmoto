import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { bookingRouter } from "../../../../src/server/trpc/router/booking";
import { buildOnboardingVersion } from "../../../../src/lib/onboarding-status";

const ONBOARDED = { onboardedAt: new Date(), onboardingVersion: buildOnboardingVersion() };
const BARE = { onboardedAt: null, onboardingVersion: null };

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
  customerProfile?: { onboardedAt: Date | null; onboardingVersion: string | null } | null;
} = {}) {
  const booking = overrides.booking === undefined
    ? { id: "b1", customerId: "cust1", status: "CONFIRMED" }
    : overrides.booking;

  // The booking.create onboarding guard fetches the caller via
  // user.findUniqueOrThrow. `customerProfile: undefined` means "not set" →
  // default to an onboarded profile so the guard passes; pass `null` for a
  // profile-less account and `BARE` for an un-onboarded one.
  const customerProfile =
    overrides.customerProfile === undefined ? ONBOARDED : overrides.customerProfile;

  const prisma = {
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        dateOfBirth: new Date("1990-01-01"),
        customerProfile,
      }),
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

describe("booking.create — onboarding guard (profile-based)", () => {
  const validInput = {
    categoryId: "cat1",
    pickupDepotId: "d1",
    returnDepotId: "d1",
    pickupDateTime: new Date("2026-06-01T10:00:00Z"),
    returnDateTime: new Date("2026-06-03T10:00:00Z"),
    agreedToTerms: true as const,
  };

  it("rejects a staff member with no customer profile (FORBIDDEN)", async () => {
    const ctx = makeCtx({ userId: "staff1", role: "STAFF", customerProfile: null });
    const c = bookingRouter.createCaller(ctx as never);
    await expect(c.create(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an admin with no customer profile (FORBIDDEN)", async () => {
    const ctx = makeCtx({ userId: "admin1", role: "ADMIN", customerProfile: null });
    const c = bookingRouter.createCaller(ctx as never);
    await expect(c.create(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an un-onboarded (bare) profile (FORBIDDEN)", async () => {
    const ctx = makeCtx({ userId: "cust1", role: "CUSTOMER", customerProfile: BARE });
    const c = bookingRouter.createCaller(ctx as never);
    await expect(c.create(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an onboarded staff member past the guard (fails later for unrelated reasons)", async () => {
    const ctx = makeCtx({ userId: "staff1", role: "STAFF", customerProfile: ONBOARDED });
    const c = bookingRouter.createCaller(ctx as never);
    // Onboarded staff carry a profile and clear the guard; the call then
    // proceeds into depot-hours logic the minimal mock can't satisfy — so it
    // must reject with anything *other* than FORBIDDEN.
    await expect(c.create(validInput)).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an onboarded customer past the guard (fails later for unrelated reasons)", async () => {
    const ctx = makeCtx({ userId: "cust1", role: "CUSTOMER", customerProfile: ONBOARDED });
    const c = bookingRouter.createCaller(ctx as never);
    await expect(c.create(validInput)).rejects.not.toMatchObject({ code: "FORBIDDEN" });
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
