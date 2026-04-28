import { describe, expect, it } from "vitest";
import { collectBookingTasks } from "../../../../src/server/services/task-collectors/bookings";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

type Args = { where: Record<string, unknown> };

function mockDb(response: { pickups: unknown[]; returns: unknown[]; overdue: unknown[] }): PrismaLike {
  let call = 0;
  return {
    booking: {
      findMany: async (_args: Args) => {
        const result = call === 0 ? response.pickups : call === 1 ? response.returns : response.overdue;
        call += 1;
        return result;
      },
    },
  } as unknown as PrismaLike;
}

const now = new Date("2026-04-18T10:00:00Z");

const customerStub = { firstName: "Jess", lastName: "Ng", phone: null };
const categoryStub = { name: "150cc Scooter" };
const vehicleStub = { internalCode: "SCT-V1", rego: "123ABC" };

describe("collectBookingTasks", () => {
  it("emits BOOKING_PICKUP for today's pickups, with tier based on imminence", async () => {
    const db = mockDb({
      pickups: [
        {
          id: "b_past",
          bookingReference: "SCT-0001",
          pickupDateTime: new Date("2026-04-18T08:00:00Z"),
          depotId: "d1",
          customer: customerStub,
          category: categoryStub,
          vehicle: vehicleStub,
        },
        {
          id: "b_soon",
          bookingReference: "SCT-0002",
          pickupDateTime: new Date("2026-04-18T11:00:00Z"),
          depotId: "d1",
          customer: customerStub,
          category: categoryStub,
          vehicle: vehicleStub,
        },
        {
          id: "b_later",
          bookingReference: "SCT-0003",
          pickupDateTime: new Date("2026-04-18T18:00:00Z"),
          depotId: "d1",
          customer: customerStub,
          category: categoryStub,
          vehicle: null,
        },
      ],
      returns: [],
      overdue: [],
    });
    const tasks = await collectBookingTasks(db, { now });
    expect(tasks).toHaveLength(3);
    const byId = new Map(tasks.map((t) => [t.targetEntityId, t]));
    expect(byId.get("b_past")?.tier).toBe("URGENT");
    expect(byId.get("b_soon")?.tier).toBe("HIGH");
    expect(byId.get("b_later")?.tier).toBe("MEDIUM");
    expect(byId.get("b_past")?.actionUrl).toBe("/staff/bookings/b_past/check-out");
  });

  it("emits BOOKING_RETURN and BOOKING_OVERDUE_CHASE with correct tiers", async () => {
    const db = mockDb({
      pickups: [],
      returns: [
        {
          id: "r_soon",
          bookingReference: "SCT-R1",
          returnDateTime: new Date("2026-04-18T11:30:00Z"),
          depotId: "d1",
          returnDepotId: "d1",
          customer: customerStub,
          category: categoryStub,
          vehicle: vehicleStub,
        },
      ],
      overdue: [
        {
          id: "o_late",
          bookingReference: "SCT-O1",
          returnDateTime: new Date("2026-04-16T10:00:00Z"),
          overdueStage: 3,
          depotId: "d1",
          returnDepotId: "d1",
          customer: customerStub,
          category: categoryStub,
          vehicle: vehicleStub,
        },
      ],
    });
    const tasks = await collectBookingTasks(db, { now });
    const ret = tasks.find((t) => t.taskType === "BOOKING_RETURN");
    const overdue = tasks.find((t) => t.taskType === "BOOKING_OVERDUE_CHASE");
    expect(ret?.tier).toBe("HIGH");
    expect(ret?.actionUrl).toBe("/staff/bookings/r_soon/check-in");
    expect(overdue?.tier).toBe("URGENT");
    expect(overdue?.summary).toContain("48h overdue");
  });
});
