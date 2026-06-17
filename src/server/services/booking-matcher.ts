/**
 * Canonical "which booking held this vehicle at instant T" matcher.
 *
 * Both the Linkt toll sync and the NSW infringement-nomination workflow need
 * to attribute an external event (a toll trip / a penalty notice) to the
 * renter who had the vehicle at the offence time. This module is the single
 * source of that logic so the two flows can't drift.
 *
 * Two refinements over a naive scheduled-window lookup:
 *   1. Prefer ACTUAL check-out/return times, falling back to the scheduled
 *      times only when the actuals haven't been recorded yet. A vehicle
 *      returned early shouldn't inherit offences that happened after the
 *      renter handed it back.
 *   2. Restrict to statuses where the vehicle was genuinely in a renter's
 *      hands (excludes QUOTE / PENDING / CANCELLED), so a stale draft never
 *      gets nominated.
 *
 * `findCandidateBookingsForVehicleAt` returns every overlapping booking so
 * the caller can detect ambiguity (overlapping rentals on the same vehicle)
 * and force staff review before any nomination — false nomination to Revenue
 * NSW is a criminal offence, so the matcher never silently guesses.
 */
import type { PrismaClient } from "@prisma/client";

/** Statuses in which the vehicle was actually out with a renter. */
const HELD_STATUSES = [
  "CHECKED_OUT",
  "ACTIVE",
  "OVERDUE",
  "RETURNED",
  "COMPLETED",
] as const;

/** Normalise a plate / rego / toll-tag token for comparison. */
export function normalisePlate(s: string): string {
  return (s ?? "").toUpperCase().replace(/[\s\-]/g, "");
}

export type MatchedBooking = {
  id: string;
  bookingReference: string;
  customerId: string;
  status: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  customer: { firstName: string; lastName: string; email: string };
};

const BOOKING_SELECT = {
  id: true,
  bookingReference: true,
  customerId: true,
  status: true,
  pickupDateTime: true,
  returnDateTime: true,
  customer: { select: { firstName: true, lastName: true, email: true } },
} as const;

function heldAtWhere(vehicleId: string, at: Date) {
  return {
    vehicleId,
    status: { in: [...HELD_STATUSES] },
    AND: [
      {
        OR: [
          { actualPickupDateTime: { lte: at } },
          { actualPickupDateTime: null, pickupDateTime: { lte: at } },
        ],
      },
      {
        OR: [
          { actualReturnDateTime: null },
          { actualReturnDateTime: { gte: at } },
        ],
      },
    ],
  };
}

/**
 * Every booking that held `vehicleId` at `at`. More than one row means
 * overlapping rentals — ambiguous, the caller must escalate to staff rather
 * than auto-attribute. Ordered most-recent pickup first.
 */
export async function findCandidateBookingsForVehicleAt(
  prisma: PrismaClient,
  vehicleId: string,
  at: Date,
): Promise<MatchedBooking[]> {
  return prisma.booking.findMany({
    where: heldAtWhere(vehicleId, at),
    orderBy: { pickupDateTime: "desc" },
    select: BOOKING_SELECT,
  });
}

/**
 * The single most-recent booking that held `vehicleId` at `at`, or null.
 * Use {@link findCandidateBookingsForVehicleAt} when you need to detect the
 * ambiguous-overlap case before acting.
 */
export async function findBookingForVehicleAt(
  prisma: PrismaClient,
  vehicleId: string,
  at: Date,
): Promise<MatchedBooking | null> {
  return prisma.booking.findFirst({
    where: heldAtWhere(vehicleId, at),
    orderBy: { pickupDateTime: "desc" },
    select: BOOKING_SELECT,
  });
}

/**
 * Resolve a plate token to a vehicle. `Vehicle.rego` isn't stored normalised
 * and `gpsTrackerId` holds the toll-tag id when depots register tags per
 * vehicle, so we pull the (small) fleet and compare normalised in JS — rego
 * first, then tag.
 */
export async function resolveVehicleByPlate(
  prisma: PrismaClient,
  plate: string,
): Promise<{ id: string; rego: string } | null> {
  const token = normalisePlate(plate);
  if (!token) return null;
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, rego: true, gpsTrackerId: true },
  });
  const vehicle =
    vehicles.find((v) => normalisePlate(v.rego) === token) ??
    vehicles.find((v) => v.gpsTrackerId && normalisePlate(v.gpsTrackerId) === token);
  return vehicle ? { id: vehicle.id, rego: vehicle.rego } : null;
}
