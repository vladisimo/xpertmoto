export const QUERY_TIERS = {
  stable: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  operational: { staleTime: 30_000, gcTime: 5 * 60_000 },
  live: { staleTime: 0, gcTime: 60_000 },
} as const;

export type QueryTier = keyof typeof QUERY_TIERS;
