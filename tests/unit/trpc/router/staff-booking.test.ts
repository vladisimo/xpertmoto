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

// checkOut / createWalkIn collaborators. Controllable mocks keep the
// remainder-charge, bond-hold, allocation, and pricing outcomes per-test;
// everything else in each module stays real via the importOriginal spread.
const chargePickupRemainderMock = vi.fn();
vi.mock("@/server/services/pickup-remainder", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  chargePickupRemainder: (...a: unknown[]) => chargePickupRemainderMock(...a),
}));
const ensureFreshBondHoldMock = vi.fn();
vi.mock("@/server/services/bond", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureFreshBondHold: (...a: unknown[]) => ensureFreshBondHoldMock(...a),
}));
const quotePricingMock = vi.fn();
vi.mock("@/server/services/pricing", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  quote: (...a: unknown[]) => quotePricingMock(...a),
}));
const isVehicleFreeMock = vi.fn();
const allocateVehicleMock = vi.fn();
vi.mock("@/server/services/availability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  acquireAllocationLock: vi.fn().mockResolvedValue(undefined),
  allocateVehicle: (...a: unknown[]) => allocateVehicleMock(...a),
  isVehicleFree: (...a: unknown[]) => isVehicleFreeMock(...a),
}));
vi.mock("@/server/services/eligibility", () => ({
  checkEligibility: () => ({ failure: null, basis: "licence", warnings: [] }),
}));
vi.mock("@/server/services/booking-times-guard", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enforceBookingTimesWithinHours: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/staff-tasks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  autoCloseByTarget: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/notification-sender", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackServer: vi.fn().mockResolvedValue(undefined),
}));
// Deterministic settings: defaults unless a test writes into the override
// map (the real getSettings would read whatever the dev DB holds).
const settingsOverride: Record<string, unknown> = {};
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    getSettings: async (keys: readonly string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        out[k] =
          settingsOverride[k] ??
          actual.SETTING_DEFAULTS[k as keyof typeof actual.SETTING_DEFAULTS];
      }
      return out;
    },
    getSetting: async (_key: string, fallback: unknown) => fallback,
  };
});

import { staffBookingRouter } from "../../../../src/server/trpc/router/staff-booking";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(settingsOverride)) delete settingsOverride[k];
  chargePickupRemainderMock.mockResolvedValue({ outcome: "not_required" });
  ensureFreshBondHoldMock.mockResolvedValue({ ok: true, action: "no_bond" });
  isVehicleFreeMock.mockResolvedValue(true);
  allocateVehicleMock.mockResolvedValue("veh-ok");
  quotePricingMock.mockResolvedValue(makeQuote());
});

/** Minimal PricingQuote shape for the fields createWalkIn persists. */
function makeQuote(overrides: Record<string, number> = {}) {
  return {
    durationDays: 2,
    baseRate: 90,
    baseSubtotal: 180,
    seasonMultiplier: 1,
    yieldMultiplier: 1,
    durationDiscountPct: 0,
    pricingMethod: "FLAT",
    discountAmount: 0,
    addonTotal: 0,
    insuranceTotal: 0,
    deliveryFee: 0,
    oneWayFee: 0,
    subtotalExGst: 181.82,
    gstAmount: 18.18,
    totalAmount: 200,
    bondAmount: 300,
    lineItems: [],
    ...overrides,
  };
}

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

const walkInInput = {
  customerId: "target1",
  categoryId: "cat1",
  vehicleId: "veh1",
  pickupDepotId: "d1",
  returnDepotId: "d1",
  pickupDateTime: new Date("2026-06-01T10:00:00Z"),
  returnDateTime: new Date("2026-06-03T10:00:00Z"),
  method: "CARD" as const,
};

function makeWalkInCtx(target: { customerProfile: { id: string } | null } | null) {
  return {
    prisma: {
      user: { findUnique: vi.fn(async () => target) },
      // Reached only if the guard passes (times-guard + pricing are mocked).
      booking: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "bk1",
          ...data,
        })),
      },
    },
    user: { id: "staff1", role: "STAFF" as const },
    session: { user: { id: "staff1", role: "STAFF" as const } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    _skipAudit: true,
  };
}

describe("staffBooking.createWalkIn — profile-based target guard", () => {
  const GUARD_MESSAGE = "Walk-in bookings must be attached to a customer account.";

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
    await expect(caller.createWalkIn(walkInInput)).resolves.toMatchObject({ id: "bk1" });
  });
});

