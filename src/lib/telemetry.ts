import { z } from "zod";

export const TelemetryPingSchema = z.object({
  deviceId: z.string().min(1),
  timestamp: z.coerce.date(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  speedKph: z.number().nonnegative().optional(),
  headingDeg: z.number().gte(0).lt(360).optional(),
  odometerKm: z.number().nonnegative().optional(),
  batteryPct: z.number().min(0).max(100).optional(),
  ignitionOn: z.boolean().optional(),
  source: z.string().optional(),
});
export type TelemetryPing = z.infer<typeof TelemetryPingSchema>;

export const TelemetryBatchSchema = z.union([
  TelemetryPingSchema,
  z.array(TelemetryPingSchema).max(500),
]);

/**
 * Compute great-circle distance (km) between two lat/lng points. Used to
 * detect odometer anomalies when trackers report wildly out-of-bounds deltas.
 */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
