import type { PrismaClient } from "@prisma/client";
import {
  quote as quotePricing,
  OneWayDisallowedError,
  MinimumRentalPeriodError,
} from "@/server/services/pricing";
import { isVehicleFree, countAvailable } from "@/server/services/availability";
import { enforceDateTimeWithinDepotHours } from "@/server/services/booking-times-guard";
import { aud, roundCents, gstFromInclusive } from "@/lib/money";
import { writeAudit, writeCustomerAuditAsync } from "@/server/services/audit";
import { sendNotification } from "@/server/services/notification-sender";
import { getBranding } from "@/lib/branding";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/**
 * Customer self-service "change booking" — DATE/TIME ONLY (M-5).
 *
 * Reprices the hire for a new pickup/return window using the SAME category,
 * vehicle, depots, add-ons, insurance and delivery, then settles the delta:
 *   - INCREASE → a PENDING delta Payment captured off-session (the existing
 *     capture-pending-payments job picks up `EXTENSION`-type rows) + an
 *     INCREASE adjustment note; balanceDue goes up.
 *   - DECREASE → a DECREASE adjustment note writes the invoice down; balanceDue
 *     is clamped at 0. Any surplus over what's still owed is RETAINED AS
 *     ACCOUNT CREDIT (the invoice write-down), never auto-refunded to the card.
 *   - NONE → a free date shift (price unchanged); only the dates move.
 *
 * Out of scope (route to staff): category/extras/insurance changes, and any
 * booking that used a discount code (the code isn't stored, only its amount,
 * so it can't be faithfully re-applied to the new dates), is part of a
 * subscription/long-term billing plan, or is itself an extension.
 */
export class BookingChangeNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingChangeNotAllowedError";
  }
}

// Pre-pickup only: a CONFIRMED booking that hasn't been checked out.
const CHANGEABLE_STATUSES = new Set(["CONFIRMED"]);

export type BookingChangeDirection = "INCREASE" | "DECREASE" | "NONE";

export type BookingChangePreview = {
  oldPickupDateTime: Date;
  oldReturnDateTime: Date;
  newPickupDateTime: Date;
  newReturnDateTime: Date;
  oldTotal: number;
  newTotal: number;
  /** newTotal − oldTotal: > 0 charge, < 0 reduction, 0 no price change. */
  delta: number;
  direction: BookingChangeDirection;
  newDurationDays: number;
  /** balanceDue after the change, clamped at 0. */
  newBalanceDue: number;
  /** Surplus retained as account credit when a reduction exceeds the balance. */
  creditAmount: number;
  /** GST portion of |delta| (GST-inclusive). */
  deltaGst: number;
};

type ChangeArgs = {
  bookingId: string;
  newPickupDateTime: Date;
  newReturnDateTime: Date;
};

async function loadBooking(prisma: PrismaClient, bookingId: string) {
  return prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      addons: true,
      insurance: true,
      billingPlan: { select: { id: true } },
      category: { select: { id: true, name: true } },
      customer: { select: { firstName: true } },
    },
  });
}

type LoadedBooking = Awaited<ReturnType<typeof loadBooking>>;

function validateChangeable(booking: LoadedBooking, args: ChangeArgs, now: number): void {
  if (!CHANGEABLE_STATUSES.has(booking.status)) {
    throw new BookingChangeNotAllowedError(
      `A booking in status ${booking.status} can't be changed online — please contact us.`,
    );
  }
  if (booking.extensionOfId || booking.subscriptionId || booking.billingPlan) {
    throw new BookingChangeNotAllowedError(
      "This booking is part of a longer arrangement — please contact us to change the dates.",
    );
  }
  // The discount code isn't stored on the booking (only the resulting amount),
  // so we can't faithfully re-apply it to new dates — route to staff.
  if (Number(booking.discountAmount) > 0) {
    throw new BookingChangeNotAllowedError(
      "This booking has a discount applied — please contact us to change the dates so we can preserve it.",
    );
  }
  if (args.newReturnDateTime.getTime() <= args.newPickupDateTime.getTime()) {
    throw new BookingChangeNotAllowedError("Return must be after pickup.");
  }
  if (args.newPickupDateTime.getTime() < now) {
    throw new BookingChangeNotAllowedError("Pickup can't be in the past.");
  }
  const unchanged =
    args.newPickupDateTime.getTime() === booking.pickupDateTime.getTime() &&
    args.newReturnDateTime.getTime() === booking.returnDateTime.getTime();
  if (unchanged) {
    throw new BookingChangeNotAllowedError("Choose a new pickup or return time first.");
  }
}

/**
 * Validate + re-quote a date/time change without committing. Used by the
 * preview query and as the first half of {@link applyBookingChange}.
 */
