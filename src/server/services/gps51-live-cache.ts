/**
 * Short-lived Redis cache for the live fleet-map payload (fleet.liveLocations).
 *
 * The live map is polled by every open staff tab. Without a cache each tab's
 * poll re-runs the full VehicleLivePosition read + per-row vehicle/image join
 * against Postgres. A 10s TTL collapses N concurrent tabs into ~1 query per
 * window while staying well inside the 60s poll cadence, so the map never shows
 * data older than one poll. superjson preserves the `Date` timestamps so the
 * tRPC (superjson) contract is unchanged on a cache hit.
 *
 * Redis-absent (single-process dev) → returns null and the caller queries
 * directly; cache errors never fail the request.
 */
import superjson from "superjson";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const KEY = "gps51:live-locations:v1";
const TTL_SECONDS = 10;

export async function readLiveLocationsCache<T>(): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(KEY);
    if (!raw) return null;
    return superjson.parse<T>(raw);
  } catch (err) {
    logger.warn({ err }, "gps51 live-locations cache read failed");
    return null;
  }
}

export async function writeLiveLocationsCache<T>(payload: T): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(KEY, superjson.stringify(payload), "EX", TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, "gps51 live-locations cache write failed");
  }
}
