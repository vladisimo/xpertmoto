// Flush the e2e Redis logical DB so a reseed's freshly generated row ids never
// collide with a stale cached payload (e.g. "depot:list:active") left over from
// a previous e2e run. Loaded with .env.e2e so REDIS_URL points at the e2e DB.
import { config } from "dotenv";
import Redis from "ioredis";

config({ path: ".env.e2e" });

const url = process.env.REDIS_URL;
if (!url) {
  console.log("[flush-e2e-cache] no REDIS_URL — nothing to flush");
  process.exit(0);
}

const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
redis.on("error", (e) => {
  console.log(`[flush-e2e-cache] redis unavailable (${e.code}) — skipping`);
  process.exit(0);
});
await redis.flushdb();
console.log("[flush-e2e-cache] flushed e2e Redis DB");
await redis.quit();
process.exit(0);
