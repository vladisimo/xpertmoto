import { beforeEach, describe, expect, it, vi } from "vitest";

// Pure unit test: allocation, notifications, cache and branding are stubbed
// so the specs exercise only the reassignment bucketing + fan-out logic.
const allocateVehicleMock = vi.fn();
const acquireAllocationLockMock = vi.fn();
vi.mock("@/server/services/availability", () => ({
  allocateVehicle: (...a: unknown[]) => allocateVehicleMock(...a),
  acquireAllocationLock: (...a: unknown[]) => acquireAllocationLockMock(...a),
}));
const sendNotificationMock = vi.fn();
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
const invalidateAvailabilityMock = vi.fn();
vi.mock("@/server/services/availability-cache", () => ({
  invalidateAvailability: (...a: unknown[]) => invalidateAvailabilityMock(...a),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT Moto" }),
}));
vi.mock("@react-email/render", () => ({ render: vi.fn().mockResolvedValue("<html></html>") }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  reassignFutureBookings,
  notifyReassignmentOutcome,
  type ReassignSummary,
} from "../../../src/server/services/fleet-reassign";

const HOUR = 3_600_000;

type BookingRow = {
  id: string;
  bookingReference: string;
  status: string;
  categoryId: string;
  pickupDepotId: string;
  pickupDateTime: Date;
  returnDateTime: Date;
};

function makeBooking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: over.id ?? "b1",
    bookingReference: over.bookingReference ?? "XPM-20260810-0001",
    status: over.status ?? "CONFIRMED",
    categoryId: over.categoryId ?? "cat1",
    pickupDepotId: over.pickupDepotId ?? "depot1",
    pickupDateTime: over.pickupDateTime ?? new Date(Date.now() + 24 * HOUR),
    returnDateTime: over.returnDateTime ?? new Date(Date.now() + 72 * HOUR),
  };
}

function makeTx(bookings: BookingRow[]) {
  return {
    booking: {
      findMany: vi.fn().mockResolvedValue(bookings),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  allocateVehicleMock.mockResolvedValue("veh2");
  acquireAllocationLockMock.mockResolvedValue(undefined);
});

describe("reassignFutureBookings — widened scope", () => {
  it("queries QUOTE + PENDING_PAYMENT + CONFIRMED with no pickup-time filter", async () => {
    const tx = makeTx([]);

    await reassignFutureBookings(tx as never, "veh1", "staff1", "Vehicle MTB-1 → STOLEN");

    expect(tx.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vehicleId: "veh1",
          status: { in: ["QUOTE", "PENDING_PAYMENT", "CONFIRMED"] },
        },
      }),
    );
  });

  it("auto-reassigns a future PENDING_PAYMENT booking like a CONFIRMED one", async () => {
    const b = makeBooking({ status: "PENDING_PAYMENT" });
    const tx = makeTx([b]);

    const summary = await reassignFutureBookings(tx as never, "veh1", "staff1", "prefix");

    expect(summary.reassigned).toEqual([
      { bookingId: "b1", reference: b.bookingReference, newVehicleId: "veh2" },
    ]);
    expect(summary.needsManual).toEqual([]);
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({
          vehicleId: "veh2",
          bookingNotes: { create: expect.objectContaining({ isInternal: false }) },
        }),
      }),
    );
  });

  it("sends a past-pickup booking straight to needsManual — never auto-swapped", async () => {
    const b = makeBooking({ pickupDateTime: new Date(Date.now() - 2 * HOUR) });
    const tx = makeTx([b]);

    const summary = await reassignFutureBookings(tx as never, "veh1", "staff1", "prefix");

    // No allocation attempt for a booking whose pickup already passed.
    expect(allocateVehicleMock).not.toHaveBeenCalled();
    expect(summary.reassigned).toEqual([]);
    expect(summary.needsManual).toEqual([{ bookingId: "b1", reference: b.bookingReference }]);
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({
          vehicleId: null,
          bookingNotes: { create: expect.objectContaining({ isInternal: true }) },
          statusLog: { create: expect.anything() },
        }),
      }),
    );
  });

  it("nulls a QUOTE row's vehicle silently — no note, no status log", async () => {
    const b = makeBooking({ status: "QUOTE" });
    const tx = makeTx([b]);

    const summary = await reassignFutureBookings(tx as never, "veh1", "staff1", "prefix");

    expect(summary.quotesUnassigned).toEqual([{ bookingId: "b1", reference: b.bookingReference }]);
    expect(summary.reassigned).toEqual([]);
    expect(summary.needsManual).toEqual([]);
    expect(allocateVehicleMock).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledTimes(1);
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { vehicleId: null },
    });
  });

  it("falls back to needsManual when no compatible replacement exists", async () => {
    allocateVehicleMock.mockResolvedValue(null);
    const b = makeBooking();
    const tx = makeTx([b]);

    const summary = await reassignFutureBookings(tx as never, "veh1", "staff1", "prefix");

    expect(summary.needsManual).toEqual([{ bookingId: "b1", reference: b.bookingReference }]);
    expect(summary.totalAffected).toBe(1);
  });
});

