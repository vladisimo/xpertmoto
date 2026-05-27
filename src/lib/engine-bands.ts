/**
 * Engine-capacity bands — a *derived* browse/filter axis. There is no stored
 * column; we bucket `VehicleModel.engineCapacityCc` on the fly. Mirrors the
 * shape of `fleet-use-cases.ts` (constants + labels + slugs + helpers) so the
 * UI and routers can treat all four classification axes uniformly.
 */

export const ENGINE_BANDS = [
  "CC_110_160",
  "CC_161_300",
  "CC_301_600",
  "CC_601_1000",
  "CC_1000_PLUS",
] as const;

export type EngineBand = (typeof ENGINE_BANDS)[number];

export const ENGINE_BAND_LABELS: Record<EngineBand, string> = {
  CC_110_160: "110–160cc",
  CC_161_300: "161–300cc",
  CC_301_600: "301–600cc",
  CC_601_1000: "601–1000cc",
  CC_1000_PLUS: "1000cc+",
};

export const ENGINE_BAND_SLUGS: Record<EngineBand, string> = {
  CC_110_160: "110-160",
  CC_161_300: "161-300",
  CC_301_600: "301-600",
  CC_601_1000: "601-1000",
  CC_1000_PLUS: "1000-plus",
};

/** Inclusive cc bounds for each band. The top band is open-ended (`max: null`). */
export const ENGINE_BAND_RANGES: Record<EngineBand, { min: number; max: number | null }> = {
  CC_110_160: { min: 110, max: 160 },
  CC_161_300: { min: 161, max: 300 },
  CC_301_600: { min: 301, max: 600 },
  CC_601_1000: { min: 601, max: 1000 },
  CC_1000_PLUS: { min: 1001, max: null },
};

/**
 * Bucket a raw cc value into a band. Anything below the smallest band (or
 * null/undefined) returns `null` so a model with no — or an unclassifiably
 * small — engine simply falls out of every band filter.
 */
export function ccToBand(cc: number | null | undefined): EngineBand | null {
  if (cc == null || cc < ENGINE_BAND_RANGES.CC_110_160.min) return null;
  for (const band of ENGINE_BANDS) {
    const { min, max } = ENGINE_BAND_RANGES[band];
    if (cc >= min && (max == null || cc <= max)) return band;
  }
  return null;
}

export function bandToRange(band: EngineBand): { min: number; max: number | null } {
  return ENGINE_BAND_RANGES[band];
}

/**
 * Translate a band into a Prisma int filter for `engineCapacityCc`. The
 * open-ended top band omits `lte`. Use directly:
 *   where.engineCapacityCc = bandToWhere(band)
 */
export function bandToWhere(band: EngineBand): { gte: number; lte?: number } {
  const { min, max } = ENGINE_BAND_RANGES[band];
  return max == null ? { gte: min } : { gte: min, lte: max };
}

const SLUG_TO_BAND: Record<string, EngineBand> = Object.fromEntries(
  (Object.entries(ENGINE_BAND_SLUGS) as Array<[EngineBand, string]>).map(
    ([band, slug]) => [slug, band],
  ),
);

export function slugToBand(slug: string | undefined | null): EngineBand | null {
  if (!slug) return null;
  return SLUG_TO_BAND[slug] ?? null;
}

export function bandToSlug(band: EngineBand): string {
  return ENGINE_BAND_SLUGS[band];
}
