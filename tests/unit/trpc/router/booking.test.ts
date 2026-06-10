import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// The quote-validation tests below drive the booking.quote error mapping in
// isolation: the rate-limit middleware and depot-hours guard are stubbed to
// no-ops so the test reaches the pricing cascade, and the cascade itself is
// mocked so we can make it throw a specific domain error. The real error
// classes are preserved via importActual — the procedure's `instanceof`
// checks depend on them.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/server/services/booking-times-guard", () => ({
  enforceBookingTimesWithinHours: vi.fn().mockResolvedValue(undefined),
  enforceDateTimeWithinDepotHours: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/pricing", async (importActual) => {
  const actual = await importActual<typeof import("@/server/services/pricing")>();
  return { ...actual, quote: vi.fn() };
});
// confirmPayment delegates to the booking-confirmation service; the error
// classes stay real (importActual) because the procedure maps them to TRPC
// codes via instanceof.
vi.mock("@/server/services/booking-confirmation", async (importActual) => {
  const actual = await importActual<typeof import("@/server/services/booking-confirmation")>();
  return { ...actual, confirmBookingPayment: vi.fn() };
});

import { bookingRouter } from "../../../../src/server/trpc/router/booking";
import { buildOnboardingVersion } from "../../../../src/lib/onboarding-status";
import {
  quote as quotePricing,
  MinimumRentalPeriodError,
  OneWayDisallowedError,
} from "../../../../src/server/services/pricing";
import {
  confirmBookingPayment,
  PaymentNotSucceededError,
  BookingNotConfirmableError,
} from "../../../../src/server/services/booking-confirmation";

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

/**
 * The booking.quote endpoint must surface pricing-cascade validation
 * outcomes as BAD_REQUEST. Letting them escape turns a normal customer-input
 * rejection (e.g. a 1-day rental on a 2-day-minimum bike) into a 500 + Sentry
 * exception, and makes the wizard's price breakdown flash then disappear.
 */
describe("booking.quote — validation errors map to BAD_REQUEST", () => {
  const quoteMock = vi.mocked(quotePricing);

  function quoteCtx() {
    return {
      prisma: {},
      session: null,
      ipAddress: "127.0.0.1",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["quote"]>[0];
  }

  const input = {
    categoryId: "cat1",
    vehicleId: "veh1",
    pickupDepotId: "dep1",
    returnDepotId: "dep1",
    pickupDateTime: new Date("2026-07-21T00:00:00.000Z"),
    returnDateTime: new Date("2026-07-22T00:00:00.000Z"),
    addons: [],
    deliveryFee: 0,
  };

  it("maps MinimumRentalPeriodError to BAD_REQUEST with its message", async () => {
    quoteMock.mockRejectedValueOnce(new MinimumRentalPeriodError(2));
    const c = bookingRouter.createCaller(quoteCtx() as never);
    await expect(c.quote(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("2-day minimum"),
    });
  });

  it("maps OneWayDisallowedError to BAD_REQUEST", async () => {
    quoteMock.mockRejectedValueOnce(new OneWayDisallowedError("CBD", "Airport"));
    const c = bookingRouter.createCaller(quoteCtx() as never);
    await expect(c.quote(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets unexpected errors through unchanged (still a server fault)", async () => {
    quoteMock.mockRejectedValueOnce(new Error("db exploded"));
    const c = bookingRouter.createCaller(quoteCtx() as never);
    await expect(c.quote(input)).rejects.toThrow("db exploded");
  });
});

describe("booking.confirmPayment — delegation + error mapping", () => {
  const confirmMock = confirmBookingPayment as unknown as ReturnType<typeof vi.fn>;

  function makeConfirmCtx(ownerId = "cust1") {
    const prisma = {
      booking: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ customerId: ownerId }),
      },
    };
    return {
      prisma,
      session: { user: { id: "cust1", role: "CUSTOMER" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as never;
  }

  it("returns the confirmed booking (idempotent retry included)", async () => {
    confirmMock.mockResolvedValueOnce({
      booking: { id: "b1", status: "CONFIRMED" },
      alreadyConfirmed: true,
    });
    const caller = bookingRouter.createCaller(makeConfirmCtx());
    const res = await caller.confirmPayment({ bookingId: "b1", paymentIntentId: "pi_1" });
    expect(res).toEqual({ id: "b1", status: "CONFIRMED" });
    expect(confirmMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: "b1",
        paymentIntentId: "pi_1",
        actorUserId: "cust1",
        source: "checkout",
      }),
    );
  });

  it("rejects a non-owner with FORBIDDEN before touching the service", async () => {
    confirmMock.mockClear();
    const caller = bookingRouter.createCaller(makeConfirmCtx("someone-else"));
    await expect(
      caller.confirmPayment({ bookingId: "b1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("maps PaymentNotSucceededError to BAD_REQUEST", async () => {
    confirmMock.mockRejectedValueOnce(new PaymentNotSucceededError("processing"));
    const caller = bookingRouter.createCaller(makeConfirmCtx());
    await expect(
      caller.confirmPayment({ bookingId: "b1", paymentIntentId: "pi_1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps BookingNotConfirmableError to CONFLICT", async () => {
    confirmMock.mockRejectedValueOnce(new BookingNotConfirmableError("CANCELLED"));
    const caller = bookingRouter.createCaller(makeConfirmCtx());
    await expect(
      caller.confirmPayment({ bookingId: "b1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
