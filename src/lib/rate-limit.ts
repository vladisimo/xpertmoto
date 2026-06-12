import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import * as Sentry from "@sentry/nextjs";
import { getRedis } from "./redis";
import { logger } from "./logger";

/**
 * Fail-open visibility. The limiter deliberately fails open when Redis is
 * unreachable (the app must keep serving), but the pino warn it used to
 * emit isn't shipped anywhere in production — a Redis outage silently
 * disabled ALL rate limiting (login brute force, booking spam) until
 * someone happened to read logs. Failures now reach Sentry, throttled to
 * one event per minute per process so an outage at load doesn't flood the
 * quota, and the degraded state is queryable for the health endpoint.
 */
let degradedSince: number | null = null;
let lastSentryReport = 0;
const SENTRY_REPORT_INTERVAL_MS = 60_000;

function reportFailOpen(reason: "redis-unavailable" | "redis-error", key: string, err?: unknown): void {
  if (degradedSince === null) degradedSince = Date.now();
  const now = Date.now();
  if (now - lastSentryReport >= SENTRY_REPORT_INTERVAL_MS) {
    lastSentryReport = now;
    Sentry.captureMessage("rate-limit failing open — limiter disabled", {
      level: "error",
      tags: { service: "rate-limit", reason },
      extra: { key, err: err instanceof Error ? err.message : undefined },
    });
  }
}

export function rateLimiterStatus(): { degraded: boolean; degradedSince: number | null } {
  return { degraded: degradedSince !== null, degradedSince };
}

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, now + window}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAt = now + window
if #oldest >= 2 then
  resetAt = tonumber(oldest[2]) + window
end
return {0, 0, resetAt}
`;

type ScriptRunner = (
  key: string,
  now: string,
  windowMs: string,
  limit: string,
  member: string,
) => Promise<[number, number, number]>;

const registered = new WeakSet<Redis>();

function getRunner(client: Redis): ScriptRunner {
  if (!registered.has(client)) {
    (client as unknown as { defineCommand: (name: string, opts: unknown) => void }).defineCommand(
      "slidingRateLimit",
      { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA },
    );
    registered.add(client);
  }
  // Must invoke the defined command as a method on the client — ioredis's
  // generated scripting function reads `this.options` internally, so a
  // standalone function reference would crash with
  // `Cannot read properties of undefined (reading 'options')`.
  return ((...args) => {
    const fn = (client as unknown as Record<string, unknown>)[
      "slidingRateLimit"
    ] as ScriptRunner;
    return fn.apply(client, args);
  }) as ScriptRunner;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Sliding-window rate limit. Redis-backed via a registered Lua script.
 * Fails open (returns ok:true) when Redis is unreachable so dev without
 * Redis still works — emits a warn so Sentry sees the degraded state.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  // LOADTEST_RATELIMIT_OFF=1 disables the IP-keyed limiter so a synthetic
  // load test from a single host isn't throttled. The load-test stack runs a
  // production build (NODE_ENV=production), so the kill-switch is instead
  // bound to a localhost APP_URL — on a real deployment (public APP_URL) the
  // flag is ignored and logged, so a leaked .env can't silently disable
  // rate limiting in production.
  if (process.env.LOADTEST_RATELIMIT_OFF === "1") {
    const appUrl = process.env.APP_URL ?? "";
    const isLocalStack = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appUrl);
    if (isLocalStack) {
      return { ok: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
    }
    logger.error(
      { appUrl },
      "rate-limit: LOADTEST_RATELIMIT_OFF is set on a non-localhost deployment — ignoring",
    );
  }
  const client = getRedis();
  if (!client) {
    logger.warn({ key, limit, windowSec }, "rate-limit: redis unavailable, failing open");
    reportFailOpen("redis-unavailable", key);
    return { ok: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
  }
  try {
    const run = getRunner(client);
    const [ok, remaining, resetAt] = await run(
      `rl:${key}`,
      String(Date.now()),
      String(windowSec * 1000),
      String(limit),
      randomUUID(),
    );
    degradedSince = null;
    return { ok: ok === 1, remaining, resetAt };
  } catch (err) {
    logger.error({ err, key }, "rate-limit: redis error, failing open");
    reportFailOpen("redis-error", key, err);
    return { ok: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
  }
}
