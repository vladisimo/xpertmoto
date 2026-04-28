import { describe, expect, it } from "vitest";
import { collectInspectionTasks } from "../../../../src/server/services/task-collectors/inspections";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

const now = new Date("2026-04-18T10:00:00Z");

function mockDb(rows: unknown[]): PrismaLike {
  return {
    inspection: {
      findMany: async () => rows,
    },
  } as unknown as PrismaLike;
}

describe("collectInspectionTasks", () => {
  it("emits INSPECTION_PRE_HIRE with URGENT tier when the pickup is in the past", async () => {
    const db = mockDb([
      {
        id: "i1",
        type: "PRE_HIRE",
        depotId: "d1",
        createdAt: new Date("2026-04-18T07:00:00Z"),
        booking: {
          id: "b1",
          bookingReference: "SCT-P1",
          pickupDateTime: new Date("2026-04-18T08:00:00Z"),
          returnDateTime: new Date("2026-04-19T08:00:00Z"),
          customer: { firstName: "Jess", lastName: "Ng" },
        },
        vehicle: { internalCode: "SCT-V1", rego: "123ABC" },
      },
    ]);
    const [task] = await collectInspectionTasks(db, { now });
    expect(task?.taskType).toBe("INSPECTION_PRE_HIRE");
    expect(task?.tier).toBe("URGENT");
    expect(task?.actionUrl).toBe("/staff/bookings/b1/check-out/inspect");
  });

  it("emits INSPECTION_POST_HIRE with HIGH tier when return is imminent", async () => {
    const db = mockDb([
      {
        id: "i2",
        type: "POST_HIRE",
        depotId: "d1",
        createdAt: new Date("2026-04-18T09:00:00Z"),
        booking: {
          id: "b2",
          bookingReference: "SCT-P2",
          pickupDateTime: new Date("2026-04-17T10:00:00Z"),
          returnDateTime: new Date("2026-04-18T11:30:00Z"),
          customer: { firstName: "Ben", lastName: "Smith" },
        },
        vehicle: { internalCode: "SCT-V2", rego: "456DEF" },
      },
    ]);
    const [task] = await collectInspectionTasks(db, { now });
    expect(task?.taskType).toBe("INSPECTION_POST_HIRE");
    expect(task?.tier).toBe("HIGH");
    expect(task?.actionUrl).toBe("/staff/bookings/b2/check-in/inspect");
  });
});
