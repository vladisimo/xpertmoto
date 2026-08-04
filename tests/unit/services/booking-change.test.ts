import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteMock = vi.fn();
vi.mock("@/server/services/pricing", async (orig) => ({
  ...(await orig<typeof import("@/server/services/pricing")>()),
  quote: (...a: unknown[]) => quoteMock(...a),
}));
vi.mock("@/server/services/availability", () => ({
  isVehicleFree: vi.fn().mockResolvedValue(true),
  countAvailable: vi.fn().mockResolvedValue({ total: 3, available: 2 }),
}));
vi.mock("@/server/services/booking-times-guard", () => ({
  enforceDateTimeWithinDepotHours: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn(),
  writeCustomerAuditAsync: vi.fn(),
}));
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn(),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT Moto" }),
}));
const tryIssueAdjustmentForBooking = vi.fn();
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...a: unknown[]) => tryIssueAdjustmentForBooking(...a),
}));

import {
  previewBookingChange,
  applyBookingChange,
  BookingChangeNotAllowedError,
  BookingChangeConflictError,
} from "@/server/services/booking-change";

// Far-future window so the real Date.now() "pickup not in the past" guard holds.
const OLD_PICKUP = new Date("2027-07-06T09:00:00Z");
const OLD_RETURN = new Date("2027-07-09T09:00:00Z");

function makeBooking(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    bookingReference: "SCT-20270706-AAA111",
    status: "CONFIRMED",
    customerId: "cust1",
    categoryId: "cat1",
    vehicleId: null,
    pickupDepotId: "depot1",
    returnDepotId: "depot1",
    pickupDateTime: OLD_PICKUP,
    returnDateTime: OLD_RETURN,
    durationDays: 3,
    totalAmount: 243,
    amountPaid: 103.5,
    balanceDue: 139.5,
    discountAmount: 0,
    deliveryFee: 0,
    extensionOfId: null,
    subscriptionId: null,
    billingPlan: null,
    addons: [],
    insurance: [{ insuranceOptionId: "ins1", dailyRate: 12 }],
    category: { id: "cat1", name: "Scooter" },
    customer: { firstName: "Vlad" },
    ...over,
  };
}

