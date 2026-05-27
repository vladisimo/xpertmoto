/**
 * Single source of truth for "is this user a customer?".
 *
 * Identity is profile-based, NOT role-based: a user is a customer iff they
 * have a CustomerProfile row, regardless of their UserRole. Back-office
 * users (STAFF/MANAGER/ADMIN/SUPER_ADMIN) get a CustomerProfile too so they
 * can personally rent — see scripts/backfill-backoffice-customer-profiles.ts
 * and admin.inviteStaff. Booking.customerId is an unconstrained FK to
 * User.id; these helpers keep the booking guards and the back-office
 * customer directory agreeing on who counts as a customer.
 */
import type { Prisma } from "@prisma/client";
import { needsOnboarding, type OnboardingProfileShape } from "./onboarding-status";

/**
 * Directory membership clause: a User appears in the back-office customer
 * directory iff they have a CustomerProfile. Merge into a larger `where`
 * via an `AND` array so it doesn't clobber a `customerProfile` filter set
 * by a status facet.
 */
export function customerDirectoryUserWhere(): Prisma.UserWhereInput {
  return { customerProfile: { isNot: null } };
}

/**
 * Raw-SQL mirror of customerDirectoryUserWhere() for the stats $queryRaw,
 * which LEFT JOINs CustomerProfile aliased as `cp`. Use inside FILTER
 * predicates: `COUNT(*) FILTER (WHERE ${CUSTOMER_DIRECTORY_SQL_PREDICATE})`.
 */
export const CUSTOMER_DIRECTORY_SQL_PREDICATE = `cp.id IS NOT NULL`;

/**
 * Eligibility to rent as a customer on the self-serve online flow
 * (booking.create): the user must have a CustomerProfile AND have completed
 * onboarding (licence + signed agreements). protectedProcedure does NOT gate
 * back-office sessions on onboarding (that would lock them out of the back
 * office), so booking.create must check this itself.
 *
 * Walk-in bookings intentionally use a looser rule (profile only) — staff
 * verify licence at the counter.
 */
export function canRentAsCustomer(
  profile: OnboardingProfileShape | null | undefined,
): boolean {
  return profile != null && !needsOnboarding(profile);
}
