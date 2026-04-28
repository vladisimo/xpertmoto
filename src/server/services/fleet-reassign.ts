import type { Prisma } from "@prisma/client";
import { allocateVehicle, acquireAllocationLock } from "@/server/services/availability";

export type ReassignSummary = {
  totalAffected: number;
  reassigned: Array<{ bookingId: string; reference: string; newVehicleId: string }>;
  needsManual: Array<{ bookingId: string; reference: string }>;
};

/**
 * D1: when a vehicle is pulled out of the fleet unexpectedly (STOLEN /
 * WRITTEN_OFF / forced decommission) the future bookings assigned to it
 * would otherwise silently fail at check-out. This helper iterates
 * those bookings and either:
 *   - reassigns them to another compatible vehicle at the same depot; or
 *   - nulls out `vehicleId` and tags the booking with an internal note
 *     flagging it for manual resolution (upgrade, refund, etc.).
 *
 * MUST run inside a `$transaction` so the vehicle status change and the
 * reassignments commit together. We take the allocation advisory lock
 * per (depot, category) pair to play nicely with concurrent booking
 * flows touching the same cells.
 */
export async function reassignFutureBookings(
  tx: Prisma.TransactionClient,
  vehicleId: string,
  changedById: string,
  reasonPrefix: string,
): Promise<ReassignSummary> {
  const now = new Date();
  const affected = await tx.booking.findMany({
    where: {
      vehicleId,
      status: "CONFIRMED",
      pickupDateTime: { gt: now },
    },
    select: {
      id: true,
      bookingReference: true,
      status: true,
      categoryId: true,
      pickupDepotId: true,
      pickupDateTime: true,
      returnDateTime: true,
    },
  });

  const reassigned: ReassignSummary["reassigned"] = [];
  const needsManual: ReassignSummary["needsManual"] = [];

  for (const b of affected) {
    await acquireAllocationLock(tx, b.pickupDepotId, b.categoryId);
    const replacement = await allocateVehicle(tx, {
      categoryId: b.categoryId,
      depotId: b.pickupDepotId,
      pickup: b.pickupDateTime,
      ret: b.returnDateTime,
    });

    if (replacement && replacement !== vehicleId) {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          vehicleId: replacement,
          bookingNotes: {
            create: {
              userId: changedById,
              note: `${reasonPrefix}: original vehicle removed from service; auto-reassigned to a compatible vehicle at the same depot.`,
              isInternal: false,
            },
          },
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: b.status,
              changedById,
              reason: `Vehicle reassigned (${reasonPrefix})`,
            },
          },
        },
      });
      reassigned.push({ bookingId: b.id, reference: b.bookingReference, newVehicleId: replacement });
    } else {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          vehicleId: null,
          bookingNotes: {
            create: {
              userId: changedById,
              note: `${reasonPrefix}: original vehicle removed and no compatible replacement available at the same depot. Staff must contact the customer to offer an upgrade, a different depot, or a refund.`,
              isInternal: true,
            },
          },
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: b.status,
              changedById,
              reason: `Vehicle unassigned — needs manual resolution (${reasonPrefix})`,
            },
          },
        },
      });
      needsManual.push({ bookingId: b.id, reference: b.bookingReference });
    }
  }

  return { totalAffected: affected.length, reassigned, needsManual };
}