function makePrisma(booking: Record<string, unknown>, opts: { casMatches?: boolean } = {}) {
  // The commit path runs inside $transaction with a CAS updateMany guard;
  // casMatches=false simulates a concurrent change landing between preview
  // and commit (the CAS matches zero rows).
  const tx = {
    booking: {
      updateMany: vi.fn().mockResolvedValue({ count: opts.casMatches === false ? 0 : 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
    },
    bookingNote: { create: vi.fn() },
    bookingStatusLog: { create: vi.fn() },
    payment: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
  const prisma = {
    booking: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
    },
    payment: { findFirst: vi.fn().mockResolvedValue({ id: "pay_chg" }) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as never, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  quoteMock.mockResolvedValue({ totalAmount: 243, durationDays: 3, gstAmount: 22.09 });
});

describe("previewBookingChange — guards", () => {
  it("rejects a non-CONFIRMED booking", async () => {
    const { prisma } = makePrisma(makeBooking({ status: "ACTIVE" }));
    await expect(
      previewBookingChange(prisma, {
        bookingId: "b1",
        newPickupDateTime: OLD_PICKUP,
        newReturnDateTime: new Date("2027-07-13T09:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(BookingChangeNotAllowedError);
  });

  it("rejects a discounted booking (code not stored — can't re-quote faithfully)", async () => {
    const { prisma } = makePrisma(makeBooking({ discountAmount: 20 }));
    await expect(
      previewBookingChange(prisma, {
        bookingId: "b1",
        newPickupDateTime: OLD_PICKUP,
        newReturnDateTime: new Date("2027-07-13T09:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(BookingChangeNotAllowedError);
  });

  it("rejects a subscription / long-term-plan booking", async () => {
    const { prisma } = makePrisma(makeBooking({ subscriptionId: "sub1" }));
    await expect(
      previewBookingChange(prisma, {
        bookingId: "b1",
        newPickupDateTime: OLD_PICKUP,
        newReturnDateTime: new Date("2027-07-13T09:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(BookingChangeNotAllowedError);
  });

  it("rejects an unchanged window", async () => {
    const { prisma } = makePrisma(makeBooking());
    await expect(
      previewBookingChange(prisma, {
        bookingId: "b1",
        newPickupDateTime: OLD_PICKUP,
        newReturnDateTime: OLD_RETURN,
      }),
    ).rejects.toBeInstanceOf(BookingChangeNotAllowedError);
  });
});

describe("previewBookingChange — repricing & settlement maths", () => {
  it("computes an INCREASE delta and raised balance", async () => {
    quoteMock.mockResolvedValue({ totalAmount: 405, durationDays: 5 });
    const { prisma } = makePrisma(makeBooking());

    const { preview } = await previewBookingChange(prisma, {
      bookingId: "b1",
      newPickupDateTime: OLD_PICKUP,
      newReturnDateTime: new Date("2027-07-13T09:00:00Z"),
    });

    expect(preview.direction).toBe("INCREASE");
    expect(preview.delta).toBe(162); // 405 − 243
    expect(preview.newBalanceDue).toBe(301.5); // 139.50 + 162
    expect(preview.creditAmount).toBe(0);
  });

  it("computes a DECREASE within the balance (no credit)", async () => {
    quoteMock.mockResolvedValue({ totalAmount: 162, durationDays: 2 });
    const { prisma } = makePrisma(makeBooking());

    const { preview } = await previewBookingChange(prisma, {
      bookingId: "b1",
      newPickupDateTime: OLD_PICKUP,
      newReturnDateTime: new Date("2027-07-08T09:00:00Z"),
    });

    expect(preview.direction).toBe("DECREASE");
    expect(preview.delta).toBe(-81); // 162 − 243
    expect(preview.newBalanceDue).toBe(58.5); // 139.50 − 81
    expect(preview.creditAmount).toBe(0);
  });

  it("retains the surplus as account credit when a reduction overpays the balance", async () => {
    // Fully-paid booking (balanceDue 0); a big reduction overpays it.
    quoteMock.mockResolvedValue({ totalAmount: 162, durationDays: 2 });
    const { prisma } = makePrisma(makeBooking({ totalAmount: 483, amountPaid: 483, balanceDue: 0 }));

    const { preview } = await previewBookingChange(prisma, {
      bookingId: "b1",
      newPickupDateTime: OLD_PICKUP,
      newReturnDateTime: new Date("2027-07-08T09:00:00Z"),
    });

    expect(preview.direction).toBe("DECREASE");
    expect(preview.delta).toBe(-321); // 162 − 483
    expect(preview.newBalanceDue).toBe(0); // clamped
    expect(preview.creditAmount).toBe(321); // retained as credit, not refunded
  });
});

describe("applyBookingChange — settlement side effects", () => {
  it("raises a PENDING EXTENSION charge and an INCREASE adjustment on an increase", async () => {
    quoteMock.mockResolvedValue({ totalAmount: 405, durationDays: 5 });
    const { prisma, tx } = makePrisma(makeBooking());

    await applyBookingChange(prisma, {
      bookingId: "b1",
      newPickupDateTime: OLD_PICKUP,
      newReturnDateTime: new Date("2027-07-13T09:00:00Z"),
      actorUserId: "cust1",
    });

    const cas = tx.booking.updateMany.mock.calls[0]![0]! as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // CAS keyed on the exact previewed state — a concurrent change loses.
    expect(cas.where).toMatchObject({
      id: "b1",
      status: "CONFIRMED",
      pickupDateTime: OLD_PICKUP,
      returnDateTime: OLD_RETURN,
    });
    expect(cas.data.balanceDue).toBe(301.5);
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "EXTENSION",
          status: "PENDING",
          amount: 162,
          reference: "CHG-b1-1", // deterministic per-booking sequence, not Date.now()
        }),
      }),
    );
    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledWith(
      expect.objectContaining({ type: "INCREASE", bookingId: "b1" }),
    );
  });

  it("creates no Payment and issues a DECREASE adjustment on a reduction", async () => {
    quoteMock.mockResolvedValue({ totalAmount: 162, durationDays: 2 });
    const { prisma, tx } = makePrisma(makeBooking());

    await applyBookingChange(prisma, {
      bookingId: "b1",
      newPickupDateTime: OLD_PICKUP,
      newReturnDateTime: new Date("2027-07-08T09:00:00Z"),
      actorUserId: "cust1",
    });

    expect(tx.payment.create).not.toHaveBeenCalled();
    const cas = tx.booking.updateMany.mock.calls[0]![0]! as {
      data: Record<string, unknown>;
    };
    expect(cas.data.balanceDue).toBe(58.5);
    expect(tryIssueAdjustmentForBooking).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DECREASE", bookingId: "b1" }),
    );
  });

  it("throws a conflict (and raises no charge) when the CAS loses a concurrent change", async () => {
    quoteMock.mockResolvedValue({ totalAmount: 405, durationDays: 5 });
    const { prisma, tx } = makePrisma(makeBooking(), { casMatches: false });

    await expect(
      applyBookingChange(prisma, {
        bookingId: "b1",
        newPickupDateTime: OLD_PICKUP,
        newReturnDateTime: new Date("2027-07-13T09:00:00Z"),
        actorUserId: "cust1",
      }),
    ).rejects.toBeInstanceOf(BookingChangeConflictError);
    // The loser must not create a second chargeable Payment row.
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tryIssueAdjustmentForBooking).not.toHaveBeenCalled();
  });
});
