import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
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

  const databaseOk = diag.database.ok;
  if (!databaseOk) {
    logger.warn({ diag }, "health: database degraded");
  }

  return NextResponse.json(
    { status: databaseOk ? "ok" : "degraded" },
    {
      status: databaseOk ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
