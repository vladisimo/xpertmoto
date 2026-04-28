import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export interface GeoLookup {
  country: string | null;
  region: string | null;
  city: string | null;
}

export interface DeviceLookup {
  deviceType: "MOBILE" | "TABLET" | "DESKTOP" | "BOT";
}

const GEO_CACHE_KEY = (ipHash: string) => `geo:${ipHash}`;
const GEO_CACHE_TTL_SECONDS = 60 * 60 * 24;

let readerPromise: Promise<ReaderLike | null> | null = null;

interface ReaderLike {
  city(ip: string): {
    country?: { isoCode?: string };
    subdivisions?: Array<{ isoCode?: string; names?: { en?: string } }>;
    city?: { names?: { en?: string } };
  };
}

async function getReader(): Promise<ReaderLike | null> {
  if (!env.MAXMIND_DB_PATH) return null;
  if (readerPromise) return readerPromise;
  readerPromise = (async () => {
    try {
      const { Reader } = await import("@maxmind/geoip2-node");
      const fs = await import("node:fs/promises");
      const buf = await fs.readFile(env.MAXMIND_DB_PATH!);
      return Reader.openBuffer(buf) as unknown as ReaderLike;
    } catch (err) {
      logger.warn({ err }, "geo-ip: failed to open MaxMind DB; geo lookup disabled");
      return null;
    }
  })();
  return readerPromise;
}

/**
 * Hash an IP with the configured salt. Raw IP is never persisted. Returns
 * `null` if IP is missing or no salt is configured (dev-time only).
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (!env.IP_HASH_SALT) return null;
  return createHash("sha256").update(`${ip}|${env.IP_HASH_SALT}`).digest("hex").slice(0, 32);
}

/**
 * Resolve an IP to a coarse geo {country, region, city}. Cached in Redis by
 * ipHash for 24h to avoid repeated mmdb opens under load. Returns nulls when
 * MaxMind is not configured or the IP is private/unknown.
 */
export async function lookupGeo(ip: string | null | undefined, ipHash: string | null): Promise<GeoLookup> {
  const empty: GeoLookup = { country: null, region: null, city: null };
  if (!ip) return empty;
  const redis = getRedis();
  if (redis && ipHash) {
    try {
      const cached = await redis.get(GEO_CACHE_KEY(ipHash));
      if (cached) return JSON.parse(cached) as GeoLookup;
    } catch {
      // non-fatal
    }
  }
  const reader = await getReader();
  if (!reader) return empty;
  try {
    const res = reader.city(ip);
    const geo: GeoLookup = {
      country: res.country?.isoCode ?? null,
      region: res.subdivisions?.[0]?.isoCode ?? res.subdivisions?.[0]?.names?.en ?? null,
      city: res.city?.names?.en ?? null,
    };
    if (redis && ipHash) {
      await redis.set(GEO_CACHE_KEY(ipHash), JSON.stringify(geo), "EX", GEO_CACHE_TTL_SECONDS).catch(() => undefined);
    }
    return geo;
  } catch {
    return empty;
  }
}

/**
 * Classify a user agent string into a coarse device type. Returns BOT for
 * known crawler signatures, otherwise falls back to mobile/tablet/desktop
 * based on common UA patterns.
 */
export function classifyDevice(userAgent: string | null | undefined): DeviceLookup["deviceType"] {
  if (!userAgent) return "DESKTOP";
  const ua = userAgent.toLowerCase();
  if (/bot|crawl|spider|slurp|googlebot|bingbot|duckduckbot|baiduspider|yandex|ahrefsbot|semrushbot|mj12bot/.test(ua)) {
    return "BOT";
  }
  if (/tablet|ipad|playbook|silk/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) {
    return "TABLET";
  }
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) {
    return "MOBILE";
  }
  return "DESKTOP";
}
