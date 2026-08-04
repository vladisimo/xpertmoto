import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getFleetFreshness } from "@/server/services/gps51-freshness";

const now = new Date("2026-07-05T12:00:00Z");

describe("getFleetFreshness", () => {
  it("summarises linked / reporting / stale / never-reported and samples the stale devices", async () => {
    const staleTs = new Date(now.getTime() - 30 * 60 * 1000); // 30 min old
    const prisma = {
      vehicle: { count: vi.fn(async () => 10) }, // 10 vehicles have a tracker
      vehicleLivePosition: {
        // First count call = reporting (no timestamp filter); second = stale (timestamp lt cutoff).
        count: vi.fn(async (args?: { where?: { timestamp?: unknown } }) =>
          args?.where?.timestamp ? 2 : 8,
        ),
        findMany: vi.fn(async () => [
          { deviceId: "d1", vehicleId: "v1", timestamp: staleTs },
          { deviceId: "d2", vehicleId: "v2", timestamp: staleTs },
        ]),
      },
    } as unknown as PrismaClient;

    const f = await getFleetFreshness(prisma, now);

    expect(f.linkedVehicles).toBe(10);
    expect(f.reportingDevices).toBe(8);
    expect(f.staleDeviceCount).toBe(2);
    expect(f.neverReportedCount).toBe(2); // 10 linked - 8 reporting
    expect(f.staleDevices).toHaveLength(2);
    expect(f.staleDevices[0]).toMatchObject({ deviceId: "d1", minutesStale: 30 });
  });
});