describe("staffBooking.createWalkIn — server-side pricing (PR5)", () => {
  it("persists the server quote, not client-supplied figures", async () => {
    const ctx = makeWalkInCtx({ customerProfile: { id: "cp1" } });
    const caller = staffBookingRouter.createCaller(ctx as never);
    const res = await caller.createWalkIn(walkInInput);

    // The quote ran against the selected vehicle (rate cascade context).
    expect(quotePricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categoryId: "cat1",
        vehicleId: "veh1",
        pickupDepotId: "d1",
        returnDepotId: "d1",
      }),
    );
    const data = (ctx.prisma.booking.create.mock.calls[0]![0] as {
      data: Record<string, unknown> & {
        payments: { create: Record<string, unknown> };
      };
    }).data;
    expect(data.subtotal).toBe(180);
    expect(data.gstAmount).toBe(18.18);
    expect(data.totalAmount).toBe(200);
    expect(data.bondAmount).toBe(300);
    expect(data.discountAmount).toBe(0);
    expect(data.amountPaid).toBe(200);
    expect(data.balanceDue).toBe(0);
    expect(data.pricingSnapshot).toMatchObject({ totalAmount: 200 });
    expect(data.payments.create.amount).toBe(200);
    expect(data.payments.create.gstAmount).toBe(18.18);
    expect(res.bondRequired).toBe(true);
  });

  it("rejects CONFLICT when the sheet's expected total drifts more than a cent", async () => {
    const ctx = makeWalkInCtx({ customerProfile: { id: "cp1" } });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.createWalkIn({ ...walkInInput, expectedTotalAmount: 150 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ctx.prisma.booking.create).not.toHaveBeenCalled();
  });

  it("accepts an expected total within a cent of the server price", async () => {
    const ctx = makeWalkInCtx({ customerProfile: { id: "cp1" } });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.createWalkIn({ ...walkInInput, expectedTotalAmount: 200.005 }),
    ).resolves.toMatchObject({ id: "bk1" });
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

describe("staffBooking.recordPayment — pure balance decrement (PR3)", () => {
  function makePayCtx(b: {
    status: string;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
  }) {
    const booking = {
      id: "b1",
      status: b.status,
      customerId: "cust1",
      depotId: "depot1",
      totalAmount: new Prisma.Decimal(b.totalAmount),
      amountPaid: new Prisma.Decimal(b.amountPaid),
      balanceDue: new Prisma.Decimal(b.balanceDue),
      confirmedById: null,
    };
    const tx = {
      payment: { create: vi.fn(async () => null) },
      booking: { update: vi.fn(async () => ({ id: "b1" })) },
    };
    const ctx = {
      prisma: {
        booking: { findUniqueOrThrow: vi.fn(async () => booking) },
        $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
      },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" as const } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    return { ctx, tx };
  }

  function updateData(tx: { booking: { update: ReturnType<typeof vi.fn> } }) {
    return (tx.booking.update.mock.calls[0]![0] as {
      data: { amountPaid: number; balanceDue: number; status?: string };
    }).data;
  }

  it("pays down a PENDING raise instead of recomputing from totalAmount", async () => {
    // Fully-paid CONFIRMED booking carrying a $120 MANUAL_CHARGE raise:
    // balanceDue > totalAmount − amountPaid. The old recompute clobbered
    // the raise to $0; the decrement must leave $70 outstanding.
    const { ctx, tx } = makePayCtx({
      status: "CONFIRMED",
      totalAmount: 500,
      amountPaid: 500,
      balanceDue: 120,
    });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.recordPayment({ bookingId: "b1", amount: 50, method: "CASH" });
    const data = updateData(tx);
    expect(data.amountPaid).toBe(550);
    expect(data.balanceDue).toBe(70);
    expect(data.status).toBeUndefined(); // already CONFIRMED — no flip
  });

  it("full payment still flips PENDING_PAYMENT → CONFIRMED", async () => {
    const { ctx, tx } = makePayCtx({
      status: "PENDING_PAYMENT",
      totalAmount: 300,
      amountPaid: 100,
      balanceDue: 200,
    });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.recordPayment({ bookingId: "b1", amount: 200, method: "BANK_TRANSFER" });
    const data = updateData(tx);
    expect(data.balanceDue).toBe(0);
    expect(data.status).toBe("CONFIRMED");
  });

  it("overpayment clamps balanceDue at zero", async () => {
    const { ctx, tx } = makePayCtx({
      status: "CONFIRMED",
      totalAmount: 300,
      amountPaid: 250,
      balanceDue: 50,
    });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await caller.recordPayment({ bookingId: "b1", amount: 80, method: "CASH" });
    expect(updateData(tx).balanceDue).toBe(0);
  });
});

// ————— checkOut (PR6) —————

type CheckOutVehicle = {
  id: string;
  internalCode: string;
  rego: string;
  categoryId: string;
  depotId: string;
  regoExpiry: null;
  ctpExpiry: null;
  insuranceExpiry: null;
};

const CHECKOUT_VEHICLES: Record<string, CheckOutVehicle> = {
  "veh-ok": { id: "veh-ok", internalCode: "SC-01", rego: "REG01", categoryId: "cat1", depotId: "depot1", regoExpiry: null, ctpExpiry: null, insuranceExpiry: null },
  "veh-cat2": { id: "veh-cat2", internalCode: "SC-02", rego: "REG02", categoryId: "cat2", depotId: "depot1", regoExpiry: null, ctpExpiry: null, insuranceExpiry: null },
  "veh-d2": { id: "veh-d2", internalCode: "SC-03", rego: "REG03", categoryId: "cat1", depotId: "depot2", regoExpiry: null, ctpExpiry: null, insuranceExpiry: null },
};

function makeCheckOutBooking(o: Partial<{
  status: string;
  source: string;
  stripePaymentIntentId: string | null;
  vehicleId: string | null;
}> = {}) {
  return {
    id: "b1",
    bookingReference: "SCT-TEST-0001",
    status: o.status ?? "CONFIRMED",
    source: o.source ?? "WEBSITE",
    stripePaymentIntentId: o.stripePaymentIntentId ?? null,
    customerId: "cust1",
    depotId: "depot1",
    pickupDepotId: "depot1",
    returnDepotId: "depot1",
    categoryId: "cat1",
    vehicleId: o.vehicleId ?? null,
    pickupDateTime: new Date("2026-06-01T00:00:00.000Z"),
    returnDateTime: new Date("2026-06-03T00:00:00.000Z"),
    totalAmount: new Prisma.Decimal(200),
    amountPaid: new Prisma.Decimal(200),
    balanceDue: new Prisma.Decimal(0),
    bondAmount: new Prisma.Decimal(300),
  };
}

function makeCheckOutCtx(
  booking: ReturnType<typeof makeCheckOutBooking>,
  opts: { role?: "STAFF" | "MANAGER" } = {},
) {
  const tx = {
    vehicle: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        CHECKOUT_VEHICLES[where.id] ?? null,
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const v = CHECKOUT_VEHICLES[where.id];
        if (!v) throw new Error(`no vehicle ${where.id}`);
        return v;
      }),
      update: vi.fn(async () => null),
    },
    booking: {
      update: vi.fn(async (_args: { data: Record<string, unknown> }) => ({
        id: booking.id,
        status: "ACTIVE",
        actualPickupDateTime: new Date(),
      })),
    },
    vehicleStatusLog: { create: vi.fn(async () => null) },
  };
  const prisma = {
    booking: { findUniqueOrThrow: vi.fn(async () => booking) },
    vehicleCategory: {
      findUniqueOrThrow: vi.fn(async () => ({ name: "Scooter", licenceRequired: null, minAge: null })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ dateOfBirth: null, customerProfile: null })),
      findUnique: vi.fn(async () => null),
    },
    inspection: { findFirst: vi.fn(async () => ({ id: "insp1" })) },
    rentalAgreement: {
      findFirst: vi.fn(async () => ({ id: "ag1" })),
      findUnique: vi.fn(async () => ({ id: "ag1", bookingId: booking.id, status: "SIGNED" })),
    },
    auditLog: { create: vi.fn(async () => null) },
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  };
  const role = opts.role ?? "STAFF";
  const ctx = {
    prisma,
    user: { id: "staff1", role },
    session: { user: { id: "staff1", role } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    _skipAudit: true,
  };
  return { ctx, prisma, tx };
}

