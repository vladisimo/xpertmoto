import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Focus: the two non-check-in completion paths (`completeFromReturned` and
// `closeOut`) must record booking completion, so a customer's lifetime
// spend / completed-booking counters stay in lock-step with the loyalty
// points the post-trip-review job later awards. Regression guard for the
// "129 points, $0 spend, 0 bookings" drift. The revenue aggregator is
// stubbed so we assert the call rather than exercise its DB writes.
const recordBookingCompletionMock = vi.fn().mockResolvedValue(undefined);
const recordAdditionalChargesMock = vi.fn().mockResolvedValue(undefined);
const invalidateRevenueCachesMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordBookingCompletion: (...a: unknown[]) => recordBookingCompletionMock(...a),
  recordAdditionalCharges: (...a: unknown[]) => recordAdditionalChargesMock(...a),
  invalidateRevenueCaches: (...a: unknown[]) => invalidateRevenueCachesMock(...a),
}));
// Post-completion side effects — stubbed so the tests stay pure units.
vi.mock("@/server/services/partner", () => ({
  markPartnerTransactionsPayable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/referral", () => ({
  qualifyReferral: vi.fn().mockResolvedValue(undefined),
}));

import { staffBookingRouter } from "../../../../src/server/trpc/router/staff-booking";

beforeEach(() => {
  vi.clearAllMocks();
});

type BookingOverrides = {
  status?: string;
  returnAssessments?: { status: string }[];
};

function makeBooking(overrides: BookingOverrides = {}) {
  return {
    id: "b1",
    bookingReference: "SCT-TEST-0001",
    status: overrides.status ?? "RETURNED",
    customerId: "cust1",
    depotId: "depot1",
    vehicleId: null,
    returnDepotId: null,
    actualReturnDateTime: new Date("2026-05-18T06:00:00.000Z"),
    subtotal: new Prisma.Decimal(110),
    addonTotal: new Prisma.Decimal(19),
    gstAmount: new Prisma.Decimal(11.73),
    totalAmount: new Prisma.Decimal(129),
    returnAssessments: overrides.returnAssessments ?? [{ status: "SIGNED" }],
  };
}

function makeCtx(booking: ReturnType<typeof makeBooking>) {
  const prisma = {
    booking: {
      findUniqueOrThrow: vi.fn(async () => booking),
      update: vi.fn(async () => ({ id: booking.id, status: "COMPLETED" })),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        booking: {
          update: vi.fn(async () => ({ id: booking.id, status: "COMPLETED" })),
        },
        bookingStatusLog: { create: vi.fn(async () => null) },
      };
      return cb(tx);
    }),
  };
  return {
    prisma,
    user: { id: "staff1", role: "STAFF" as const },
    session: { user: { id: "staff1", role: "STAFF" as const } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    _skipAudit: true,
  };
}

