import { describe, expect, it } from "vitest";
import { collectWorkOrderTasks } from "../../../../src/server/services/task-collectors/work-orders";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

function mockDb(rows: unknown[]): PrismaLike {
  return {
    maintenanceWorkOrder: {
      findMany: async () => rows,
    },
  } as unknown as PrismaLike;
}

describe("collectWorkOrderTasks", () => {
  it("maps WO priority to tier and downgrades AWAITING_PARTS", async () => {
    const db = mockDb([
      {
        id: "wo1",
        workOrderNumber: "WO-001",
        title: "Brake service",
        priority: "URGENT",
        status: "OPEN",
        depotId: "d1",
        scheduledStartAt: null,
        createdAt: new Date(),
        type: "BRAKE_SERVICE",
        vehicle: { id: "veh_1", internalCode: "SCT-V1", rego: "123ABC" },
        assignedTo: null,
      },
      {
        id: "wo2",
        workOrderNumber: "WO-002",
        title: "Waiting on tyres",
        priority: "HIGH",
        status: "AWAITING_PARTS",
        depotId: "d1",
        scheduledStartAt: null,
        createdAt: new Date(),
        type: "TYRE_REPLACEMENT",
        vehicle: { internalCode: "SCT-V2", rego: "456DEF" },
        assignedTo: { firstName: "Alex", lastName: "Ng" },
      },
      {
        id: "wo3",
        workOrderNumber: "WO-003",
        title: "Tidy up",
        priority: "LOW",
        status: "ASSIGNED",
        depotId: "d1",
        scheduledStartAt: null,
        createdAt: new Date(),
        type: "CUSTOM",
        vehicle: { internalCode: "SCT-V3", rego: "789GHI" },
        assignedTo: null,
      },
    ]);
    const tasks = await collectWorkOrderTasks(db);
    const byId = new Map(tasks.map((t) => [t.targetEntityId, t]));
    expect(byId.get("wo1")?.tier).toBe("URGENT");
    expect(byId.get("wo2")?.tier).toBe("MEDIUM"); // HIGH + AWAITING_PARTS → downshift
    expect(byId.get("wo3")?.tier).toBe("LOW");
    expect(byId.get("wo1")?.actionUrl).toBe("/staff/maintenance/wo1");
    // Work orders link only to the asset — no booking/customer context.
    expect(byId.get("wo1")?.links).toEqual({ vehicleId: "veh_1" });
  });
});
