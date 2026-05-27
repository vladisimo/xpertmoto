import { BikeType } from "@prisma/client";

/**
 * Bike-type taxonomy — a browse/filter axis on `VehicleModel.bikeTypes`. A
 * model can carry more than one (e.g. a naked that doubles as a sport bike).
 * Display only; never drives pricing or eligibility. Mirrors the shape of
 * `fleet-use-cases.ts`.
 */

export const BIKE_TYPES: readonly BikeType[] = [
  "NAKED",
  "SCOOTER",
  "TOURING",
  "SPORT",
  "CRUISER",
  "SUPER_SPORT",
] as const;

export const BIKE_TYPE_LABELS: Record<BikeType, string> = {
  NAKED: "Naked",
  SCOOTER: "Scooter",
  TOURING: "Touring",
  SPORT: "Sport",
  CRUISER: "Cruiser",
  SUPER_SPORT: "Super Sport",
};

export const BIKE_TYPE_SLUGS: Record<BikeType, string> = {
  NAKED: "naked",
  SCOOTER: "scooter",
  TOURING: "touring",
  SPORT: "sport",
  CRUISER: "cruiser",
  SUPER_SPORT: "super-sport",
};

const SLUG_TO_BIKE_TYPE: Record<string, BikeType> = Object.fromEntries(
  (Object.entries(BIKE_TYPE_SLUGS) as Array<[BikeType, string]>).map(
    ([bikeType, slug]) => [slug, bikeType],
  ),
);

export function slugToBikeType(slug: string | undefined | null): BikeType | null {
  if (!slug) return null;
  return SLUG_TO_BIKE_TYPE[slug] ?? null;
}

export function bikeTypeToSlug(bikeType: BikeType): string {
  return BIKE_TYPE_SLUGS[bikeType];
}
