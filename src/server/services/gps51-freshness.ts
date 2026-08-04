/**
 * Fleet GPS freshness — which trackers have gone quiet. The GPS51 poll can keep
 * "succeeding" structurally while individual trackers stop reporting (flat
 * battery, out of coverage, unplugged) or while GPS51 silently degrades
 * (8904 IP / 8905 quota). Sentry cron check-ins only know if the JOB ran, not
 * whether the DATA is fresh — this closes that gap.
 *
 * Read by fleet.gps51SyncStatus (staff sync panel) and the admin integration
 * health tab; the poll also calls detectFreshnessAlerts to log/alert on drops.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { STALE_AFTER_SECONDS } from "@/lib/gps/freshness";

const STALE_SAMPLE_LIMIT = 100;

export type FleetFreshness = {
  /** Vehicles with a tracker assigned (the expected reporting population). */
  linkedVehicles: number;
  /** Devices with a live-position row (have reported at least once). */
  reportingDevices: number;
  /** Reporting devices whose latest fix is older than the stale threshold. */
  staleDeviceCount: number;
  /** Linked vehicles that have never produced a live-position row. */
  neverReportedCount: number;
  staleThresholdSeconds: number;
  /** Bounded sample of the stale devices for display, oldest first. */
  staleDevices: Array<{ deviceId: string; vehicleId: string | null; minutesStale: number }>;
};

export async function getFleetFreshness(
  prisma: PrismaClient = defaultPrisma,
  now: Date = new Date(),
): Promise<FleetFreshness> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000);
  const [linkedVehicles, reportingDevices, staleDeviceCount, staleSample] = await Promise.all([
    prisma.vehicle.count({ where: { gpsTrackerId: { not: null }, deletedAt: null } }),
    prisma.vehicleLivePosition.count({ where: { vehicleId: { not: null } } }),
    prisma.vehicleLivePosition.count({
      where: { vehicleId: { not: null }, timestamp: { lt: cutoff } },
    }),
    prisma.vehicleLivePosition.findMany({
      where: { vehicleId: { not: null }, timestamp: { lt: cutoff } },
      select: { deviceId: true, vehicleId: true, timestamp: true },
      orderBy: { timestamp: "asc" },
      take: STALE_SAMPLE_LIMIT,
    }),
  ]);

  return {
    linkedVehicles,
    reportingDevices,
    staleDeviceCount,
    // A tracker that never reported has no live-position row at all.
    neverReportedCount: Math.max(0, linkedVehicles - reportingDevices),
    staleThresholdSeconds: STALE_AFTER_SECONDS,
    staleDevices: staleSample.map((s) => ({
      deviceId: s.deviceId,
      vehicleId: s.vehicleId,
      minutesStale: Math.round((now.getTime() - s.timestamp.getTime()) / 60000),
    })),
  };
}
