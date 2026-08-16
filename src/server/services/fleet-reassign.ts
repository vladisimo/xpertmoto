import { createElement } from "react";
import { render } from "@react-email/render";
import type { Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getBranding } from "@/lib/branding";
import { allocateVehicle, acquireAllocationLock } from "@/server/services/availability";
import { sendNotification } from "@/server/services/notification-sender";
import { invalidateAvailability } from "@/server/services/availability-cache";
import VehicleReassigned from "../../../emails/vehicle-reassigned";

export type ReassignSummary = {
  totalAffected: number;
  reassigned: Array<{ bookingId: string; reference: string; newVehicleId: string }>;
  needsManual: Array<{ bookingId: string; reference: string }>;
  /** QUOTE rows whose tentative vehicle was detached silently (no note). */
  quotesUnassigned: Array<{ bookingId: string; reference: string }>;
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
 * Scope (Area 6): CONFIRMED and PENDING_PAYMENT bookings are both money
 * commitments and both get the treatment above. Rows whose pickup has
 * already passed are never auto-reassigned — the customer may be standing
 * at the counter, so they go straight to the needsManual bucket for a
 * human call. QUOTE rows are non-committal — their tentative vehicleId is
 * nulled silently with no note.
 *
 * MUST run inside a `$transaction` so the vehicle status change and the
 * reassignments commit together. We take the allocation advisory lock
 * per (depot, category) pair to play nicely with concurrent booking
 * flows touching the same cells.
 *
 * Notifications and cache invalidation are deliberately NOT done here —
 * call `notifyReassignmentOutcome` after the transaction commits.
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
      status: { in: ["QUOTE", "PENDING_PAYMENT", "CONFIRMED"] },
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
  const quotesUnassigned: ReassignSummary["quotesUnassigned"] = [];

  const flagNeedsManual = async (b: (typeof affected)[number], reason: string) => {
    await tx.booking.update({
      where: { id: b.id },
      data: {
        vehicleId: null,
        bookingNotes: {
          create: {
            userId: changedById,
            note: `${reasonPrefix}: ${reason}`,
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
  };

  for (const b of affected) {
    // QUOTE: no commitment yet — detach the lost vehicle silently so the
    // quote re-allocates (or lapses) on its own. No note, no status log.
    if (b.status === "QUOTE") {
      await tx.booking.update({ where: { id: b.id }, data: { vehicleId: null } });
      quotesUnassigned.push({ bookingId: b.id, reference: b.bookingReference });
      continue;
    }

    // Pickup already passed (customer may be mid-arrival / no-show in
    // progress): never auto-swap under them — needs a human decision.
    if (b.pickupDateTime <= now) {
      await flagNeedsManual(
        b,
        "original vehicle removed from service after the scheduled pickup time. Staff must contact the customer to arrange a replacement, offer an upgrade via the Change category action on the booking page, or refund.",
      );
      continue;
    }

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
      await flagNeedsManual(
        b,
        "original vehicle removed and no compatible replacement available at the same depot. Staff must contact the customer to offer an upgrade via the Change category action on the booking page, a different depot, or a refund.",
      );
    }
  }

  return { totalAffected: affected.length, reassigned, needsManual, quotesUnassigned };
}

/**
 * Post-commit fan-out for a `reassignFutureBookings` run. Call AFTER the
 * surrounding transaction commits (never inside it — this sends email and
 * talks to Redis). Best-effort throughout: every step is individually
 * guarded so a failed email never masks the committed reassignment, and
 * callers should still wrap the whole call in try/catch.
 *
 *  - Each auto-reassigned booking's customer gets a brief "vehicle
 *    updated — same category, nothing else changes" email.
 *  - Depot managers get ONE IN_APP+EMAIL digest listing the needsManual
 *    bookings (references + links payload).
 *  - Availability cache for the removed vehicle's depot is invalidated
 *    from now to the latest affected booking return.
 */
export async function notifyReassignmentOutcome(args: {
  vehicleId: string;
  actorUserId: string;
  summary: ReassignSummary;
  /** Human-readable cause, e.g. "STOLEN" or "WRITTEN_OFF". */
  reasonLabel: string;
  prisma?: typeof defaultPrisma;
}): Promise<void> {
  const { vehicleId, actorUserId, summary, reasonLabel } = args;
  const prisma = args.prisma ?? defaultPrisma;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, internalCode: true, depotId: true },
  });
  if (!vehicle) {
    logger.warn({ vehicleId }, "notifyReassignmentOutcome: vehicle not found");
    return;
  }

  const affectedIds = [
    ...summary.reassigned.map((r) => r.bookingId),
    ...summary.needsManual.map((r) => r.bookingId),
    ...summary.quotesUnassigned.map((r) => r.bookingId),
  ];
  const bookings = affectedIds.length
    ? await prisma.booking.findMany({
        where: { id: { in: affectedIds } },
        select: {
          id: true,
          bookingReference: true,
          pickupDateTime: true,
          returnDateTime: true,
          customer: { select: { id: true, firstName: true } },
        },
      })
    : [];
  const byId = new Map(bookings.map((b) => [b.id, b]));

  // 1. The freed/blocked span is stale in the availability cache — drop it
  //    so the public wizard stops offering the removed vehicle's capacity.
  try {
    const now = new Date();
    const latestReturn = bookings.reduce(
      (max, b) => (b.returnDateTime > max ? b.returnDateTime : max),
      now,
    );
    await invalidateAvailability(vehicle.depotId, now, latestReturn);
  } catch (err) {
    logger.warn(
      { vehicleId, err: err instanceof Error ? err.message : String(err) },
      "notifyReassignmentOutcome: availability invalidation failed (TTL covers it)",
    );
  }

  // 2. Customer email per auto-reassigned booking — same category, same
  //    price, same dates; just a like-for-like vehicle change.
  let siteName = "our";
  try {
    siteName = (await getBranding()).siteName;
  } catch {
    // branding lookup is cosmetic here — fall through with the placeholder
  }
  for (const r of summary.reassigned) {
    const b = byId.get(r.bookingId);
    if (!b) continue;
    try {
      const html = await render(
        createElement(VehicleReassigned, {
          customerName: b.customer.firstName,
          bookingReference: b.bookingReference,
        }),
      );
      await sendNotification({
        userId: b.customer.id,
        type: "BOOKING_MODIFIED",
        channels: ["EMAIL"],
        subject: `Vehicle updated on booking ${b.bookingReference}`,
        title: "Your vehicle has been updated",
        body: [
          `Hi ${b.customer.firstName},`,
          "",
          `The vehicle assigned to your ${siteName} booking ${b.bookingReference} has been updated to another vehicle in the same category.`,
          "Nothing else changes — your dates, pickup location and price stay exactly the same.",
        ].join("\n"),
        html,
        bookingId: b.id,
        data: { vehicleId, reason: reasonLabel },
        sentById: actorUserId,
        dedupKey: `vehicle-reassigned:${b.id}:${r.newVehicleId}`,
      });
    } catch (err) {
      logger.warn(
        { bookingId: r.bookingId, err: err instanceof Error ? err.message : String(err) },
        "notifyReassignmentOutcome: customer email failed",
      );
    }
  }

  // 3. One digest to the depot's managers for the bookings that need a
  //    human decision. Mirrors booking-swap's depot-manager broadcast:
  //    managers pinned to this depot plus depot-less (org-wide) managers.
  if (summary.needsManual.length > 0) {
    try {
      const managers = await prisma.user.findMany({
        where: {
          role: { in: ["MANAGER", "ADMIN"] },
          deletedAt: null,
          OR: [{ depotId: vehicle.depotId }, { depotId: null }],
        },
        select: { id: true },
      });
      const lines = summary.needsManual.map((m) => {
        const b = byId.get(m.bookingId);
        return b
          ? `• ${m.reference} — pickup ${b.pickupDateTime.toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })}`
          : `• ${m.reference}`;
      });
      const subject = `Vehicle ${vehicle.internalCode} removed (${reasonLabel}) — ${summary.needsManual.length} booking${summary.needsManual.length === 1 ? "" : "s"} need manual reassignment`;
      for (const m of managers) {
        await sendNotification({
          userId: m.id,
          type: "LOW_FLEET_AVAILABILITY",
          category: "OPERATIONAL",
          channels: ["IN_APP", "EMAIL"],
          subject,
          title: subject,
          body: [
            `Vehicle ${vehicle.internalCode} was removed from service (${reasonLabel}). No compatible replacement could be auto-assigned for:`,
            "",
            ...lines,
            "",
            "Contact each customer to offer an upgrade (Change category on the booking page — goodwill free upgrade available to managers), a different depot, or a refund.",
          ].join("\n"),
          data: {
            vehicleId,
            reason: reasonLabel,
            bookingIds: summary.needsManual.map((x) => x.bookingId),
            references: summary.needsManual.map((x) => x.reference),
          },
          sentById: actorUserId,
          dedupKey: `vehicle-reassign-manual:${vehicleId}:${m.id}`,
        });
      }
    } catch (err) {
      logger.warn(
        { vehicleId, err: err instanceof Error ? err.message : String(err) },
        "notifyReassignmentOutcome: manager digest failed",
      );
    }
  }
}
