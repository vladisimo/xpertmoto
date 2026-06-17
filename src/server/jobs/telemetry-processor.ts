import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  detectSpeedEvent,
  detectZoneTransition,
  type TelemetrySample,
  type ZoneConfig,
} from "@/server/services/telematics-revenue";
import { sendNotification } from "@/server/services/notification-sender";
import type { LatLng } from "@/lib/geo";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "telemetry-processor" as const;

/**
 * Lever 2: batch telemetry processor. Runs every 5 minutes:
 *   1. Find active bookings with a configured RentalZone.
 *   2. For each, fetch the telemetry rows since the last processed
 *      ZoneEvent / SpeedEvent and emit events on thresholds.
 *   3. When a new ZONE breach is detected, queue a push notification
 *      to the customer so they have a chance to head back (surcharge
 *      accrues per-km regardless).
 *
 * Safely idempotent: events carry the source telemetry timestamp; the
 * processor skips samples it already consumed by only selecting rows
 * after the last event's timestamp.
 */

export type TelemetryProcessorResult = {
  scanned: number;
  zoneEvents: number;
  speedEvents: number;
};

export async function runTelemetryProcessor(): Promise<TelemetryProcessorResult> {
  const counters: TelemetryProcessorResult = { scanned: 0, zoneEvents: 0, speedEvents: 0 };

  const active = await prisma.booking.findMany({
    where: {
      status: { in: ["CHECKED_OUT", "ACTIVE", "OVERDUE"] },
      rentalZone: { isNot: null },
      vehicleId: { not: null },
    },
    include: {
      rentalZone: true,
      customer: { select: { id: true, firstName: true } },
    },
  });
  counters.scanned = active.length;

  for (const booking of active) {
    const zoneRow = booking.rentalZone;
    if (!zoneRow || !booking.vehicleId) continue;

    const zone: ZoneConfig = {
      centerLat: zoneRow.centerLat,
      centerLng: zoneRow.centerLng,
      radiusKm: zoneRow.radiusKm,
      polygon: zoneRow.polygon as unknown as LatLng[] | null,
      allowStateCrossing: zoneRow.allowStateCrossing,
      perKmSurchargeCents: zoneRow.perKmSurchargeCents,
      borderCrossingFeeCents: zoneRow.borderCrossingFeeCents,
    };

    const lastZoneEvent = await prisma.zoneEvent.findFirst({
      where: { bookingId: booking.id },
      orderBy: { eventAt: "desc" },
    });
    const lastSpeedEvent = await prisma.speedEvent.findFirst({
      where: { bookingId: booking.id },
      orderBy: { eventAt: "desc" },
    });
    const cursor = new Date(
      Math.max(
        lastZoneEvent?.eventAt.getTime() ?? booking.pickupDateTime.getTime(),
        lastSpeedEvent?.eventAt.getTime() ?? booking.pickupDateTime.getTime(),
      ),
    );

    // Drain the whole unprocessed window in bounded batches. A single fixed
    // page would stall: the cross-run cursor only advances when a zone/speed
    // event is emitted, so a 500-row page that yields no event would be
    // re-read forever and later rows never reached. Now that the nightly
    // full-track sync lands thousands of backdated fixes per active vehicle at
    // once, that page is easily exceeded — so we page forward by timestamp
    // until the window is drained (or a generous per-run cap is hit; the
    // remainder is picked up next run once events advance the cursor).
    const BATCH = 500;
    const MAX_SAMPLES_PER_RUN = 5000;
    const samples: TelemetrySample[] = [];
    let lowerBound = cursor;
    while (samples.length < MAX_SAMPLES_PER_RUN) {
      const page = await prisma.vehicleTelemetry.findMany({
        where: {
          vehicleId: booking.vehicleId,
          timestamp: { gt: lowerBound, lte: booking.returnDateTime },
        },
        orderBy: { timestamp: "asc" },
        take: BATCH,
      });
      if (page.length === 0) break;
      for (const t of page) {
        samples.push({
          timestamp: t.timestamp,
          latitude: t.latitude,
          longitude: t.longitude,
          speedKph: t.speedKph,
          odometerKm: t.odometerKm,
          ignitionOn: t.ignitionOn,
        });
      }
      lowerBound = page[page.length - 1]!.timestamp;
      if (page.length < BATCH) break;
    }
    if (samples.length === 0) continue;
    if (samples.length >= MAX_SAMPLES_PER_RUN) {
      logger.warn(
        { bookingId: booking.id, samples: samples.length },
        "telemetry-processor: hit per-run sample cap; remainder picked up next run",
      );
    }

    // Zone transitions.
    let prev: TelemetrySample | null = null;
    for (const s of samples) {
      const transition = detectZoneTransition(prev, s, zone);
      if (transition) {
        await prisma.zoneEvent.create({
          data: {
            bookingId: booking.id,
            kind: transition.kind,
            eventAt: s.timestamp,
            latitude: s.latitude,
            longitude: s.longitude,
            odometerKm: s.odometerKm,
          },
        });
        counters.zoneEvents += 1;
        if (transition.kind === "OUT_OF_ZONE_ENTERED") {
          try {
            await sendNotification({
              userId: booking.customerId,
              type: "ZONE_BREACH_WARNING",
              channels: ["PUSH", "SMS"],
              subject: `You've left your rental zone`,
              title: "Outside rental zone",
              body: `Heads up ${booking.customer.firstName} — you've ridden outside your ${zone.radiusKm}km rental zone. Per-km surcharges apply until you return. Booking ${booking.bookingReference}.`,
              bookingId: booking.id,
              data: {
                bookingReference: booking.bookingReference,
                kind: "OUT_OF_ZONE_ENTERED",
              },
            });
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
              "telemetry-processor: warning notification failed",
            );
          }
        }
      }
      prev = s;
    }

    // Speed events — one event per run (the next run will re-detect if
    // the behaviour continues).
    const speeding = detectSpeedEvent(samples);
    if (speeding) {
      await prisma.speedEvent.create({
        data: {
          bookingId: booking.id,
          speedKph: speeding.peakSpeedKph,
          thresholdKph: 85,
          durationSec: speeding.durationSec,
          eventAt: samples.at(-1)!.timestamp,
          latitude: samples.at(-1)!.latitude,
          longitude: samples.at(-1)!.longitude,
        },
      });
      counters.speedEvents += 1;
    }
  }

  logger.info(counters, "telemetry-processor finished");
  return counters;
}

export function startTelemetryProcessorScheduler() {
  registerWorker(QUEUE, async () => runTelemetryProcessor());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add("every-5-min", {}, { repeat: { pattern: "*/5 * * * *" }, jobId: "repeat-5m-telem" });
}
