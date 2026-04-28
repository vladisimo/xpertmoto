import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSecret } from "@/lib/integration-config";
import { TelemetryBatchSchema, haversineKm, type TelemetryPing } from "@/lib/telemetry";
import { withAudit } from "@/lib/with-audit";

/**
 * Generic GPS telemetry ingest. Tracker vendors (Teltonika, Queclink,
 * Geotab) all differ in payload; callers should either normalise upstream
 * or POST the raw JSON and extend `TelemetryPingSchema`. Auth uses a
 * shared bearer token (`TELEMETRY_INGEST_TOKEN`) compared via
 * timingSafeEqual. Pings are persisted to `VehicleTelemetry` and
 * `Vehicle.currentOdometerKm` is updated in-place for the matching
 * `gpsTrackerId`.
 */
export const POST = withAudit({ name: "webhooks.telemetry", entity: "TelemetryIngest" }, handlePost);

async function handlePost(req: Request) {
  const expected = await getSecret("integration:telemetry:ingestToken", "TELEMETRY_INGEST_TOKEN");
  if (!expected) return new NextResponse("Telemetry ingest not configured", { status: 503 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (
    !token ||
    token.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const parsed = TelemetryBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const pings: TelemetryPing[] = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  let persisted = 0;
  let matched = 0;
  for (const p of pings) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { gpsTrackerId: p.deviceId },
      select: { id: true, currentOdometerKm: true },
    });
    if (vehicle) matched++;

    await prisma.vehicleTelemetry.create({
      data: {
        vehicleId: vehicle?.id,
        deviceId: p.deviceId,
        timestamp: p.timestamp,
        latitude: p.latitude,
        longitude: p.longitude,
        speedKph: p.speedKph,
        headingDeg: p.headingDeg,
        odometerKm: p.odometerKm,
        batteryPct: p.batteryPct,
        ignitionOn: p.ignitionOn,
        source: p.source,
      },
    });
    persisted++;

    if (vehicle && p.odometerKm != null) {
      const delta = p.odometerKm - (vehicle.currentOdometerKm ?? 0);
      if (delta >= 0 && delta < 5000) {
        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: { currentOdometerKm: Math.floor(p.odometerKm) },
        });
      } else {
        logger.warn(
          { vehicleId: vehicle.id, delta, reported: p.odometerKm },
          "telemetry: odometer delta out of bounds, ignored",
        );
      }
    }
  }

  const first = pings[0];
  const last = pings[pings.length - 1];
  if (first && last && pings.length > 1) {
    const dKm = haversineKm(
      { lat: first.latitude, lng: first.longitude },
      { lat: last.latitude, lng: last.longitude },
    );
    logger.debug(
      { deviceCount: new Set(pings.map((p) => p.deviceId)).size, dKm },
      "telemetry batch ingested",
    );
  }

  return NextResponse.json({ received: pings.length, persisted, matched });
}