export async function previewBookingChange(
  prisma: PrismaClient,
  args: ChangeArgs,
  now: number = Date.now(),
): Promise<{ booking: LoadedBooking; preview: BookingChangePreview }> {
  const booking = await loadBooking(prisma, args.bookingId);
  validateChangeable(booking, args, now);

  // Depot hours for BOTH ends of the new window (a shift can move either).
  await enforceDateTimeWithinDepotHours(
    prisma,
    booking.pickupDepotId,
    args.newPickupDateTime,
    "pickup",
  );
  await enforceDateTimeWithinDepotHours(
    prisma,
    booking.returnDepotId,
    args.newReturnDateTime,
    "return",
  );

  // Availability over the whole new window, excluding this booking.
  if (booking.vehicleId) {
    const free = await isVehicleFree(prisma, {
      vehicleId: booking.vehicleId,
      pickup: args.newPickupDateTime,
      ret: args.newReturnDateTime,
      excludeBookingId: booking.id,
    });
    if (!free) {
      throw new BookingChangeNotAllowedError(
        "Your vehicle isn't available for those dates — pick another time or contact the depot.",
      );
    }
  } else {
    // No excludeBookingId needed: this branch only runs when the booking has
    // no vehicle allocated yet, so it can't appear as a self-conflict (the
    // conflict scan is scoped to bookings with an allocated vehicleId).
    const avail = await countAvailable(prisma, {
      categoryId: booking.categoryId,
      depotId: booking.pickupDepotId,
      pickup: args.newPickupDateTime,
      ret: args.newReturnDateTime,
    });
    if (avail.available <= 0) {
      throw new BookingChangeNotAllowedError("No vehicles available for those dates.");
    }
  }

  // Re-quote the new window with the SAME levers (no discount code — guarded
  // out above, so the re-quote faithfully reproduces the original pricing).
  let newQuote;
  try {
    newQuote = await quotePricing(prisma, {
      categoryId: booking.categoryId,
      vehicleId: booking.vehicleId ?? undefined,
      pickupDateTime: args.newPickupDateTime,
      returnDateTime: args.newReturnDateTime,
      pickupDepotId: booking.pickupDepotId,
      returnDepotId: booking.returnDepotId,
      addons: booking.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
      insuranceOptionId: booking.insurance[0]?.insuranceOptionId ?? undefined,
      deliveryFee: Number(booking.deliveryFee),
    });
  } catch (err) {
    if (err instanceof OneWayDisallowedError || err instanceof MinimumRentalPeriodError) {
      throw new BookingChangeNotAllowedError(err.message);
    }
    throw err;
  }

  const oldTotal = Number(booking.totalAmount);
  const newTotal = newQuote.totalAmount;
  const deltaDec = roundCents(aud(newTotal).minus(aud(oldTotal)));
  const delta = deltaDec.toNumber();
  const direction: BookingChangeDirection =
    delta > 0 ? "INCREASE" : delta < 0 ? "DECREASE" : "NONE";

  const newBalanceRaw = roundCents(aud(Number(booking.balanceDue)).plus(deltaDec)).toNumber();
  const newBalanceDue = Math.max(0, newBalanceRaw);
  const creditAmount =
    newBalanceRaw < 0 ? roundCents(aud(-newBalanceRaw)).toNumber() : 0;
  const deltaGst = roundCents(gstFromInclusive(aud(Math.abs(delta)))).toNumber();

  return {
    booking,
    preview: {
      oldPickupDateTime: booking.pickupDateTime,
      oldReturnDateTime: booking.returnDateTime,
      newPickupDateTime: args.newPickupDateTime,
      newReturnDateTime: args.newReturnDateTime,
      oldTotal,
      newTotal,
      delta,
      direction,
      newDurationDays: newQuote.durationDays,
      newBalanceDue,
      creditAmount,
      deltaGst,
    },
  };
}

/**
 * Commit a date/time change: move the window, reprice, and settle the delta.
 * Returns the updated booking and the applied preview.
 */
