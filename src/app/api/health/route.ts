import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { rateLimiterStatus } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Unauthenticated liveness + readiness probe. Hits the DB with a tiny
 * query and pings Redis. Public response is intentionally minimal to
 * avoid leaking internal topology or per-dependency timings to
 * unauthenticated callers:
 *   - 200 + `{ status: "ok" }` when the database responds
 *   - 503 + `{ status: "degraded" }` when the database is unreachable
 *
 * Redis failure does not flip overall status — rate limiting fails open
 * (see `src/lib/rate-limit.ts`), so the app still serves traffic. A full
 * internal diagnostic (with per-backend timings + error strings) is logged
 * at `info`/`warn` instead of returned to the caller.
 */
export async function GET(): Promise<Response> {
  const diag: Record<string, { ok: boolean; ms: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    diag.database = { ok: true, ms: Date.now() - dbStart };
  } catch (err) {
    diag.database = {
      ok: false,
      ms: Date.now() - dbStart,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    };
  }

  const redisStart = Date.now();
  try {
    const redis = getRedis();
    if (redis) {
      const pong = await redis.ping();
      diag.redis = { ok: pong === "PONG", ms: Date.now() - redisStart };
    } else {
      diag.redis = { ok: false, ms: 0, error: "not configured" };
    }
  } catch (err) {
    diag.redis = {
      ok: false,
      ms: Date.now() - redisStart,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    };
  }

  // Limiter state stays out of the public body — an unauthenticated caller
  // learning "rate limiting is currently off" is an invitation. Operators
  // get it via the logged diag (and rate-limit.ts's own Sentry event).
  const limiter = rateLimiterStatus();
  diag.rateLimiter = {
    ok: !limiter.degraded,
    ms: 0,
    ...(limiter.degradedSince
      ? { error: `failing open since ${new Date(limiter.degradedSince).toISOString()}` }
      : {}),
  };

  const databaseOk = diag.database.ok;
  if (!databaseOk) {
    logger.warn({ diag }, "health: database degraded");
  } else if (limiter.degraded || !diag.redis.ok) {
    logger.warn({ diag }, "health: redis/rate-limiter degraded (failing open)");
  }

  return NextResponse.json(
    { status: databaseOk ? "ok" : "degraded" },
    {
      status: databaseOk ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
