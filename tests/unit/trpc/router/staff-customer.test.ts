import { describe, expect, test, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { buildCustomerListWhere, staffCustomerRouter } from "@/server/trpc/router/staff-customer";

// The detail card's reward counters are overlaid from a live computeCustomerRewards
// snapshot. Mock the compute (its own derivation is unit-tested separately) so we
// assert only the overlay: stale persisted counters get replaced with the snapshot.
const computeCustomerRewards = vi.fn();
vi.mock("@/server/services/customer-rewards", () => ({
  computeCustomerRewards: (...args: unknown[]) => computeCustomerRewards(...args),
}));

const NOW = new Date("2026-04-17T00:00:00.000Z");

describe("buildCustomerListWhere", () => {
  test("always constrains to users with a CustomerProfile (profile-based, not role)", () => {
    const w = buildCustomerListWhere({ status: "ALL" }, NOW);
    // Membership is held in AND so status facets can still set customerProfile.
    expect(w.AND).toEqual([{ customerProfile: { isNot: null } }]);
    expect(w.role).toBeUndefined();
    expect(w.OR).toBeUndefined();
    expect(w.bookings).toBeUndefined();
  });

  test("search applies OR on email/firstName/lastName/phone", () => {
    const w = buildCustomerListWhere({ status: "ALL", search: "henry" }, NOW);
    expect(w.OR).toHaveLength(4);
    const fields = (w.OR as Array<Record<string, unknown>>).map((o) => Object.keys(o)[0]);
    expect(fields.sort()).toEqual(["email", "firstName", "lastName", "phone"]);
  });

  test("PENDING_HIRE includes upcoming + in-progress booking statuses", () => {
    const w = buildCustomerListWhere({ status: "PENDING_HIRE" }, NOW);
    const statuses = (w.bookings as { some: { status: { in: string[] } } }).some.status.in;
    expect(statuses).toEqual([
      "PENDING_PAYMENT",
      "CONFIRMED",
      "CHECKED_OUT",
      "ACTIVE",
      "OVERDUE",
    ]);
  });

  test("ACTIVE_RENTAL restricts to actively-out bookings only", () => {
    const w = buildCustomerListWhere({ status: "ACTIVE_RENTAL" }, NOW);
    const statuses = (w.bookings as { some: { status: { in: string[] } } }).some.status.in;
    expect(statuses).toEqual(["CHECKED_OUT", "ACTIVE", "OVERDUE"]);
  });

  test("UNVERIFIED filters on licenceVerifiedAt IS NULL", () => {
    const w = buildCustomerListWhere({ status: "UNVERIFIED" }, NOW);
    expect(w.customerProfile).toEqual({ licenceVerifiedAt: null });
  });

  test("LICENCE_EXPIRED uses now for the cutoff", () => {
    const w = buildCustomerListWhere({ status: "LICENCE_EXPIRED" }, NOW);
    expect(w.customerProfile).toEqual({ licenceExpiry: { lt: NOW } });
  });

  test("HIGH_RISK filters riskRating", () => {
    const w = buildCustomerListWhere({ status: "HIGH_RISK" }, NOW);
    expect(w.customerProfile).toEqual({ riskRating: "HIGH" });
  });

  test("SUSPENDED filters user.status", () => {
    const w = buildCustomerListWhere({ status: "SUSPENDED" }, NOW);
    expect(w.status).toBe("SUSPENDED");
  });

  test("search + status compose (search OR clause plus booking filter)", () => {
    const w = buildCustomerListWhere({ status: "PENDING_HIRE", search: "lee" }, NOW);
    expect(w.OR).toHaveLength(4);
    expect(w.bookings).toBeDefined();
  });
});

describe("staffCustomer.detail reward overlay", () => {
  type Caller = ReturnType<typeof staffCustomerRouter.createCaller>;

  function buildCtx(user: unknown) {
    return {
      prisma: { user: { findUnique: vi.fn().mockResolvedValue(user) } },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["detail"]>[0];
  }

  test("overlays a live rewards snapshot over the stale persisted counters", async () => {
    // Persisted profile is stale (e.g. only in-flight bookings → never recomputed).
    const user = {
      id: "cust-1",
      customerProfile: {
        totalSpend: new Prisma.Decimal(0),
        totalBookings: 0,
        completedBookings: 0,
        lastBookingAt: null,
        lifetimePoints: 0,
        loyaltyPoints: 0,
        loyaltyTier: "SILVER",
        licenceNumber: null,
        licenceNumberEnc: null,
        passportNumber: null,
        passportNumberEnc: null,
      },
    };
    computeCustomerRewards.mockResolvedValue({
      totalSpend: new Prisma.Decimal("1857.36"),
      completedBookings: 1,
      totalBookings: 3,
      lastBookingAt: new Date("2026-05-26T00:00:00.000Z"),
      lifetimePoints: 1857,
      loyaltyPoints: 1857,
      loyaltyTier: "GOLD",
    });

    const ctx = buildCtx(user);
    const result = await staffCustomerRouter.createCaller(ctx as never).detail({ id: "cust-1" });

    expect(computeCustomerRewards).toHaveBeenCalledWith(expect.anything(), "cust-1");
    expect(result?.customerProfile?.totalSpend.toFixed(2)).toBe("1857.36");
    expect(result?.customerProfile?.totalBookings).toBe(3);
    expect(result?.customerProfile?.completedBookings).toBe(1);
    expect(result?.customerProfile?.loyaltyPoints).toBe(1857);
    expect(result?.customerProfile?.loyaltyTier).toBe("GOLD");
  });
});
