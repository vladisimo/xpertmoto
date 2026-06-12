import { invalidateTags } from "@/lib/cache";
import { AVAILABILITY_TAG_PREFIX } from "@/lib/cache-tags";

/**
 * Cache tagging for the public availability endpoints (booking.availability,
 * booking.listAvailableVehicles). Entries are tagged per depot+day so a
 * booking event invalidates exactly the dates it blocks, plus a coarse
 * `availability:all` tag covering searches that span all depots.
 *
 * Freshness model: tag invalidation fires on booking confirm/cancel (the
 * high-frequency events); vehicle status changes and maintenance edits ride
 * the short TTL instead. Correctness never depends on this cache — the
 * Booking_no_overlap exclusion constraint + allocation advisory lock reject
 * a stale "available" answer at confirmation time.
 */

export const AVAILABILITY_CACHE_TTL_SEC = 60;
const ALL_DEPOTS_TAG = `${AVAILABILITY_TAG_PREFIX}all`;
// Long-term hires can span months; beyond this many day-tags the TTL is a
// better tool than hundreds of Redis set writes per cache entry.
const MAX_DAY_TAGS = 60;

function dayKeys(pickup: Date, ret: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(pickup.getUTCFullYear(), pickup.getUTCMonth(), pickup.getUTCDate()));
  const end = ret.getTime();
  while (cursor.getTime() <= end && days.length < MAX_DAY_TAGS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Tags to attach to a cached availability entry. */
export function availabilityTags(depotId: string | undefined, pickup: Date, ret: Date): string[] {
  if (!depotId) return [ALL_DEPOTS_TAG];
  return [
    ALL_DEPOTS_TAG,
    ...dayKeys(pickup, ret).map((d) => `${AVAILABILITY_TAG_PREFIX}${depotId}:${d}`),
  ];
}

/** Drop cached availability touched by a booking-shaped event. */
export async function invalidateAvailability(
  depotId: string,
  pickup: Date,
  ret: Date,
): Promise<void> {
  await invalidateTags([
    ALL_DEPOTS_TAG,
    ...dayKeys(pickup, ret).map((d) => `${AVAILABILITY_TAG_PREFIX}${depotId}:${d}`),
  ]);
}
