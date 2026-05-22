import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { getRedis } from "./redis";
import { logger } from "./logger";

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
  const client = getRedis();
  if (!client) {
    logger.warn({ key, limit, windowSec }, "rate-limit: redis unavailable, failing open");
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
    return { ok: ok === 1, remaining, resetAt };
  } catch (err) {
    logger.error({ err, key }, "rate-limit: redis error, failing open");
    return { ok: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
  }
}
