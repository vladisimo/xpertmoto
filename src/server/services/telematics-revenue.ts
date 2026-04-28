import type { PrismaClient } from "@prisma/client";
import { haversineKm, type LatLng, pointInPolygon } from "@/lib/geo";

/**
 * Lever 2: turning VehicleTelemetry rows into revenue events.
 *
 * Three surfaces:
 *   (a) Out-of-zone surcharge + border-crossing fee
 *   (b) Speeding / harsh-event insurance loading
 *   (c) Low-fuel proactive dispatch upsell (opt-in service fee)
 *
 * This module is pure-function per point: given a sample + the
 * applicable RentalZone, decide whether a ZoneEvent or SpeedEvent
 * should be emitted. Persistence and aggregation happens in the
 * telemetry-processor job.
 */

export const DEFAULT_SPEED_THRESHOLD_KPH = 85;
export const DEFAULT_SPEED_EVENT_MIN_SECONDS = 30;

export type TelemetrySample = {
  timestamp: Date;
  latitude: number;
  longitude: number;
  speedKph?: number | null;
  odometerKm?: number | null;
  ignitionOn?: boolean | null;
};

export type ZoneConfig = {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  polygon?: LatLng[] | null;
  allowStateCrossing: boolean;
  perKmSurchargeCents: number;
  borderCrossingFeeCents: number;
};

/**
 * A point is inside the zone if either (a) inside its polygon (when
 * provided) or (b) inside the centre + radius circle. Polygon wins.
 */
export function isInsideZone(sample: TelemetrySample, zone: ZoneConfig): boolean {
  const point: LatLng = { lat: sample.latitude, lng: sample.longitude };
  if (zone.polygon && zone.polygon.length >= 3) {
    return pointInPolygon(point, zone.polygon);
  }
  const center: LatLng = { lat: zone.centerLat, lng: zone.centerLng };
  return haversineKm(point, center) <= zone.radiusKm;
}

/**
 * Decide whether a transition between two successive telemetry points
 * warrants a ZoneEvent row.
 */
export function detectZoneTransition(
  prev: TelemetrySample | null,
  curr: TelemetrySample,
  zone: ZoneConfig,
): { kind: "OUT_OF_ZONE_ENTERED" | "OUT_OF_ZONE_EXITED" } | null {
  const currInside = isInsideZone(curr, zone);
  if (!prev) {
    return currInside ? null : { kind: "OUT_OF_ZONE_ENTERED" };
  }
  const prevInside = isInsideZone(prev, zone);
  if (prevInside && !currInside) return { kind: "OUT_OF_ZONE_ENTERED" };
  if (!prevInside && currInside) return { kind: "OUT_OF_ZONE_EXITED" };
  return null;
}

/**
 * Aggregate per-km distance while out-of-zone across an array of sorted
 * samples. Used at return-settlement time.
 */
