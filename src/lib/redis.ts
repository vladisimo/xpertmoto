import IORedis, { type Redis } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (globalForRedis.redis) return globalForRedis.redis;
  const client = new IORedis(url, { maxRetriesPerRequest: null });
  globalForRedis.redis = client;
  return client;
}
