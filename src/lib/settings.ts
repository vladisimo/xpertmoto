import { prisma } from "@/lib/prisma";
import { SETTING_DEFAULTS, type SettingKey } from "@/lib/settings-defaults";

export {
  SETTING_DEFAULTS,
  SETTING_GROUP_FOR,
  SETTING_DESCRIPTIONS,
  type SettingKey,
} from "@/lib/settings-defaults";

/**
 * Read a single SystemSetting with a type-safe fallback. Server-only.
 * Returns the stored value if present; otherwise returns `fallback`.
 * Missing rows, null values, and transient Prisma errors all resolve
 * to the fallback so callers never have to null-check.
 */
export async function getSetting<T>(key: SettingKey | string, fallback: T): Promise<T> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    const v = row.value;
    if (v === null || v === undefined) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

/**
 * Batch-read several SystemSettings in one query. Each key falls back
 * independently to its SETTING_DEFAULTS entry when missing. Use this in
 * hot paths (e.g. the cancellation-quote endpoint) to avoid N+1s.
 */
export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<{ [P in K]: (typeof SETTING_DEFAULTS)[P] }> {
  // Use try/catch (not just `.catch`) so a missing `systemSetting` delegate
  // — e.g. when a test mocks `prisma` with only the models it cares about —
  // still resolves to defaults instead of tripping a TypeError on
  // `undefined.findMany`.
  let rows: { key: string; value: unknown }[] = [];
  try {
    rows = await prisma.systemSetting.findMany({
      where: { key: { in: keys as unknown as string[] } },
    });
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as { [P in K]: (typeof SETTING_DEFAULTS)[P] };
  for (const k of keys) {
    const v = byKey.get(k);
    out[k] = (v ?? SETTING_DEFAULTS[k]) as (typeof SETTING_DEFAULTS)[typeof k];
  }
  return out;
}

/**
 * Upsert a single SystemSetting. The value is stored directly (not
 * wrapped as a plaintext/encrypted envelope — use the dedicated
 * integration-config helpers for that). Admin UIs should audit the
 * write separately.
 */
export async function setSetting<K extends SettingKey | string>(
  key: K,
  value: unknown,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: key as string },
    create: { key: key as string, value: value as never },
    update: { value: value as never },
  });
}

/**
 * Convenience wrapper that returns the raw value object (no fallback
 * merging). Callers apply their own defaults. Useful when a caller
 * wants to see which keys are actually present in the DB vs falling
 * through to SETTING_DEFAULTS.
 */
export async function getSettingsMap(
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  let rows: { key: string; value: unknown }[] = [];
  try {
    rows = await prisma.systemSetting.findMany({
      where: { key: { in: keys as string[] } },
    });
  } catch {
    rows = [];
  }
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