describe("notifyReassignmentOutcome — post-commit fan-out", () => {
  const summary: ReassignSummary = {
    totalAffected: 3,
    reassigned: [{ bookingId: "b1", reference: "XPM-1", newVehicleId: "veh2" }],
    needsManual: [{ bookingId: "b2", reference: "XPM-2" }],
    quotesUnassigned: [{ bookingId: "b3", reference: "XPM-3" }],
  };

  const ret1 = new Date(Date.now() + 72 * HOUR);
  const ret2 = new Date(Date.now() + 120 * HOUR); // latest affected return

  function makePrisma() {
    return {
      vehicle: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "veh1", internalCode: "MTB-1", depotId: "depot1" }),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "b1",
            bookingReference: "XPM-1",
            pickupDateTime: new Date(Date.now() + 24 * HOUR),
            returnDateTime: ret1,
            customer: { id: "cust1", firstName: "Vlad" },
          },
          {
            id: "b2",
            bookingReference: "XPM-2",
            pickupDateTime: new Date(Date.now() + 96 * HOUR),
            returnDateTime: ret2,
            customer: { id: "cust2", firstName: "Sam" },
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "mgr1" }, { id: "mgr2" }]),
      },
    };
  }

  it("emails each reassigned customer, digests managers, and invalidates availability", async () => {
    const prisma = makePrisma();

    await notifyReassignmentOutcome({
      vehicleId: "veh1",
      actorUserId: "staff1",
      summary,
      reasonLabel: "STOLEN",
      prisma: prisma as never,
    });

    // Availability: removed vehicle's depot, now → latest affected return.
    expect(invalidateAvailabilityMock).toHaveBeenCalledTimes(1);
    const [depotId, from, to] = invalidateAvailabilityMock.mock.calls[0]!;
    expect(depotId).toBe("depot1");
    expect((from as Date).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(to).toEqual(ret2);

    // One customer email (EMAIL only) for the reassigned booking.
    const customerCalls = sendNotificationMock.mock.calls
      .map(([arg]) => arg as Record<string, unknown>)
      .filter((a) => a.userId === "cust1");
    expect(customerCalls).toHaveLength(1);
    expect(customerCalls[0]).toMatchObject({
      type: "BOOKING_MODIFIED",
      channels: ["EMAIL"],
      bookingId: "b1",
      dedupKey: "vehicle-reassigned:b1:veh2",
    });

    // needsManual customer must NOT get the "vehicle updated" email.
    expect(
      sendNotificationMock.mock.calls.some(([a]) => (a as { userId: string }).userId === "cust2"),
    ).toBe(false);

    // One digest per manager, IN_APP + EMAIL, with the manual references.
    const managerCalls = sendNotificationMock.mock.calls
      .map(([arg]) => arg as Record<string, unknown>)
      .filter((a) => a.userId === "mgr1" || a.userId === "mgr2");
    expect(managerCalls).toHaveLength(2);
    expect(managerCalls[0]).toMatchObject({
      channels: ["IN_APP", "EMAIL"],
      data: expect.objectContaining({
        bookingIds: ["b2"],
        references: ["XPM-2"],
      }),
    });
    expect(String(managerCalls[0]!.body)).toContain("XPM-2");
    // Managers looked up depot-scoped (this depot + org-wide).
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ depotId: "depot1" }, { depotId: null }],
        }),
      }),
    );
  });

  it("skips the manager digest when nothing needs manual resolution", async () => {
    const prisma = makePrisma();

    await notifyReassignmentOutcome({
      vehicleId: "veh1",
      actorUserId: "staff1",
      summary: { ...summary, needsManual: [] },
      reasonLabel: "WRITTEN_OFF",
      prisma: prisma as never,
    });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    const managerCalls = sendNotificationMock.mock.calls
      .map(([arg]) => arg as Record<string, unknown>)
      .filter((a) => a.userId !== "cust1");
    expect(managerCalls).toHaveLength(0);
  });

  it("is best-effort: a failing email never rejects the fan-out", async () => {
    sendNotificationMock.mockRejectedValue(new Error("resend down"));
    const prisma = makePrisma();

    await expect(
      notifyReassignmentOutcome({
        vehicleId: "veh1",
        actorUserId: "staff1",
        summary,
        reasonLabel: "STOLEN",
        prisma: prisma as never,
      }),
    ).resolves.toBeUndefined();

    // The cache invalidation still happened despite the email failure.
    expect(invalidateAvailabilityMock).toHaveBeenCalledTimes(1);
  });
});
