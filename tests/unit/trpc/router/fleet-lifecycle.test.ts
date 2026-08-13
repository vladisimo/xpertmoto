import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Area 6 — loss-event lifecycle wiring for fleet.updateVehicleStatus +
 * fleet.decommission. Lives beside fleet.test.ts (mirror-rule deviation:
 * that file is owned by a concurrent workstream this wave) and covers ONLY
 * the two lifecycle procedures: hard-loss reassignment + the post-commit
 * notifyReassignmentOutcome fan-out and the response shapes the
 * vehicle-change-status dialog renders.
 */

// Import-safety mocks mirroring fleet.test.ts — fleet.ts pulls in the GPS51
// stack, BullMQ queue and Stripe at module level.
vi.mock("../../../../src/server/services/gps51", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/services/gps51")>();
  return { ...actual, queryTracks: vi.fn(), runGps51DailyTrackSync: vi.fn() };
});
vi.mock("../../../../src/server/jobs/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/jobs/queue")>();
  return { ...actual, getQueue: vi.fn(() => null) };
});
vi.mock("../../../../src/server/services/gps51-live-cache", () => ({
  readLiveLocationsCache: vi.fn(async () => null),
  writeLiveLocationsCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/stripe")>();
  return { ...actual, capturePaymentIntent: vi.fn() };
});
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: vi.fn(),
}));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/analytics")>();
  return { ...actual, trackServer: vi.fn(async () => undefined) };
});

// The subject under test: the tx-scoped reassign runs INSIDE the
// transaction; the fan-out runs strictly AFTER commit.
const reassignMock = vi.fn();
const notifyMock = vi.fn();
vi.mock("@/server/services/fleet-reassign", () => ({
  reassignFutureBookings: (...a: unknown[]) => reassignMock(...a),
  notifyReassignmentOutcome: (...a: unknown[]) => notifyMock(...a),
}));

import { fleetRouter } from "../../../../src/server/trpc/router/fleet";

type Caller = ReturnType<typeof fleetRouter.createCaller>;

const SUMMARY = {
  totalAffected: 2,
  reassigned: [{ bookingId: "b1", reference: "XPM-1", newVehicleId: "veh2" }],
  needsManual: [{ bookingId: "b2", reference: "XPM-2" }],
  quotesUnassigned: [],
};

function makeCtx(over: {
  role?: "STAFF" | "MANAGER";
  vehicleStatus?: string;
  activeRentals?: Array<Record<string, unknown>>;
  events?: string[];
} = {}) {
  const events = over.events ?? [];
  const vehicle = {
    id: "veh1",
    internalCode: "MTB-1",
    status: over.vehicleStatus ?? "AVAILABLE",
  };
  const txVehicleUpdate = vi.fn().mockResolvedValue(vehicle);
  const tx = {
    vehicle: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ status: vehicle.status }),
      update: txVehicleUpdate,
    },
  };
  const prisma = {
    vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue(vehicle) },
    booking: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue(over.activeRentals ?? []),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => {
      const result = await fn(tx);
      events.push("commit");
      return result;
    }),
  };
  const role = over.role ?? "MANAGER";
  const ctx = {
    prisma,
    user: { id: "staff1", role },
    session: { user: { id: "staff1", role } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["updateVehicleStatus"]>[0];
  return { ctx, prisma, tx, txVehicleUpdate, events };
}

beforeEach(() => {
  vi.clearAllMocks();
  reassignMock.mockResolvedValue(SUMMARY);
  notifyMock.mockImplementation(async () => undefined);
});

describe("fleet.updateVehicleStatus — hard loss", () => {
  it("reassigns in-tx and fans out notifications strictly post-commit", async () => {
    const { ctx, tx, events } = makeCtx();
    notifyMock.mockImplementation(async () => {
      events.push("notify");
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const res = await caller.updateVehicleStatus({
      vehicleId: "veh1",
      status: "STOLEN",
      reason: "Reported stolen overnight",
    });

    // Reassign ran against the transaction client, not the root client.
    expect(reassignMock).toHaveBeenCalledWith(
      tx,
      "veh1",
      "staff1",
      expect.stringContaining("STOLEN"),
    );
    // Fan-out fired once, AFTER the transaction committed.
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      vehicleId: "veh1",
      actorUserId: "staff1",
      summary: SUMMARY,
      reasonLabel: "STOLEN",
    });
    expect(events).toEqual(["commit", "notify"]);
    // Response shape unchanged for the dialog's results step.
    expect(res.reassignment).toEqual(SUMMARY);
  });

  it("skips reassignment + fan-out entirely for a routine status change", async () => {
    const { ctx } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    const res = await caller.updateVehicleStatus({
      vehicleId: "veh1",
      status: "IN_MAINTENANCE",
      reason: "Scheduled service",
    });

    expect(reassignMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(res.reassignment).toBeNull();
  });

  it("still returns the committed result when the fan-out fails (best-effort)", async () => {
    const { ctx } = makeCtx();
    notifyMock.mockRejectedValue(new Error("redis down"));
    const caller = fleetRouter.createCaller(ctx as never);

    const res = await caller.updateVehicleStatus({
      vehicleId: "veh1",
      status: "WRITTEN_OFF",
      reason: "Insurance write-off",
    });

    expect(res.reassignment).toEqual(SUMMARY);
  });

  it("rejects an empty reason (zod)", async () => {
    const { ctx } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.updateVehicleStatus({ vehicleId: "veh1", status: "STOLEN", reason: "" }),
    ).rejects.toThrow();
  });
});

describe("fleet.decommission", () => {
  it("returns vehicle + reassignment + activeRentals and fans out post-commit", async () => {
    const activeRentals = [{ id: "b9", bookingReference: "XPM-9", status: "ACTIVE" }];
    const { ctx, events } = makeCtx({ activeRentals });
    notifyMock.mockImplementation(async () => {
      events.push("notify");
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const res = await caller.decommission({
      vehicleId: "veh1",
      reason: "WRITTEN_OFF",
      force: false, // hard loss forces anyway
    });

    expect(res.reassignment).toEqual(SUMMARY);
    // Live hires surface to the dialog for manual resolution.
    expect(res.activeRentals).toEqual(activeRentals);
    expect(notifyMock).toHaveBeenCalledWith({
      vehicleId: "veh1",
      actorUserId: "staff1",
      summary: SUMMARY,
      reasonLabel: "WRITTEN_OFF",
    });
    expect(events).toEqual(["commit", "notify"]);
  });

  it("fans out for planned dispositions (SOLD) too", async () => {
    const { ctx } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await caller.decommission({
      vehicleId: "veh1",
      reason: "SOLD",
      salePrice: 4500,
      force: true,
    });

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonLabel: "SOLD", summary: SUMMARY }),
    );
  });

  it("rejects a STAFF caller (managerProcedure)", async () => {
    const { ctx } = makeCtx({ role: "STAFF" });
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.decommission({ vehicleId: "veh1", reason: "STOLEN", force: true }),
    ).rejects.toThrow();
    expect(reassignMock).not.toHaveBeenCalled();
  });
});
