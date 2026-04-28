import { prisma } from "@/lib/prisma";

/**
 * Small in-memory TTL cache for feature-flag reads. Feature flags change
 * rarely (admin toggles through the UI); refreshing every 30s is more
 * than responsive enough without round-tripping to Postgres on every
 * `/booking` render.
 *
 * The cache is per-process — in a multi-instance deployment flags can be
 * out-of-sync for up to TTL_MS. Acceptable for UX-surface flags; do NOT
 * use this reader for security-sensitive gates.
 */
const TTL_MS = 30_000;

type CacheEntry = { value: boolean; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export async function getFeatureFlag(key: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const row = await prisma.featureFlag.findUnique({
    where: { key },
    select: { enabled: true },
  });
  const value = row?.enabled ?? false;
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

/**
 * Batch variant for pages that need several flags at once — issues a
 * single `findMany` instead of N round-trips.
 */
export async function getFeatureFlags<K extends string>(
  keys: readonly K[],
): Promise<Record<K, boolean>> {
  const now = Date.now();
  const result = {} as Record<K, boolean>;
  const toFetch: K[] = [];
  for (const key of keys) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      result[key] = cached.value;
    } else {
      toFetch.push(key);
    }
  }
  if (toFetch.length > 0) {
    const rows = await prisma.featureFlag.findMany({
      where: { key: { in: toFetch } },
      select: { key: true, enabled: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    for (const key of toFetch) {
      const value = byKey.get(key) ?? false;
      cache.set(key, { value, expiresAt: now + TTL_MS });
      result[key] = value;
    }
  }
  return result;
}

/** Test-only. Clears the in-memory cache so tests can assert fresh reads. */
export function __resetFeatureFlagCacheForTests(): void {
  cache.clear();
}