export function computeOutOfZoneDistanceKm(
  samples: TelemetrySample[],
  zone: ZoneConfig,
): number {
  if (samples.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    const prevInside = isInsideZone(prev, zone);
    const currInside = isInsideZone(curr, zone);
    if (prevInside && currInside) continue;
    const leg = haversineKm(
      { lat: prev.latitude, lng: prev.longitude },
      { lat: curr.latitude, lng: curr.longitude },
    );
    if (!prevInside && !currInside) {
      total += leg;
    } else {
      // Rough half-credit when the leg straddles the boundary.
      total += leg / 2;
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * Decide whether consecutive high-speed samples warrant a SpeedEvent.
 * Caller supplies a sliding window of samples ordered by timestamp.
 */
export function detectSpeedEvent(
  window: TelemetrySample[],
  threshold = DEFAULT_SPEED_THRESHOLD_KPH,
  minSeconds = DEFAULT_SPEED_EVENT_MIN_SECONDS,
): { durationSec: number; peakSpeedKph: number } | null {
  if (window.length < 2) return null;
  let streakStart: number | null = null;
  let peak = 0;
  for (let i = 0; i < window.length; i += 1) {
    const s = window[i]!;
    if ((s.speedKph ?? 0) > threshold) {
      streakStart ??= s.timestamp.getTime();
      peak = Math.max(peak, s.speedKph ?? 0);
    } else {
      if (streakStart !== null) {
        const dur = (s.timestamp.getTime() - streakStart) / 1000;
        if (dur >= minSeconds) return { durationSec: Math.round(dur), peakSpeedKph: peak };
        streakStart = null;
        peak = 0;
      }
    }
  }
  if (streakStart !== null) {
    const dur = (window.at(-1)!.timestamp.getTime() - streakStart) / 1000;
    if (dur >= minSeconds) return { durationSec: Math.round(dur), peakSpeedKph: peak };
  }
  return null;
}

export type ZoneSurchargeQuote = {
  outOfZoneKm: number;
  perKmSurchargeCents: number;
  perKmTotal: number;
  borderCrossings: number;
  borderCrossingFeeCents: number;
  borderTotal: number;
  total: number;
};

export function quoteZoneSurcharge(args: {
  outOfZoneKm: number;
  borderCrossings: number;
  zone: ZoneConfig;
}): ZoneSurchargeQuote {
  const perKmTotal =
    Math.round(args.outOfZoneKm * args.zone.perKmSurchargeCents) / 100;
  const borderTotal =
    (args.zone.allowStateCrossing ? 0 : args.borderCrossings * args.zone.borderCrossingFeeCents) /
    100;
  return {
    outOfZoneKm: args.outOfZoneKm,
    perKmSurchargeCents: args.zone.perKmSurchargeCents,
    perKmTotal: Math.round(perKmTotal * 100) / 100,
    borderCrossings: args.borderCrossings,
    borderCrossingFeeCents: args.zone.borderCrossingFeeCents,
    borderTotal: Math.round(borderTotal * 100) / 100,
    total: Math.round((perKmTotal + borderTotal) * 100) / 100,
  };
}

/**
 * Summarise telemetry for a booking into the charges added at return.
 * Queries RentalZone + VehicleTelemetry + ZoneEvent for the booking and
 * returns a ready-to-use surcharge quote. Returns null if no zone
 * configured (zone enforcement disabled for the booking).
 */
export async function summariseTelemetryCharges(
  prisma: PrismaClient,
  bookingId: string,
): Promise<ZoneSurchargeQuote | null> {
  const zoneRow = await prisma.rentalZone.findUnique({
    where: { bookingId },
  });
  if (!zoneRow) return null;

  const zoneConfig: ZoneConfig = {
    centerLat: zoneRow.centerLat,
    centerLng: zoneRow.centerLng,
    radiusKm: zoneRow.radiusKm,
    polygon: zoneRow.polygon as unknown as LatLng[] | null,
    allowStateCrossing: zoneRow.allowStateCrossing,
    perKmSurchargeCents: zoneRow.perKmSurchargeCents,
    borderCrossingFeeCents: zoneRow.borderCrossingFeeCents,
  };

  const [borderCrossings, samples] = await Promise.all([
    prisma.zoneEvent.count({
      where: { bookingId, kind: "BORDER_CROSSED" },
    }),
    // Use the recorded events for aggregation — computing from full
    // telemetry at charge time is slow on long rentals.
    prisma.zoneEvent.findMany({
      where: { bookingId },
      orderBy: { eventAt: "asc" },
    }),
  ]);

  // Rough per-km proxy: for each OUT_OF_ZONE_ENTERED → OUT_OF_ZONE_EXITED
  // pair, take the odometer delta (if available) as out-of-zone km.
  let outOfZoneKm = 0;
  let entered: typeof samples[number] | null = null;
  for (const e of samples) {
    if (e.kind === "OUT_OF_ZONE_ENTERED") entered = e;
    else if (e.kind === "OUT_OF_ZONE_EXITED" && entered) {
      if (entered.odometerKm != null && e.odometerKm != null) {
        outOfZoneKm += Math.max(0, e.odometerKm - entered.odometerKm);
      }
      entered = null;
    }
  }

  return quoteZoneSurcharge({ outOfZoneKm, borderCrossings, zone: zoneConfig });
}
