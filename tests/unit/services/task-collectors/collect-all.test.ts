import { describe, expect, it, vi } from "vitest";
import { collectAllTasks } from "../../../../src/server/services/task-collectors";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

/**
 * The aggregator's job: run every collector in parallel, enforce a per-
 * collector time budget, flag degraded output, and sort the merged list
 * by (tier, oldest-first). We exercise those invariants directly.
 */

function emptyDb(): PrismaLike {
  return {
    booking: { findMany: async () => [] },
    inspection: { findMany: async () => [] },
    maintenanceWorkOrder: { findMany: async () => [] },
    rentalAgreement: { findMany: async () => [] },
    returnAssessment: { findMany: async () => [] },
  } as unknown as PrismaLike;
}

describe("collectAllTasks", () => {
  it("returns empty set with no failures when every collector returns nothing", async () => {
    const { tasks, failed } = await collectAllTasks(emptyDb());
    expect(tasks).toEqual([]);
    expect(failed).toEqual([]);
  });

  it("sorts merged results by tier then by actionableSince ascending", async () => {
    const now = new Date("2026-04-18T10:00:00Z");
    const db = {
      booking: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: "b_old_medium",
              bookingReference: "M1",
              pickupDateTime: new Date("2026-04-18T18:00:00Z"),
              depotId: "d1",
              customer: { firstName: "A", lastName: "A" },
              category: { name: "150cc" },
              vehicle: null,
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      },
      inspection: { findMany: async () => [] },
      maintenanceWorkOrder: {
        findMany: async () => [
          {
            id: "wo_urgent",
            workOrderNumber: "WO-1",
            title: "Urgent",
            priority: "URGENT",
            status: "OPEN",
            depotId: "d1",
            scheduledStartAt: null,
            createdAt: new Date("2026-04-18T09:00:00Z"),
            type: "BRAKE_SERVICE",
            vehicle: { internalCode: "V1", rego: "X" },
            assignedTo: null,
          },
        ],
      },
      rentalAgreement: { findMany: async () => [] },
      returnAssessment: { findMany: async () => [] },
    } as unknown as PrismaLike;

    const { tasks } = await collectAllTasks(db, { now });
    expect(tasks.map((t) => t.targetEntityId)).toEqual(["wo_urgent", "b_old_medium"]);
  });

  it("marks degraded and lists failed collectors when one throws", async () => {
    const db = {
      booking: {
        findMany: async () => {
          throw new Error("boom");
        },
      },
      inspection: { findMany: async () => [] },
      maintenanceWorkOrder: { findMany: async () => [] },
      rentalAgreement: { findMany: async () => [] },
      returnAssessment: { findMany: async () => [] },
    } as unknown as PrismaLike;
    // Silence expected console.error from the aggregator
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tasks, failed } = await collectAllTasks(db);
    err.mockRestore();
    expect(tasks).toEqual([]);
    expect(failed).toContain("bookings");
  });

  it("honours typeFilter by skipping non-matching collectors", async () => {
    const bookingFindMany = vi.fn().mockResolvedValue([]);
    const inspectionFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      booking: { findMany: bookingFindMany },
      inspection: { findMany: inspectionFindMany },
      maintenanceWorkOrder: { findMany: async () => [] },
      rentalAgreement: { findMany: async () => [] },
      returnAssessment: { findMany: async () => [] },
    } as unknown as PrismaLike;
    await collectAllTasks(db, { typeFilter: ["MAINTENANCE_WORK_ORDER"] });
    expect(bookingFindMany).not.toHaveBeenCalled();
    expect(inspectionFindMany).not.toHaveBeenCalled();
  });
});