describe("staffBooking.createWalkIn — profile-based target guard", () => {
  const GUARD_MESSAGE = "Walk-in bookings must be attached to a customer account.";
  const walkInInput = {
    customerId: "target1",
    categoryId: "cat1",
    pickupDepotId: "d1",
    returnDepotId: "d1",
    pickupDateTime: new Date("2026-06-01T10:00:00Z"),
    returnDateTime: new Date("2026-06-03T10:00:00Z"),
    totalAmount: 200,
    subtotal: 180,
    gstAmount: 18.18,
    bondAmount: 300,
    method: "CARD" as const,
  };

  function makeWalkInCtx(target: { customerProfile: { id: string } | null } | null) {
    return {
      prisma: {
        user: { findUnique: vi.fn(async () => target) },
        // Reached only if the guard passes. The depot lookup returns [] so the
        // guard-pass path fails with a *different* (depot) BAD_REQUEST, letting
        // us distinguish "cleared the guard" from "rejected by the guard".
        depot: { findMany: vi.fn(async () => []) },
        booking: { create: vi.fn() },
      },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" as const } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
  }

  it("rejects when the selected target has no customer profile", async () => {
    const ctx = makeWalkInCtx({ customerProfile: null });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(caller.createWalkIn(walkInInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: GUARD_MESSAGE,
    });
    expect(ctx.prisma.booking.create).not.toHaveBeenCalled();
  });

  it("rejects when the selected target does not exist", async () => {
    const ctx = makeWalkInCtx(null);
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(caller.createWalkIn(walkInInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: GUARD_MESSAGE,
    });
    expect(ctx.prisma.booking.create).not.toHaveBeenCalled();
  });

  it("lets a target that has a customer profile past the guard (regardless of role)", async () => {
    // A back-office user who also carries a CustomerProfile is a valid target.
    const ctx = makeWalkInCtx({ customerProfile: { id: "cp1" } });
    const caller = staffBookingRouter.createCaller(ctx as never);
    // Cleared the guard, then fails on the empty depot lookup — a different
    // BAD_REQUEST, so the guard message must NOT be the one raised.
    await expect(caller.createWalkIn(walkInInput)).rejects.not.toMatchObject({
      message: GUARD_MESSAGE,
    });
  });
});

describe("staffBooking.completeFromReturned", () => {
  it("records booking completion with the booking's totals", async () => {
    const ctx = makeCtx(makeBooking({ status: "RETURNED" }));
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.completeFromReturned({ bookingId: "b1" });

    expect(recordBookingCompletionMock).toHaveBeenCalledTimes(1);
    expect(recordBookingCompletionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "b1",
        customerId: "cust1",
        depotId: "depot1",
        totalAmount: new Prisma.Decimal(129),
      }),
    );
    expect(invalidateRevenueCachesMock).toHaveBeenCalledWith("depot1");
  });

  it("rejects when the booking is not RETURNED", async () => {
    const ctx = makeCtx(makeBooking({ status: "ACTIVE" }));
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.completeFromReturned({ bookingId: "b1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(recordBookingCompletionMock).not.toHaveBeenCalled();
  });
});

describe("staffBooking.closeOut", () => {
  it("records booking completion when a signed assessment exists", async () => {
    const ctx = makeCtx(
      makeBooking({ status: "RETURNED", returnAssessments: [{ status: "SIGNED" }] }),
    );
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.closeOut({ bookingId: "b1" });

    expect(recordBookingCompletionMock).toHaveBeenCalledTimes(1);
    expect(recordBookingCompletionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "b1",
        customerId: "cust1",
        depotId: "depot1",
        totalAmount: new Prisma.Decimal(129),
      }),
    );
    expect(invalidateRevenueCachesMock).toHaveBeenCalledWith("depot1");
  });

  it("rejects close-out without a signed return assessment", async () => {
    const ctx = makeCtx(
      makeBooking({ status: "RETURNED", returnAssessments: [{ status: "DRAFT" }] }),
    );
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(caller.closeOut({ bookingId: "b1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(recordBookingCompletionMock).not.toHaveBeenCalled();
  });
});

describe("staffBooking depot scoping (B1 IDOR fix)", () => {
  function makeDepotCtx(userDepotId: string | null) {
    const booking = makeBooking({ status: "RETURNED" });
    const prisma = {
      booking: {
        findUnique: vi.fn(async () => ({
          customerId: booking.customerId,
          depotId: booking.depotId,
        })),
        findUniqueOrThrow: vi.fn(async () => booking),
        update: vi.fn(async () => ({ id: booking.id })),
      },
      bookingNote: { create: vi.fn(async () => ({ id: "n1" })) },
    };
    return {
      prisma,
      user: { id: "staff1", role: "STAFF" as const, depotId: userDepotId },
      session: { user: { id: "staff1", role: "STAFF" as const, depotId: userDepotId } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
  }

  it("FORBIDDEN: depot-assigned STAFF cannot read a booking from another depot", async () => {
    const ctx = makeDepotCtx("depot-other");
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(caller.markOverdue({ bookingId: "b1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("FORBIDDEN: depot-assigned STAFF cannot add a note to another depot's booking", async () => {
    const ctx = makeDepotCtx("depot-other");
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.addNote({ bookingId: "b1", note: "x", isInternal: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ctx.prisma.bookingNote.create).not.toHaveBeenCalled();
  });

  it("allows STAFF assigned to the booking's own depot", async () => {
    const ctx = makeDepotCtx("depot1");
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.addNote({ bookingId: "b1", note: "x", isInternal: true }),
    ).resolves.toMatchObject({ id: "n1" });
  });

  it("pins the list query to the STAFF user's depot even when another depot is requested", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = {
      prisma: { booking: { findMany } },
      user: { id: "staff1", role: "STAFF" as const, depotId: "depot1" },
      session: { user: { id: "staff1", role: "STAFF" as const, depotId: "depot1" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.list({ depotId: "depot-other", take: 10 });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } } | undefined;
    expect(args?.where?.depotId).toBe("depot1");
  });
});

describe("staffBooking.detail — bounded child collections", () => {
  it("caps every unbounded child relation so a long-running booking can't fetch hundreds of rows", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "b1", depotId: "depot1" });
    const ctx = {
      prisma: { booking: { findUnique } },
      user: { id: "staff1", role: "STAFF" as const, depotId: "depot1" },
      session: { user: { id: "staff1", role: "STAFF" as const, depotId: "depot1" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.detail({ id: "b1" });

    const include = (findUnique.mock.calls[0]![0] as {
      include: Record<string, { take?: number } | true>;
    }).include;
    for (const rel of [
      "payments",
      "inspections",
      "incidents",
      "infringements",
      "invoices",
      "bookingNotes",
      "statusLog",
    ]) {
      const relInclude = include[rel];
      expect(relInclude, rel).not.toBe(true);
      expect((relInclude as { take?: number }).take, rel).toBe(50);
    }
  });
});
