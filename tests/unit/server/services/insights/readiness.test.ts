import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessInsightsReadiness,
  INSIGHT_THRESHOLDS,
} from "@/server/services/insights/readiness";

type Counts = {
  bookings: number;
  customers: number;
  vehicles: number;
};

function buildPrisma(counts: Counts, firstPickup: Date | null) {
  return {
    booking: {
      count: vi.fn().mockResolvedValue(counts.bookings),
      findFirst: vi
        .fn()
        .mockResolvedValue(firstPickup ? { pickupDateTime: firstPickup } : null),
    },
    customerProfile: {
      count: vi.fn().mockResolvedValue(counts.customers),
    },
    vehicle: {
      count: vi.fn().mockResolvedValue(counts.vehicles),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assessInsightsReadiness", () => {
  const farEnoughAgo = new Date(
    Date.now() - (INSIGHT_THRESHOLDS.daysOfHistory + 5) * 86_400_000,
  );

  it("reports sufficient when every gate clears", async () => {
    const prisma = buildPrisma(
      {
        bookings: INSIGHT_THRESHOLDS.completedBookings,
        customers: INSIGHT_THRESHOLDS.customersWithSpend,
        vehicles: INSIGHT_THRESHOLDS.activeVehicles,
      },
      farEnoughAgo,
    );
    const r = await assessInsightsReadiness(prisma);
    expect(r.sufficient).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("flags a missing completed-bookings gate", async () => {
    const prisma = buildPrisma(
      {
        bookings: 3,
        customers: INSIGHT_THRESHOLDS.customersWithSpend,
        vehicles: INSIGHT_THRESHOLDS.activeVehicles,
      },
      farEnoughAgo,
    );
    const r = await assessInsightsReadiness(prisma);
    expect(r.sufficient).toBe(false);
    expect(r.missing.map((m) => m.key)).toEqual(["completedBookings"]);
    expect(r.missing[0]!.have).toBe(3);
    expect(r.missing[0]!.need).toBe(INSIGHT_THRESHOLDS.completedBookings);
  });

  it("flags a missing customers-with-spend gate", async () => {
    const prisma = buildPrisma(
      {
        bookings: INSIGHT_THRESHOLDS.completedBookings,
        customers: 1,
        vehicles: INSIGHT_THRESHOLDS.activeVehicles,
      },
      farEnoughAgo,
    );
    const r = await assessInsightsReadiness(prisma);
    expect(r.missing.map((m) => m.key)).toEqual(["customersWithSpend"]);
  });

  it("flags a missing active-vehicles gate", async () => {
    const prisma = buildPrisma(
      {
        bookings: INSIGHT_THRESHOLDS.completedBookings,
        customers: INSIGHT_THRESHOLDS.customersWithSpend,
        vehicles: 1,
      },
      farEnoughAgo,
    );
    const r = await assessInsightsReadiness(prisma);
    expect(r.missing.map((m) => m.key)).toEqual(["activeVehicles"]);
  });

  it("flags a missing history-span gate when first booking is recent", async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000);
    const prisma = buildPrisma(
      {
        bookings: INSIGHT_THRESHOLDS.completedBookings,
        customers: INSIGHT_THRESHOLDS.customersWithSpend,
        vehicles: INSIGHT_THRESHOLDS.activeVehicles,
      },
      recent,
    );
    const r = await assessInsightsReadiness(prisma);
    expect(r.missing.map((m) => m.key)).toEqual(["daysOfHistory"]);
    expect(r.missing[0]!.have).toBe(5);
  });

  it("treats no bookings at all as zero days of history and flags it", async () => {
    const prisma = buildPrisma(
      {
        bookings: 0,
        customers: 0,
        vehicles: 0,
      },
      null,
    );
    const r = await assessInsightsReadiness(prisma);
    expect(r.sufficient).toBe(false);
    expect(r.missing.map((m) => m.key).sort()).toEqual(
      [
        "activeVehicles",
        "completedBookings",
        "customersWithSpend",
        "daysOfHistory",
      ].sort(),
    );
  });

  it("scopes booking + vehicle queries by depotId when provided", async () => {
    const prisma = buildPrisma(
      {
        bookings: INSIGHT_THRESHOLDS.completedBookings,
        customers: INSIGHT_THRESHOLDS.customersWithSpend,
        vehicles: INSIGHT_THRESHOLDS.activeVehicles,
      },
      farEnoughAgo,
    );
    await assessInsightsReadiness(prisma, "depot-42");
    const bookingCountArgs = (prisma as never as {
      booking: { count: ReturnType<typeof vi.fn> };
    }).booking.count.mock.calls[0]![0];
    const vehicleCountArgs = (prisma as never as {
      vehicle: { count: ReturnType<typeof vi.fn> };
    }).vehicle.count.mock.calls[0]![0];
    expect(bookingCountArgs.where.pickupDepotId).toBe("depot-42");
    expect(vehicleCountArgs.where.depotId).toBe("depot-42");
  });
});
