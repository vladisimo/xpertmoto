import { RiderLevel } from "@prisma/client";

/**
 * Rider-level taxonomy — a browse/filter axis on `VehicleModel.riderLevels`. A
 * model can suit a range of levels. Display only; this is NOT a substitute for
 * the licence/age eligibility checks that gate booking. Mirrors the shape of
 * `fleet-use-cases.ts`.
 */

export const RIDER_LEVELS: readonly RiderLevel[] = [
  "BEGINNER",
  "INTERMEDIATE",
  "ADVANCED",
] as const;

export const RIDER_LEVEL_LABELS: Record<RiderLevel, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export const RIDER_LEVEL_SLUGS: Record<RiderLevel, string> = {
  BEGINNER: "beginner",
  INTERMEDIATE: "intermediate",
  ADVANCED: "advanced",
};

const SLUG_TO_RIDER_LEVEL: Record<string, RiderLevel> = Object.fromEntries(
  (Object.entries(RIDER_LEVEL_SLUGS) as Array<[RiderLevel, string]>).map(
    ([riderLevel, slug]) => [slug, riderLevel],
  ),
);

export function slugToRiderLevel(slug: string | undefined | null): RiderLevel | null {
  if (!slug) return null;
  return SLUG_TO_RIDER_LEVEL[slug] ?? null;
}

export function riderLevelToSlug(riderLevel: RiderLevel): string {
  return RIDER_LEVEL_SLUGS[riderLevel];
}
