/**
 * Canonical "which booking held this vehicle at instant T" matcher.
 *
 * Both the Linkt toll sync and the NSW infringement-nomination workflow need
 * to attribute an external event (a toll trip / a penalty notice) to the
 * renter who had the vehicle at the offence time. This module is the single
 * source of that logic so the two flows can't drift.
 *
 * Three refinements over a naive scheduled-window lookup:
 *   1. Prefer ACTUAL check-out/return times, falling back to the scheduled
 *      times only when the actuals haven't been recorded yet. A vehicle
 *      returned early shouldn't inherit offences that happened after the
 *      renter handed it back.
 *   2. Restrict to statuses where the vehicle was genuinely in a renter's
 *      hands (excludes QUOTE / PENDING / CANCELLED), so a stale draft never
 *      gets nominated.
 *   3. Swap-aware: `booking.vehicleId` is overwritten by each committed
 *      mid-hire swap, so the matcher walks the `BookingSwap` chain to
 *      reconstruct which physical vehicle the booking actually held at T —
 *      a booking swapped OFF the vehicle before T must not inherit the
 *      offence, and one swapped ONTO it must.
 *
 * `resolveBookingForVehicleAt` reports the overlapping-rentals case as
 * `ambiguous` so the caller can force staff review before any nomination —
 * false nomination to Revenue NSW is a criminal offence, so the matcher never
 * silently guesses.
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

// Candidate rows additionally carry the current vehicle + the committed swap
// chain so `vehicleAt` can reconstruct which vehicle was held at T. Both are
// stripped before the row is returned as a MatchedBooking.
const CANDIDATE_SELECT = {
  ...BOOKING_SELECT,
  vehicleId: true,
  swaps: {
    where: { status: "COMMITTED" as const, deletedAt: null },
    orderBy: { swappedAt: "asc" as const },
    select: { outgoingVehicleId: true, incomingVehicleId: true, swappedAt: true },
  },
} as const;

type SwapStep = {
  outgoingVehicleId: string;
  incomingVehicleId: string | null;
  swappedAt: Date;
};

function heldAtWhere(vehicleId: string, at: Date) {
  return {
    // The vehicle is either still on the booking, or a committed swap moved it
    // on/off mid-hire. This only widens the candidate set — `vehicleAt` below
    // decides which vehicle the booking actually held at `at`.
    OR: [
      { vehicleId },
      {
        swaps: {
          some: {
            status: "COMMITTED" as const,
            deletedAt: null,
            OR: [{ outgoingVehicleId: vehicleId }, { incomingVehicleId: vehicleId }],
          },
        },
      },
    ],
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
 * Which physical vehicle the booking held at `at`. Each committed swap
 * overwrites `booking.vehicleId`, so with swaps present the original vehicle
 * is the FIRST swap's outgoing vehicle; every swap with `swappedAt <= at`
 * then advances the chain to its incoming vehicle.
 */
function vehicleAt(
  booking: { vehicleId: string | null; swaps: SwapStep[] },
  at: Date,
): string | null {
  if (booking.swaps.length === 0) return booking.vehicleId;
  let held: string | null = booking.swaps[0]!.outgoingVehicleId;
  for (const swap of booking.swaps) {
    if (swap.swappedAt.getTime() > at.getTime()) break;
    held = swap.incomingVehicleId;
  }
  return held;
}

/**
 * Every booking that held `vehicleId` at `at`, swap-aware. More than one row
 * means overlapping rentals — ambiguous, the caller must escalate to staff
 * rather than auto-attribute. Ordered most-recent pickup first.
 */
export async function findCandidateBookingsForVehicleAt(
  prisma: PrismaClient,
  vehicleId: string,
  at: Date,
): Promise<MatchedBooking[]> {
  const rows = await prisma.booking.findMany({
    where: heldAtWhere(vehicleId, at),
    orderBy: { pickupDateTime: "desc" },
    select: CANDIDATE_SELECT,
  });
  return rows
    .filter((b) => vehicleAt(b, at) === vehicleId)
    .map(({ vehicleId: _vehicleId, swaps: _swaps, ...booking }) => booking);
}

export type VehicleAtResolution =
  | { kind: "match"; booking: MatchedBooking }
  | { kind: "ambiguous"; candidates: MatchedBooking[] }
  | { kind: "none" };

/**
 * Resolve the renter who held `vehicleId` at `at`. Exactly one candidate is a
 * `match`; overlapping candidates come back as `ambiguous` so the caller can
 * park the event for staff review instead of guessing at who to bill or
 * nominate.
 */
export async function resolveBookingForVehicleAt(
  prisma: PrismaClient,
  vehicleId: string,
  at: Date,
): Promise<VehicleAtResolution> {
  const candidates = await findCandidateBookingsForVehicleAt(prisma, vehicleId, at);
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "match", booking: candidates[0]! };
  return { kind: "ambiguous", candidates };
}

/**
 * The single booking that held `vehicleId` at `at`, or null. Returns null for
 * BOTH the no-candidate and the ambiguous-overlap case — it never guesses.
 *
 * @deprecated Use {@link resolveBookingForVehicleAt} so the ambiguous case is
 * distinguishable from "no renter" and can be surfaced to staff.
 */
export async function findBookingForVehicleAt(
  prisma: PrismaClient,
  vehicleId: string,
  at: Date,
): Promise<MatchedBooking | null> {
  const resolution = await resolveBookingForVehicleAt(prisma, vehicleId, at);
  return resolution.kind === "match" ? resolution.booking : null;
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
