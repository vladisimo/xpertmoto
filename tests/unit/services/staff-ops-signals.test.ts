import { describe, expect, it } from "vitest";
import {
  findCalendarMistakes,
  findTyreAlerts,
  type PrismaLike,
} from "../../../src/server/services/staff-ops-signals";

type SqlLike = { readonly strings: readonly string[]; readonly values: unknown[] };

type RawBuckets = {
  maintenance?: unknown[];
  docs?: unknown[];
  statusMismatches?: unknown[];
};

function mockDb(
  overrides: Record<string, unknown>,
  raw: RawBuckets = {},
): PrismaLike {
  const passthrough = () => [];
  const queryRaw = async (sql: SqlLike) => {
    const joined = sql.strings.join(" ");
    if (joined.includes("MaintenanceWorkOrder")) return raw.maintenance ?? [];
    if (joined.includes("LATERAL (") && joined.includes("VALUES")) return raw.docs ?? [];
    if (joined.includes("AVAILABLE_BUT_ON_HIRE")) return raw.statusMismatches ?? [];
    return [];
  };
  return {
    $queryRaw: queryRaw,
    booking: { findMany: async () => [], ...(overrides.booking ?? {}) },
    maintenanceWorkOrder: {
      findMany: async () => passthrough(),
      ...(overrides.maintenanceWorkOrder ?? {}),
    },
    vehicle: { findMany: async () => passthrough(), ...(overrides.vehicle ?? {}) },
    incident: { findMany: async () => passthrough(), count: async () => 0 },
    infringement: { groupBy: async () => [] },
    invoice: { groupBy: async () => [] },
    notification: { findMany: async () => [] },
    user: { findMany: async () => [] },
  } as unknown as PrismaLike;
}

describe("findCalendarMistakes", () => {
  it("surfaces unallocated active bookings", async () => {
    const db = mockDb({
      booking: {
        findMany: async (args: {
          where: { vehicleId?: null | { not: null }; status?: { in?: string[] } };
        }) => {
          if (args.where?.vehicleId === null) {
            return [
              {
                id: "b1",
                bookingReference: "SCT-0001",
                status: "ACTIVE",
                pickupDateTime: new Date(),
                category: { name: "150cc" },
                customer: { firstName: "Jess", lastName: "Ng" },
              },
            ];
          }
          return [];
        },
      },
    });
    const res = await findCalendarMistakes(undefined, db);
    expect(res.unallocated).toHaveLength(1);
    expect(res.unallocated[0]?.bookingReference).toBe("SCT-0001");
    expect(res.total).toBe(1);
  });

  it("surfaces maintenance conflicts when work order overlaps booking", async () => {
    const pickup = new Date("2026-05-01T10:00:00Z");
    const ret = new Date("2026-05-03T10:00:00Z");
    const woStart = new Date("2026-05-02T00:00:00Z");
    const woEnd = new Date("2026-05-02T08:00:00Z");
    const db = mockDb(
      {},
      {
        maintenance: [
          {
            bookingId: "b2",
            bookingReference: "SCT-0002",
            pickupDateTime: pickup,
            returnDateTime: ret,
            vehicleCode: "SCT-V1",
            workOrderId: "wo1",
            workOrderNumber: "WO-1",
            scheduledStartAt: woStart,
            scheduledEndAt: woEnd,
          },
        ],
      },
    );
    const res = await findCalendarMistakes(undefined, db);
    expect(res.maintenanceConflicts).toHaveLength(1);
    expect(res.maintenanceConflicts[0]?.workOrderNumber).toBe("WO-1");
    expect(res.docsExpiringWithBooking).toHaveLength(0);
  });

  it("flags docs expiring inside a future booking window", async () => {
    const pickup = new Date("2026-05-01T10:00:00Z");
    const regoExp = new Date("2026-05-03T00:00:00Z");
    const db = mockDb(
      {},
      {
        docs: [
          {
            vehicleId: "v2",
            vehicleCode: "SCT-V2",
            bookingId: "b3",
            bookingReference: "SCT-0003",
            pickupDateTime: pickup,
            expiringDoc: "rego",
            expiresAt: regoExp,
          },
        ],
      },
    );
    const res = await findCalendarMistakes(undefined, db);
    expect(res.docsExpiringWithBooking).toHaveLength(1);
    expect(res.docsExpiringWithBooking[0]?.expiringDoc).toBe("rego");
  });

  it("detects vehicle status mismatches", async () => {
    const db = mockDb(
      {},
      {
        statusMismatches: [
          {
            vehicleId: "v10",
            vehicleCode: "SCT-V10",
            vehicleStatus: "AVAILABLE",
            observed: "AVAILABLE_BUT_ON_HIRE",
            bookingId: "b10",
            bookingReference: "SCT-0010",
          },
          {
            vehicleId: "v11",
            vehicleCode: "SCT-V11",
            vehicleStatus: "RENTED",
            observed: "RENTED_BUT_NO_ACTIVE_BOOKING",
            bookingId: null,
            bookingReference: null,
          },
        ],
      },
    );
    const res = await findCalendarMistakes(undefined, db);
    expect(res.statusMismatches).toHaveLength(2);
    expect(res.statusMismatches.map((m) => m.observed)).toContain("AVAILABLE_BUT_ON_HIRE");
    expect(res.statusMismatches.map((m) => m.observed)).toContain("RENTED_BUT_NO_ACTIVE_BOOKING");
  });
});

describe("findTyreAlerts", () => {
  it("flags low tread as LOW_TREAD", async () => {
    const db = mockDb({
      vehicle: {
        findMany: async () => [
          {
            id: "v1",
            internalCode: "SCT-V1",
            make: "Honda",
            model: "PCX",
            currentOdometerKm: 5000,
            inspections: [
              { dateTime: new Date(), tyreFrontDepth: 1.5, tyreRearDepth: 3.0 },
            ],
            workOrders: [],
          },
        ],
      },
    });
    const alerts = await findTyreAlerts(undefined, db);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.reason).toBe("LOW_TREAD");
    expect(alerts[0]?.frontDepthMm).toBe(1.5);
  });

  it("flags high km since last replacement", async () => {
    const db = mockDb({
      vehicle: {
        findMany: async () => [
          {
            id: "v2",
            internalCode: "SCT-V2",
            make: "Vespa",
            model: "Primavera",
            currentOdometerKm: 25000,
            inspections: [
              { dateTime: new Date(), tyreFrontDepth: 5.0, tyreRearDepth: 5.0 },
            ],
            workOrders: [{ odometerAtService: 10000, completedAt: new Date(2025, 0, 1) }],
          },
        ],
      },
    });
    const alerts = await findTyreAlerts(undefined, db);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.reason).toBe("HIGH_KM_SINCE_REPLACEMENT");
    expect(alerts[0]?.kmSinceLastTyreWorkOrder).toBe(15000);
  });

  it("skips healthy vehicles", async () => {
    const db = mockDb({
      vehicle: {
        findMany: async () => [
          {
            id: "v3",
            internalCode: "SCT-V3",
            make: "Yamaha",
            model: "NMAX",
            currentOdometerKm: 3000,
            inspections: [{ dateTime: new Date(), tyreFrontDepth: 4.0, tyreRearDepth: 4.0 }],
            workOrders: [],
          },
        ],
      },
    });
    const alerts = await findTyreAlerts(undefined, db);
    expect(alerts).toHaveLength(0);
  });
});