const checkOutInput = {
  bookingId: "b1",
  odometerKm: 1000,
  fuelLevel: 100,
  licenceVerified: true,
  customerIdVerified: true,
};

function auditActions(prisma: { auditLog: { create: ReturnType<typeof vi.fn> } }) {
  return prisma.auditLog.create.mock.calls.map(
    (c) => (c[0] as { data: { action: string } }).data.action,
  );
}

describe("staffBooking.checkOut — supplied-vehicle validation (PR6a)", () => {
  it("rejects a cross-category vehicle", async () => {
    const { ctx, tx } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.checkOut({ ...checkOutInput, vehicleId: "veh-cat2" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Vehicle category does not match the booking.",
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("rejects a vehicle at another depot", async () => {
    const { ctx, tx } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.checkOut({ ...checkOutInput, vehicleId: "veh-d2" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Vehicle is not at the booking's pickup depot.",
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown vehicle id", async () => {
    const { ctx } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.checkOut({ ...checkOutInput, vehicleId: "veh-nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("CONFLICT when the supplied vehicle is already committed elsewhere", async () => {
    isVehicleFreeMock.mockResolvedValue(false);
    const { ctx, tx } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.checkOut({ ...checkOutInput, vehicleId: "veh-ok" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("accepts a free same-category same-depot vehicle", async () => {
    const { ctx, tx } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    const result = await caller.checkOut({ ...checkOutInput, vehicleId: "veh-ok" });
    expect(result.ok).toBe(true);
    const data = (tx.booking.update.mock.calls[0]![0] as {
      data: { vehicleId: string };
    }).data;
    expect(data.vehicleId).toBe("veh-ok");
  });
});

describe("staffBooking.checkOut — PENDING_PAYMENT gate (PR6b)", () => {
  it("blocks PENDING_PAYMENT carrying an online payment intent", async () => {
    const { ctx, prisma } = makeCheckOutCtx(
      makeCheckOutBooking({ status: "PENDING_PAYMENT", source: "WALK_IN", stripePaymentIntentId: "pi_1" }),
    );
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(caller.checkOut(checkOutInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a PENDING_PAYMENT website booking even without a PI", async () => {
    const { ctx } = makeCheckOutCtx(
      makeCheckOutBooking({ status: "PENDING_PAYMENT", source: "WEBSITE", stripePaymentIntentId: null }),
    );
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(caller.checkOut(checkOutInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("allows an offline PENDING_PAYMENT booking with no PI and audits the exception", async () => {
    const { ctx, prisma } = makeCheckOutCtx(
      makeCheckOutBooking({ status: "PENDING_PAYMENT", source: "WALK_IN", stripePaymentIntentId: null }),
    );
    const caller = staffBookingRouter.createCaller(ctx as never);
    const result = await caller.checkOut(checkOutInput);
    expect(result.ok).toBe(true);
    expect(auditActions(prisma)).toContain("BOOKING_CHECKOUT_FROM_PENDING_PAYMENT");
  });
});

describe("staffBooking.checkOut — typed remainder/bond failures (PR6c)", () => {
  it("returns { ok:false, failedStep:'remainder' } when the auto-charge fails", async () => {
    chargePickupRemainderMock.mockResolvedValue({
      outcome: "no_pm",
      amount: 42,
    });
    const { ctx, prisma } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    const result = await caller.checkOut(checkOutInput);
    expect(result).toMatchObject({
      ok: false,
      failedStep: "remainder",
      amountAud: 42,
    });
    // No handover happened.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns { ok:false, failedStep:'bond' } when the bond hold fails", async () => {
    ensureFreshBondHoldMock.mockResolvedValue({
      ok: false,
      action: "failed",
      errorCode: "card_declined",
    });
    const { ctx, prisma } = makeCheckOutCtx(makeCheckOutBooking());
    const caller = staffBookingRouter.createCaller(ctx as never);
    const result = await caller.checkOut(checkOutInput);
    expect(result).toMatchObject({ ok: false, failedStep: "bond", amountAud: 300 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("staffBooking.checkOut — override manager gate (PR6d)", () => {
  const remainderOverride = { skip: true as const, reason: "EFTPOS receipt 1234" };

  it("FORBIDDEN for STAFF while booking.checkoutOverridesRequireManager is on (default)", async () => {
    const { ctx } = makeCheckOutCtx(makeCheckOutBooking(), { role: "STAFF" });
    const caller = staffBookingRouter.createCaller(ctx as never);
    await expect(
      caller.checkOut({ ...checkOutInput, remainderOverride }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(chargePickupRemainderMock).not.toHaveBeenCalled();
  });

  it("MANAGER may override a failed remainder charge (audited)", async () => {
    chargePickupRemainderMock.mockResolvedValue({
      outcome: "failed",
      amount: 42,
      errorCode: "card_declined",
      errorMessage: "declined",
    });
    const { ctx, prisma } = makeCheckOutCtx(makeCheckOutBooking(), { role: "MANAGER" });
    const caller = staffBookingRouter.createCaller(ctx as never);
    const result = await caller.checkOut({ ...checkOutInput, remainderOverride });
    expect(result.ok).toBe(true);
    expect(auditActions(prisma)).toContain("BOOKING_CHECKOUT_REMAINDER_OVERRIDDEN");
  });

  it("STAFF may override when the setting is off", async () => {
    settingsOverride["booking.checkoutOverridesRequireManager"] = false;
    chargePickupRemainderMock.mockResolvedValue({ outcome: "no_pm", amount: 42 });
    const { ctx, prisma } = makeCheckOutCtx(makeCheckOutBooking(), { role: "STAFF" });
    const caller = staffBookingRouter.createCaller(ctx as never);
    const result = await caller.checkOut({ ...checkOutInput, remainderOverride });
    expect(result.ok).toBe(true);
    expect(auditActions(prisma)).toContain("BOOKING_CHECKOUT_REMAINDER_OVERRIDDEN");
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
