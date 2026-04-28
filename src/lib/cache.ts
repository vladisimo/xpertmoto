import superjson from "superjson";
import { getRedis } from "./redis";

const TAG_SET_PREFIX = "tagset:";

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
      const pipe = redis.pipeline();
      for (const tag of tags) {
        pipe.sadd(`${TAG_SET_PREFIX}${tag}`, key);
        pipe.expire(`${TAG_SET_PREFIX}${tag}`, Math.max(ttlSec, 3600));
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
  const setKey = `${TAG_SET_PREFIX}${tag}`;
  try {
    const members = await redis.smembers(setKey);
    if (members.length > 0) await redis.del(...members);
    await redis.del(setKey);
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
