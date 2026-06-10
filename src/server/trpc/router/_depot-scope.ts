import { TRPCError } from "@trpc/server";
import type { PrismaClient, UserRole } from "@prisma/client";

/**
 * Depot trust boundary for back-office procedures.
 *
 * STAFF users are scoped to their assigned depot; MANAGER and above see every
 * depot. Modelled on the support router's enforcement (support.ts list +
 * ticketDetail), with one deliberate divergence: support.ts ticketDetail
 * FORBIDs a STAFF user with no depot assignment from any depot-tagged
 * record, while these helpers treat unassigned STAFF as all-depot — the
 * same semantics support.ts itself uses for lists, and the behaviour the
 * seeded back-office users rely on. If the depot rules change, update this
 * file and support.ts in lock-step.
 */
export interface DepotScopedUser {
  role: UserRole;
  depotId: string | null;
}

/**
 * Resolve the depot filter a list/aggregate query may use. STAFF are pinned
 * to their own depot regardless of what they requested (a STAFF user with no
 * depot assignment is unrestricted, matching support.list); MANAGER+ get the
 * requested filter as-is.
 */
export function scopedDepotFilter(
  user: DepotScopedUser,
  requested?: string | null,
): string | undefined {
  if (user.role === "STAFF") return user.depotId ?? undefined;
  return requested ?? undefined;
}

/**
 * Detail/mutation guard: a STAFF user with an assigned depot touching a
 * record that belongs to another depot is FORBIDDEN. STAFF without a depot
 * assignment are unrestricted (consistent with scopedDepotFilter), and
 * records without a depot are visible to everyone.
 */
export function assertDepotAccess(
  user: DepotScopedUser,
  recordDepotId: string | null | undefined,
): void {
  if (
    user.role === "STAFF" &&
    user.depotId &&
    recordDepotId &&
    recordDepotId !== user.depotId
  ) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

/**
 * Booking-id guard for procedures that take a booking id before fetching the
 * full record. Cheap depot-only lookup; a missing booking falls through so
 * the procedure's own NOT_FOUND handling stays authoritative.
 */
export async function assertBookingDepotAccess(
  ctx: { prisma: PrismaClient; user: DepotScopedUser },
  bookingId: string,
): Promise<void> {
  if (ctx.user.role !== "STAFF" || !ctx.user.depotId) return;
  const booking = await ctx.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { depotId: true },
  });
  if (booking) assertDepotAccess(ctx.user, booking.depotId);
}