export async function applyBookingChange(
  prisma: PrismaClient,
  args: ChangeArgs & { actorUserId: string; reqId?: string },
): Promise<{ booking: LoadedBooking; preview: BookingChangePreview }> {
  const { booking, preview } = await previewBookingChange(prisma, args);

  const reference = `CHG-${Date.now()}`;
  const moneyLine =
    preview.direction === "INCREASE"
      ? `Additional charge ${formatCurrency(preview.delta)} to your card on file.`
      : preview.direction === "DECREASE"
        ? `Your total drops by ${formatCurrency(-preview.delta)}${
            preview.creditAmount > 0
              ? ` (${formatCurrency(preview.creditAmount)} held as account credit)`
              : ""
          }.`
        : "No change to the price.";
  const noteBody =
    `Dates changed: pickup ${formatDateTime(preview.oldPickupDateTime)} → ` +
    `${formatDateTime(preview.newPickupDateTime)}, return ` +
    `${formatDateTime(preview.oldReturnDateTime)} → ${formatDateTime(preview.newReturnDateTime)}. ` +
    moneyLine;

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      pickupDateTime: preview.newPickupDateTime,
      returnDateTime: preview.newReturnDateTime,
      durationDays: preview.newDurationDays,
      totalAmount: preview.newTotal,
      balanceDue: preview.newBalanceDue,
      bookingNotes: {
        create: {
          userId: args.actorUserId,
          note: noteBody,
          isInternal: false,
        },
      },
      statusLog: {
        create: {
          previousStatus: booking.status,
          newStatus: booking.status,
          changedById: args.actorUserId,
          reason: `Date change — delta ${formatCurrency(preview.delta)}`,
        },
      },
      // INCREASE only: raise the extra charge as a PENDING row. The
      // capture-pending-payments job charges the saved card off-session
      // (EXTENSION is in its eligible set). A reduction never creates a
      // Payment — it's settled by the DECREASE adjustment note below.
      ...(preview.direction === "INCREASE"
        ? {
            payments: {
              create: {
                reference,
                customerId: booking.customerId,
                type: "EXTENSION" as const,
                method: "STRIPE" as const,
                amount: preview.delta,
                gstAmount: preview.deltaGst,
                status: "PENDING" as const,
                notes: "Booking date change — additional charge",
              },
            },
          }
        : {}),
    },
    include: {
      addons: true,
      insurance: true,
      billingPlan: { select: { id: true } },
      category: { select: { id: true, name: true } },
      customer: { select: { firstName: true } },
    },
  });

  // ATO §29-75 adjustment note for the delta (skipped for a price-neutral
  // shift). DECREASE writes the invoice down — that write-down IS the retained
  // account credit when the customer had already overpaid.
  if (preview.direction !== "NONE") {
    try {
      const { tryIssueAdjustmentForBooking } = await import(
        "@/server/services/invoice-lifecycle"
      );
      const magnitude = Math.abs(preview.delta);
      let paymentId: string | null = null;
      if (preview.direction === "INCREASE") {
        const chgPayment = await prisma.payment.findFirst({
          where: { bookingId: booking.id, reference },
          select: { id: true },
        });
        paymentId = chgPayment?.id ?? null;
      }
      await tryIssueAdjustmentForBooking({
        bookingId: booking.id,
        type: preview.direction,
        reason: "OTHER",
        description: `Booking date change — ${
          preview.direction === "INCREASE" ? "additional charge" : "reduction"
        } at current rates`,
        lineItems: [
          {
            description: `Date change — new window ${formatDateTime(
              preview.newPickupDateTime,
            )} → ${formatDateTime(preview.newReturnDateTime)}`,
            detail: `${preview.newDurationDays} day(s)`,
            quantity: 1,
            unitPrice: magnitude,
            totalPrice: magnitude,
            gstAmount: preview.deltaGst,
            gstIncluded: true,
          },
        ],
        paymentId,
        issuedById: args.actorUserId,
      });
    } catch {
      // tryIssueAdjustmentForBooking swallows + logs its own failures; this
      // guard only catches the dynamic-import path.
    }
  }

  await writeAudit(prisma, {
    userId: args.actorUserId,
    action: "BOOKING_DATES_CHANGED",
    entity: "Booking",
    entityId: booking.id,
    previousData: {
      pickupDateTime: preview.oldPickupDateTime,
      returnDateTime: preview.oldReturnDateTime,
      durationDays: booking.durationDays,
      totalAmount: preview.oldTotal,
    },
    newData: {
      pickupDateTime: preview.newPickupDateTime,
      returnDateTime: preview.newReturnDateTime,
      durationDays: preview.newDurationDays,
      totalAmount: preview.newTotal,
      delta: preview.delta,
      creditAmount: preview.creditAmount,
    },
  });
  writeCustomerAuditAsync(prisma, booking.customerId, {
    userId: args.actorUserId,
    action: "BOOKING_DATES_CHANGED",
    reqId: args.reqId,
    previousData: {
      bookingId: booking.id,
      pickupDateTime: preview.oldPickupDateTime,
      returnDateTime: preview.oldReturnDateTime,
    },
    newData: {
      bookingId: booking.id,
      reference: booking.bookingReference,
      pickupDateTime: preview.newPickupDateTime,
      returnDateTime: preview.newReturnDateTime,
      delta: preview.delta,
    },
  });

  const { siteName } = await getBranding();
  await sendNotification({
    userId: booking.customerId,
    type: "BOOKING_MODIFIED",
    channels: ["EMAIL", "SMS"],
    subject: `Booking updated — ${booking.bookingReference}`,
    title: "Booking updated",
    body: `Your ${siteName} booking ${booking.bookingReference} dates were updated.\n\nNew pickup: ${formatDateTime(
      preview.newPickupDateTime,
    )}\nNew return: ${formatDateTime(preview.newReturnDateTime)}\n${moneyLine}`,
    bookingId: booking.id,
    sentById: args.actorUserId,
  });

  return { booking: updated, preview };
}
