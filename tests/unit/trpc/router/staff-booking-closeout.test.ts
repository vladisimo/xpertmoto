import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// closeOut now records booking completion (revenue + rewards recompute). Stub
// the aggregator so this stays a pure unit test of the close-out transition.
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordBookingCompletion: vi.fn().mockResolvedValue(undefined),
  recordAdditionalCharges: vi.fn().mockResolvedValue(undefined),
  invalidateRevenueCaches: vi.fn().mockResolvedValue(undefined),
}));

import { staffBookingRouter } from "@/server/trpc/router/staff-booking";

type CallerCtx = Parameters<typeof staffBookingRouter.createCaller>[0];

function makeCtx(booking: Record<string, unknown> | null) {
  const findUniqueOrThrow = vi.fn().mockImplementation(async () => {
    if (!booking) throw new Error("not found");
    return booking;
  });
  const update = vi.fn().mockResolvedValue({ id: "b1", status: "COMPLETED" });
  const vehicleFindUniqueOrThrow = vi.fn().mockResolvedValue({ depotId: "d1" });
  const vehicleUpdate = vi.fn().mockResolvedValue({});
  const vehicleLogCreate = vi.fn().mockResolvedValue({});
  const statusLogCreate = vi.fn().mockResolvedValue({});

  const tx = {
    booking: { update },
    vehicle: { findUniqueOrThrow: vehicleFindUniqueOrThrow, update: vehicleUpdate },
    vehicleStatusLog: { create: vehicleLogCreate },
    bookingStatusLog: { create: statusLogCreate },
  };
  const prisma = {
    booking: { findUniqueOrThrow },
    $transaction: vi.fn().mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };

  const ctx = {
    prisma,
    user: { id: "u1", role: "STAFF" },
    session: { user: { id: "u1", role: "STAFF" } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  } as unknown as CallerCtx;

  return { ctx, prisma, update, vehicleUpdate, statusLogCreate };
}

describe("staffBooking.closeOut", () => {
  it("rejects when the booking is in a status that cannot be closed", async () => {
    const { ctx } = makeCtx({
      id: "b1",
      status: "CONFIRMED",
      customerId: "c1",
      vehicleId: null,
      returnDepotId: null,
      bookingReference: "SCT-1",
      returnAssessments: [{ status: "SIGNED" }],
    });
    const caller = staffBookingRouter.createCaller(ctx);
    await expect(caller.closeOut({ bookingId: "b1" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects when no signed return assessment exists", async () => {
    const { ctx } = makeCtx({
      id: "b1",
      status: "OVERDUE",
      customerId: "c1",
      vehicleId: null,
      returnDepotId: null,
      bookingReference: "SCT-1",
      returnAssessments: [{ status: "DRAFT" }],
    });
    const caller = staffBookingRouter.createCaller(ctx);
    await expect(caller.closeOut({ bookingId: "b1" })).rejects.toThrow(/signed return assessment/);
  });

  it("closes a signed OVERDUE booking, flips vehicle to AVAILABLE, transitions to COMPLETED", async () => {
    const { ctx, update, vehicleUpdate, statusLogCreate } = makeCtx({
      id: "b1",
      status: "OVERDUE",
      customerId: "c1",
      vehicleId: "v1",
      returnDepotId: "d1",
      bookingReference: "SCT-1",
      returnAssessments: [{ status: "SIGNED" }],
    });
    const caller = staffBookingRouter.createCaller(ctx);
    const result = await caller.closeOut({ bookingId: "b1" });
    expect(result.status).toBe("COMPLETED");

    expect(statusLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ previousStatus: "OVERDUE", newStatus: "RETURNED" }),
      }),
    );
    expect(vehicleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "AVAILABLE" }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED", checkedInById: "u1" }),
      }),
    );
  });

  it("skips the intermediate RETURNED transition when booking is already RETURNED", async () => {
    const { ctx, update, statusLogCreate } = makeCtx({
      id: "b1",
      status: "RETURNED",
      customerId: "c1",
      vehicleId: "v1",
      returnDepotId: "d1",
      bookingReference: "SCT-1",
      returnAssessments: [{ status: "FINALISED" }],
    });
    const caller = staffBookingRouter.createCaller(ctx);
    await caller.closeOut({ bookingId: "b1" });
    expect(statusLogCreate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
