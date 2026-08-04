import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { detectFleetAlerts, LOW_BATTERY_PCT } from "@/server/services/gps51-alerts";
import { OFFLINE_AFTER_SECONDS } from "@/lib/gps/freshness";

const now = new Date("2026-07-05T12:00:00Z");
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

type Pos = {
  deviceId: string;
  vehicleId: string | null;
  timestamp: Date;
  batteryPct: number | null;
  raw: unknown;
  vehicle: { internalCode: string | null; make: string; model: string; rego: string; depotId: string | null } | null;
};

function mockPrisma(positions: Pos[]): PrismaClient {
  return {
    vehicleLivePosition: { findMany: vi.fn(async () => positions) },
  } as unknown as PrismaClient;
}

const veh = (over: Partial<Pos["vehicle"]> = {}) => ({
  internalCode: "XM-01",
  make: "Honda",
  model: "PCX",
  rego: "ABC123",
  depotId: "depot1",
  ...over,
});

describe("detectFleetAlerts", () => {
  it("flags a tracker with no fix beyond the offline threshold", async () => {
    const prisma = mockPrisma([
      { deviceId: "d1", vehicleId: "v1", timestamp: ago(OFFLINE_AFTER_SECONDS + 120), batteryPct: 90, raw: {}, vehicle: veh() },
    ]);
    const alerts = await detectFleetAlerts(prisma, now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "TRACKER_OFFLINE", vehicleId: "v1", depotId: "depot1" });
  });

  it("flags low battery percentage on a fresh fix", async () => {
    const prisma = mockPrisma([
      { deviceId: "d1", vehicleId: "v1", timestamp: ago(60), batteryPct: LOW_BATTERY_PCT - 1, raw: {}, vehicle: veh() },
    ]);
    const alerts = await detectFleetAlerts(prisma, now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("TRACKER_LOW_BATTERY");
  });

  it("flags low supply voltage from the status text when no battery %", async () => {
    const prisma = mockPrisma([
      {
        deviceId: "d1",
        vehicleId: "v1",
        timestamp: ago(60),
        batteryPct: null,
        raw: { strstatusen: "ACC Off/Voltage 11.2V" },
        vehicle: veh(),
      },
    ]);
    const alerts = await detectFleetAlerts(prisma, now);
    expect(alerts[0]!.type).toBe("TRACKER_LOW_BATTERY");
    expect(alerts[0]!.detail).toContain("11.2V");
  });

  it("offline takes precedence over low battery (no duplicate alert)", async () => {
    const prisma = mockPrisma([
      { deviceId: "d1", vehicleId: "v1", timestamp: ago(OFFLINE_AFTER_SECONDS + 60), batteryPct: 5, raw: {}, vehicle: veh() },
    ]);
    const alerts = await detectFleetAlerts(prisma, now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("TRACKER_OFFLINE");
  });

  it("emits nothing for a healthy fresh tracker", async () => {
    const prisma = mockPrisma([
      { deviceId: "d1", vehicleId: "v1", timestamp: ago(60), batteryPct: 95, raw: { strstatusen: "ACC On/Voltage 12.6V" }, vehicle: veh() },
    ]);
    expect(await detectFleetAlerts(prisma, now)).toHaveLength(0);
  });
});
