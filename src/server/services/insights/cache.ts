/**
 * Redis-backed cache for InsightsOverview. Keyed by scope (all / depotId)
 * and schema version. TTL is 25h so the daily regeneration job at 03:00
 * has a margin before the page shows an empty state. When Redis is
 * unavailable we return null and the caller falls back to on-the-fly
 * generation.
 */

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import type { InsightsOverview } from "./types";

const VERSION = "v1";
const TTL_SECONDS = 25 * 60 * 60;

export function cacheKey(scope: string): string {
  return `insights:${VERSION}:${scope}`;
}

export function cacheScope(depotId?: string): string {
  return depotId ?? "all";
}

export async function readOverviewCache(
  depotId?: string,
): Promise<InsightsOverview | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey(cacheScope(depotId)));
    if (!raw) return null;
    return JSON.parse(raw) as InsightsOverview;
  } catch (err) {
    logger.warn({ err }, "insights cache read failed");
    return null;
  }
}

export async function writeOverviewCache(
  overview: InsightsOverview,
  depotId?: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      cacheKey(cacheScope(depotId)),
      JSON.stringify(overview),
      "EX",
      TTL_SECONDS,
    );
  } catch (err) {
    logger.warn({ err }, "insights cache write failed");
  }
}

export async function invalidateOverviewCache(depotId?: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(cacheKey(cacheScope(depotId)));
  } catch (err) {
    logger.warn({ err }, "insights cache invalidate failed");
  }
}
