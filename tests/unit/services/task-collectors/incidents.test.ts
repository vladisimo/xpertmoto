import { describe, expect, it, vi } from "vitest";
import { collectIncidentTasks } from "../../../../src/server/services/task-collectors/incidents";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

function mockDb(rows: unknown[]) {
  const findMany = vi.fn(async (..._a: unknown[]) => rows);
  return { db: { incident: { findMany } } as unknown as PrismaLike, findMany };
}

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: "inc1",
  incidentNumber: "INC-AUTO-0042",
  createdAt: new Date("2026-08-10T00:00:00Z"),
  bookingId: "bk1",
  customerId: "cust1",
  vehicle: { id: "veh1", internalCode: "MTB-1", rego: "ABC123", depotId: "d1" },
  booking: { bookingReference: "XPM-20260810-0001" },
  ...over,
});

describe("collectIncidentTasks", () => {
  it("emits a 'Confirm theft' task for an open THEFT incident, due +24h after creation", async () => {
    const createdAt = new Date(Date.now() - 2 * 3600_000); // 2h old → not yet due
    const { db, findMany } = mockDb([baseRow({ createdAt })]);

    const tasks = await collectIncidentTasks(db, {});

    // Query scopes to open THEFT incidents only.
    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      type: "THEFT",
      status: { in: ["REPORTED", "UNDER_INVESTIGATION"] },
      deletedAt: null,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskType: "INCIDENT_INVESTIGATE",
      targetEntityKind: "Incident",
      targetEntityId: "inc1",
      title: "Confirm theft — police report + bond capture",
      tier: "HIGH",
      depotId: "d1",
      actionUrl: "/staff/incidents/inc1",
      links: { vehicleId: "veh1", bookingId: "bk1", customerId: "cust1" },
    });
    expect(tasks[0]!.dueAt?.getTime()).toBe(createdAt.getTime() + 24 * 3600_000);
  });

  it("escalates to URGENT once the 24h confirm window has passed", async () => {
    const createdAt = new Date(Date.now() - 30 * 3600_000); // 30h old → overdue
    const { db } = mockDb([baseRow({ createdAt })]);

    const tasks = await collectIncidentTasks(db, {});

    expect(tasks[0]?.tier).toBe("URGENT");
  });

  it("scopes to the requested depot via the vehicle relation", async () => {
    const { db, findMany } = mockDb([]);

    await collectIncidentTasks(db, { depotId: "d2" });

    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ vehicle: { depotId: "d2" } });
  });

  it("handles an unlinked incident (no booking/customer) without dead links", async () => {
    const { db } = mockDb([baseRow({ bookingId: null, customerId: null, booking: null })]);

    const tasks = await collectIncidentTasks(db, {});

    expect(tasks[0]?.links).toEqual({ vehicleId: "veh1" });
    expect(tasks[0]?.summary).toContain("Suspected theft");
  });
});
