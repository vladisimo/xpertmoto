/**
 * Fleet GPS operational alerts derived purely from the latest live position —
 * no per-booking zone config required (that's the telemetry-processor's job):
 *   - TRACKER_OFFLINE:     no fix for longer than the offline threshold.
 *   - TRACKER_LOW_BATTERY: reported battery % (or hardwired supply voltage) is
 *                          low enough that the tracker may be about to drop off.
 *
 * detectFleetAlerts is pure-ish (one read, no writes) so it's unit-testable; the
 * gps51-alerts job turns the results into deduped staff notifications.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { OFFLINE_AFTER_SECONDS, secondsSince } from "@/lib/gps/freshness";
import { parseStatusVoltage, type Gps51PositionRecord } from "./gps51";

export const LOW_BATTERY_PCT = 20;
export const LOW_VOLTAGE_V = 11.8; // a 12V bike battery below ~11.8V is nearly flat

export type FleetAlertType = "TRACKER_OFFLINE" | "TRACKER_LOW_BATTERY";

export type FleetAlert = {
  type: FleetAlertType;
  vehicleId: string;
  deviceId: string;
  depotId: string | null;
  label: string;
  detail: string;
};

export async function detectFleetAlerts(
  prisma: PrismaClient = defaultPrisma,
  now: Date = new Date(),
): Promise<FleetAlert[]> {
  const positions = await prisma.vehicleLivePosition.findMany({
    where: { vehicleId: { not: null } },
    select: {
      deviceId: true,
      vehicleId: true,
      timestamp: true,
      batteryPct: true,
      raw: true,
      vehicle: {
        select: { internalCode: true, make: true, model: true, rego: true, depotId: true },
      },
    },
  });

  const alerts: FleetAlert[] = [];
  for (const p of positions) {
    if (!p.vehicleId || !p.vehicle) continue;
    const label = p.vehicle.internalCode ?? p.vehicle.rego ?? p.deviceId;
    const base = { vehicleId: p.vehicleId, deviceId: p.deviceId, depotId: p.vehicle.depotId, label };

    // Offline wins — a flat tracker that's also offline is reported as offline.
    if (secondsSince(p.timestamp, now) > OFFLINE_AFTER_SECONDS) {
      const mins = Math.round(secondsSince(p.timestamp, now) / 60);
      alerts.push({
        ...base,
        type: "TRACKER_OFFLINE",
        detail: `No GPS fix for ${mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins} min`}.`,
      });
      continue;
    }

    const voltageV = parseStatusVoltage((p.raw ?? {}) as Gps51PositionRecord);
    if (p.batteryPct != null && p.batteryPct < LOW_BATTERY_PCT) {
      alerts.push({
        ...base,
        type: "TRACKER_LOW_BATTERY",
        detail: `Tracker battery at ${Math.round(p.batteryPct)}%.`,
      });
    } else if (voltageV != null && voltageV < LOW_VOLTAGE_V) {
      alerts.push({
        ...base,
        type: "TRACKER_LOW_BATTERY",
        detail: `Supply voltage ${voltageV.toFixed(1)}V (low).`,
      });
    }
  }
  return alerts;
}
