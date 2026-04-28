/**
 * Shared constants + types for the staff customers filter. Lives in `src/lib/`
 * so that client components can import it without pulling the whole tRPC
 * router (and therefore Prisma) into the browser bundle.
 */

export const STATUS_FILTERS = [
  "ALL",
  "PENDING_HIRE",
  "ACTIVE_RENTAL",
  "UNVERIFIED",
  "LICENCE_EXPIRED",
  "HIGH_RISK",
  "SUSPENDED",
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];
