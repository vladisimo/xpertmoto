import superjson from "superjson";
import { getRedis } from "./redis";

/**
 * Tag → cached-key index, kept as a sorted set scored by the member key's
 * expiry time. Every write prunes already-expired members, so a hot tag
 * (one whose index TTL is refreshed on every write, e.g. per-depot
 * availability) can't accumulate dead keys without bound the way the
 * previous plain-SET index did.
 */
const TAG_ZSET_PREFIX = "tagz:";
/** Pre-zset plain-SET index keys. Only read at invalidation time so
 *  in-flight entries written before a deploy still get dropped; the sets
 *  themselves age out via their old TTLs. Remove once no `tagset:*` keys
 *  remain in prod Redis. */
const LEGACY_TAG_SET_PREFIX = "tagset:";

function encode<T>(value: T): string {
  return superjson.stringify(value);
}

function decode<T>(raw: string): T {
  return superjson.parse<T>(raw);
}

export async function cached<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>,
  tags?: readonly string[],
): Promise<T> {
  const redis = getRedis();
  if (!redis) return fn();

  try {
    const hit = await redis.get(key);
    if (hit !== null) return decode<T>(hit);
  } catch {
    return fn();
  }

  const value = await fn();

  try {
    await redis.set(key, encode(value), "EX", ttlSec);
    if (tags && tags.length > 0) {
      const now = Date.now();
      const pipe = redis.pipeline();
      for (const tag of tags) {
        const indexKey = `${TAG_ZSET_PREFIX}${tag}`;
        pipe.zadd(indexKey, now + ttlSec * 1000, key);
        pipe.zremrangebyscore(indexKey, 0, now);
        pipe.expire(indexKey, Math.max(ttlSec, 3600));
      }
      await pipe.exec();
    }
  } catch {
    // Swallow cache write errors — never block the request path.
  }

  return value;
}

export async function invalidateTag(tag: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const indexKey = `${TAG_ZSET_PREFIX}${tag}`;
  const legacyKey = `${LEGACY_TAG_SET_PREFIX}${tag}`;
  try {
    const members = await redis.zrange(indexKey, 0, -1);
    const legacy = await redis.smembers(legacyKey).catch(() => [] as string[]);
    const all = [...new Set([...members, ...legacy])];
    if (all.length > 0) await redis.del(...all);
    await redis.del(indexKey, legacyKey);
  } catch {
    // non-fatal
  }
}

export async function invalidateTags(tags: readonly string[]): Promise<void> {
  await Promise.all(tags.map((t) => invalidateTag(t)));
}

export async function invalidateKey(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // non-fatal
  }
}
