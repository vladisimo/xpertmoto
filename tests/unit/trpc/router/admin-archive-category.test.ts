import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * admin.archiveCategory — DISPOSE-path lifecycle wiring (round-2 review).
 * Split file per the admin-* precedent; covers ONLY the archive procedure:
 * the in-tx reassign of future bookings for each disposed vehicle and the
 * post-commit notifyReassignmentOutcome fan-out that fleet.updateVehicleStatus
 * and fleet.decommission already carry (customer emails + manager digest +
 * availability invalidation). Mock shapes mirror fleet-lifecycle.test.ts.
 */

const reassignMock = vi.fn();
const notifyMock = vi.fn();
vi.mock("@/server/services/fleet-reassign", () => ({
  reassignFutureBookings: (...a: unknown[]) => reassignMock(...a),
  notifyReassignmentOutcome: (...a: unknown[]) => notifyMock(...a),
}));
const invalidateTagMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/cache")>();
  return { ...actual, invalidateTag: (...a: unknown[]) => invalidateTagMock(...a) };
});

import { adminRouter } from "../../../../src/server/trpc/router/admin";

type Caller = ReturnType<typeof adminRouter.createCaller>;

const SUMMARY = {
  totalAffected: 2,
  reassigned: [{ bookingId: "b1", reference: "XPM-1", newVehicleId: "veh2" }],
  needsManual: [{ bookingId: "b2", reference: "XPM-2" }],
  quotesUnassigned: [],
};

function makeCtx(over: {
  vehicles?: Array<Record<string, unknown>>;
  activeRentals?: Array<Record<string, unknown>>;
  events?: string[];
} = {}) {
  const events = over.events ?? [];
  const vehicles = over.vehicles ?? [
    { id: "veh1", internalCode: "SC-01", status: "AVAILABLE" },
  ];
  const txVehicleUpdate = vi.fn().mockResolvedValue({});
  const txCategoryUpdate = vi
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, isActive: false }),
    );
  const tx = {
    vehicle: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ status: "AVAILABLE", internalCode: "SC-01" }),
      update: txVehicleUpdate,
    },
    vehicleCategory: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cat2" }),
      update: txCategoryUpdate,
    },
  };
  const prisma = {
    vehicleCategory: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cat1", name: "Scooters 50cc" }),
    },
    vehicle: { findMany: vi.fn().mockResolvedValue(vehicles) },
    booking: { findMany: vi.fn().mockResolvedValue(over.activeRentals ?? []) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => {
      const result = await fn(tx);
      events.push("commit");
      return result;
    }),
  };
  const ctx = {
    prisma,
    user: { id: "mgr1", role: "MANAGER" },
    session: {
      user: { id: "mgr1", role: "MANAGER" },
      pending2fa: false,
      requiresOnboarding: false,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["archiveCategory"]>[0];
  return { ctx, prisma, tx, txVehicleUpdate, events };
}

beforeEach(() => {
  vi.clearAllMocks();
  reassignMock.mockResolvedValue(SUMMARY);
  notifyMock.mockImplementation(async () => undefined);
});

describe("admin.archiveCategory — DISPOSE fan-out", () => {
  it("reassigns in-tx and fans out notifyReassignmentOutcome strictly post-commit", async () => {
    const { ctx, tx, events } = makeCtx();
    notifyMock.mockImplementation(async () => {
      events.push("notify");
    });
    const caller = adminRouter.createCaller(ctx as never);

    const res = await caller.archiveCategory({
      id: "cat1",
      vehicleActions: [
        {
          action: "DISPOSE",
          vehicleId: "veh1",
          targetStatus: "WRITTEN_OFF",
          reason: "Frame cracked — uneconomical to repair",
        },
      ],
    });

    // Reassign ran against the transaction client, not the root client.
    expect(reassignMock).toHaveBeenCalledWith(
      tx,
      "veh1",
      "mgr1",
      expect.stringContaining("WRITTEN_OFF"),
    );
    // Fan-out fired once per disposed vehicle, AFTER the tx committed —
    // same contract as fleet.updateVehicleStatus / fleet.decommission.
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      vehicleId: "veh1",
      actorUserId: "mgr1",
      summary: SUMMARY,
      reasonLabel: "WRITTEN_OFF",
    });
    expect(events).toEqual(["commit", "notify"]);
    expect(res.category).toMatchObject({ id: "cat1", isActive: false });
    expect(res.actioned).toBe(1);
  });

  it("fans out once per disposed vehicle", async () => {
    const { ctx } = makeCtx({
      vehicles: [
        { id: "veh1", internalCode: "SC-01", status: "AVAILABLE" },
        { id: "veh2", internalCode: "SC-02", status: "AVAILABLE" },
      ],
    });
    const caller = adminRouter.createCaller(ctx as never);

    await caller.archiveCategory({
      id: "cat1",
      vehicleActions: [
        { action: "DISPOSE", vehicleId: "veh1", targetStatus: "SOLD", reason: "Fleet sale", salePrice: 2100 },
        { action: "DISPOSE", vehicleId: "veh2", targetStatus: "END_OF_LIFE", reason: "Worn out" },
      ],
    });

    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: "veh1", reasonLabel: "SOLD" }),
    );
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: "veh2", reasonLabel: "END_OF_LIFE" }),
    );
  });

  it("skips reassignment + fan-out for a pure REASSIGN archive", async () => {
    const { ctx } = makeCtx();
    const caller = adminRouter.createCaller(ctx as never);

    await caller.archiveCategory({
      id: "cat1",
      vehicleActions: [
        { action: "REASSIGN", vehicleId: "veh1", targetCategoryId: "cat2" },
      ],
    });

    expect(reassignMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("still returns the committed archive when the fan-out fails (best-effort)", async () => {
    const { ctx } = makeCtx();
    notifyMock.mockRejectedValue(new Error("redis down"));
    const caller = adminRouter.createCaller(ctx as never);

    const res = await caller.archiveCategory({
      id: "cat1",
      vehicleActions: [
        {
          action: "DISPOSE",
          vehicleId: "veh1",
          targetStatus: "STOLEN",
          reason: "Never recovered",
        },
      ],
    });

    expect(res.category).toMatchObject({ id: "cat1", isActive: false });
  });
});
