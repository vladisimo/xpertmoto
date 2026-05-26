import { FleetUseCase } from "@prisma/client";

// Use cases are now the four *pure* "what you'd use it for" tags. Machine kind
// (sport/cruiser/naked…) moved to BikeType (`bike-types.ts`) and learner
// suitability to RiderLevel (`rider-levels.ts`) — see the bike_classification
// _axes migration.
export const USE_CASES: readonly FleetUseCase[] = [
  "ADVENTURE",
  "COMMUTING",
  "PRACTICE",
  "DELIVERY",
] as const;

export const USE_CASE_LABELS: Record<FleetUseCase, string> = {
  ADVENTURE: "Adventure",
  COMMUTING: "Commuting",
  PRACTICE: "Practice",
  DELIVERY: "Delivery",
};

export const USE_CASE_SLUGS: Record<FleetUseCase, string> = {
  ADVENTURE: "adventure",
  COMMUTING: "commuting",
  PRACTICE: "practice",
  DELIVERY: "delivery",
};

export const USE_CASE_DESCRIPTIONS: Record<FleetUseCase, string> = {
  ADVENTURE: "Dual-sport and adventure tourers built for long miles and rougher tracks.",
  COMMUTING: "Light, easy city bikes and scooters for the daily ride.",
  PRACTICE: "Forgiving first bikes — perfect for building licence hours.",
  DELIVERY: "Cheap-to-run delivery workhorses, vans, and fleet scooters.",
};

const SLUG_TO_USE_CASE: Record<string, FleetUseCase> = Object.fromEntries(
  (Object.entries(USE_CASE_SLUGS) as Array<[FleetUseCase, string]>).map(
    ([useCase, slug]) => [slug, useCase],
  ),
);

export function slugToUseCase(slug: string | undefined | null): FleetUseCase | null {
  if (!slug) return null;
  return SLUG_TO_USE_CASE[slug] ?? null;
}

export function useCaseToSlug(useCase: FleetUseCase): string {
  return USE_CASE_SLUGS[useCase];
}

export const DEFAULT_USE_CASE: FleetUseCase = "COMMUTING";

// "All" sentinel for the fleet page tab strip — not a real FleetUseCase.
// Home preview tabs don't include it (see UseCaseTabs `includeAll`).
export const ALL_TAB = "all" as const;
export type FleetTab = typeof ALL_TAB | FleetUseCase;
export const ALL_TAB_LABEL = "All";

export function slugToTab(slug: string | undefined | null): FleetTab | null {
  if (!slug) return null;
  if (slug === ALL_TAB) return ALL_TAB;
  return SLUG_TO_USE_CASE[slug] ?? null;
}

export function tabToSlug(tab: FleetTab): string {
  return tab === ALL_TAB ? ALL_TAB : USE_CASE_SLUGS[tab];
}

export const DEFAULT_FLEET_TAB: FleetTab = ALL_TAB;
