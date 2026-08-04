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
import { logger } from "@/lib/logger";
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
 *     is clamped at 0. Any surplus over what's still owed is REFUNDED for
 *     real: gift-card-funded money restores to the gift card, the rest goes
 *     back to the card via Stripe (with the cancellation refund's
 *     failure→retry→alert ladder).
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

/** The booking changed between preview and commit (double-click, second tab,
 *  or a staff edit racing the customer). The caller should re-preview. */
export class BookingChangeConflictError extends Error {
  constructor() {
    super(
      "This booking changed while your update was in flight — please review the new details and try again.",
    );
    this.name = "BookingChangeConflictError";
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
  /** Surplus refunded to the original payment method when a reduction exceeds the balance. */
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

  const moneyLine =
    preview.direction === "INCREASE"
      ? `Additional charge ${formatCurrency(preview.delta)} to your card on file.`
      : preview.direction === "DECREASE"
        ? `Your total drops by ${formatCurrency(-preview.delta)}${
            preview.creditAmount > 0
              ? ` (${formatCurrency(preview.creditAmount)} refunded to your original payment method)`
              : ""
          }.`
        : "No change to the price.";
  const noteBody =
    `Dates changed: pickup ${formatDateTime(preview.oldPickupDateTime)} → ` +
    `${formatDateTime(preview.newPickupDateTime)}, return ` +
    `${formatDateTime(preview.oldReturnDateTime)} → ${formatDateTime(preview.newReturnDateTime)}. ` +
    moneyLine;

  // Commit as a compare-and-swap keyed on the exact state the preview priced:
  // the preview above ran outside any transaction, so a double-clicked
  // submit, a second tab, or a staff edit can land between preview and
  // commit. Without the CAS both submits would each raise a PENDING delta
  // Payment and capture-pending-payments would charge the card twice for one
  // change. The loser matches zero rows and gets a conflict error instead.
  let reference: string | null = null;
  const updated = await prisma.$transaction(async (tx) => {
    const guard = await tx.booking.updateMany({
      where: {
        id: booking.id,
        status: booking.status,
        pickupDateTime: booking.pickupDateTime,
        returnDateTime: booking.returnDateTime,
        totalAmount: booking.totalAmount,
      },
      data: {
        pickupDateTime: preview.newPickupDateTime,
        returnDateTime: preview.newReturnDateTime,
        durationDays: preview.newDurationDays,
        totalAmount: preview.newTotal,
        balanceDue: preview.newBalanceDue,
      },
    });
    if (guard.count === 0) {
      throw new BookingChangeConflictError();
    }

    await tx.bookingNote.create({
      data: {
        bookingId: booking.id,
        userId: args.actorUserId,
        note: noteBody,
        isInternal: false,
      },
    });
    await tx.bookingStatusLog.create({
      data: {
        bookingId: booking.id,
        previousStatus: booking.status,
        newStatus: booking.status,
        changedById: args.actorUserId,
        reason: `Date change — delta ${formatCurrency(preview.delta)}`,
      },
    });

    // INCREASE only: raise the extra charge as a PENDING row. The
    // capture-pending-payments job charges the saved card off-session
    // (EXTENSION is in its eligible set). A reduction never creates a
    // Payment — it's settled by the DECREASE adjustment note below.
    // Deterministic per-booking sequence reference (unique constraint) is a
    // second line of defence behind the CAS: a duplicate that somehow got
    // this far would collide instead of creating a second chargeable row.
    if (preview.direction === "INCREASE") {
      const priorChanges = await tx.payment.count({
        where: { bookingId: booking.id, reference: { startsWith: `CHG-${booking.id}-` } },
      });
      reference = `CHG-${booking.id}-${priorChanges + 1}`;
      await tx.payment.create({
        data: {
          reference,
          customerId: booking.customerId,
          bookingId: booking.id,
          type: "EXTENSION" as const,
          method: "STRIPE" as const,
          amount: preview.delta,
          gstAmount: preview.deltaGst,
          status: "PENDING" as const,
          notes: "Booking date change — additional charge",
        },
      });
    }

    return tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: {
        addons: true,
        insurance: true,
        billingPlan: { select: { id: true } },
        category: { select: { id: true, name: true } },
        customer: { select: { firstName: true } },
      },
    });
  });

  // DECREASE overpayment: the customer already paid more than the re-priced
  // total. This used to be "held as account credit" — a promise with no
  // ledger behind it (never spendable, never refunded; an ACL problem).
  // Refund it for real: gift-card-funded money restores to the gift card,
  // the rest goes back to the card via Stripe, with the same
  // failure→retry→alert ladder the cancellation refund uses.
  if (preview.direction === "DECREASE" && preview.creditAmount > 0) {
    await refundChangeOverpayment(prisma, {
      booking,
      amount: preview.creditAmount,
      actorUserId: args.actorUserId,
    });
  }

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
      if (preview.direction === "INCREASE" && reference) {
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

/**
 * Refund a DECREASE overpayment for real. Split-aware like the cancellation
 * refund: the slice funded by gift cards restores to the card(s) (atomic —
 * a rollback undoes the credit), and only the card-funded slice hits
 * Stripe. A failed card refund is left FAILED with a queued retry and a
 * manager alert — never silently retained.
 */
async function refundChangeOverpayment(
  prisma: PrismaClient,
  args: {
    booking: LoadedBooking;
    amount: number;
    actorUserId: string;
  },
): Promise<void> {
  const { booking } = args;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const seq =
    (await prisma.payment.count({
      where: { bookingId: booking.id, reference: { startsWith: `REF-CHG-${booking.id}-` } },
    })) + 1;

  // Gift-funded slice first (restores to the voucher, not the card).
  const giftAgg = await prisma.payment.aggregate({
    where: { bookingId: booking.id, type: "GIFT_CARD_REDEMPTION", status: "SUCCEEDED" },
    _sum: { amount: true },
  });
  // Redemption rows are stored negative; prior gift restores are CREDIT
  // transactions and already reduce what's restorable inside the helper.
  const giftPaid = Math.abs(Number(giftAgg._sum.amount ?? 0));
  const giftRefund = r2(Math.min(args.amount, giftPaid));
  const cardRefund = r2(args.amount - giftRefund);

  if (giftRefund > 0) {
    const { restoreGiftCardForBooking } = await import("./gift-card");
    await prisma.$transaction(async (tx) => {
      const { restored } = await restoreGiftCardForBooking(tx, {
        bookingId: booking.id,
        amount: giftRefund,
        reason: `Refund — booking ${booking.bookingReference} date-change reduction`,
      });
      await tx.payment.create({
        data: {
          reference: `REF-CHG-GC-${booking.id}-${seq}`,
          bookingId: booking.id,
          customerId: booking.customerId,
          type: "REFUND",
          method: "CARD",
          amount: giftRefund,
          gstAmount: gstFromInclusive(giftRefund),
          status: "SUCCEEDED",
          processedAt: new Date(),
          processedById: args.actorUserId,
          notes:
            restored >= giftRefund
              ? "Date-change reduction restored to gift card"
              : `Date-change reduction restored to gift card (A$${restored.toFixed(2)} of A$${giftRefund.toFixed(2)} — remainder needs manual follow-up)`,
        },
      });
      const fresh = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { amountPaid: true },
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: { amountPaid: Math.max(0, r2(Number(fresh.amountPaid) - giftRefund)) },
      });
    });
  }

  if (cardRefund <= 0) return;
  const source = await prisma.payment.findFirst({
    where: {
      bookingId: booking.id,
      type: "BOOKING_PAYMENT",
      status: "SUCCEEDED",
      stripePaymentIntentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, stripePaymentIntentId: true, stripeChargeId: true },
  });

  const { refundCharge } = await import("@/lib/stripe");
  let refundOk = false;
  let stripeRefundId: string | null = null;
  let failNote = "";
  const idempotencyKey = `refund-chg-${booking.id}-${seq}`;
  if (source) {
    try {
      const res = await refundCharge({
        paymentIntentId: source.stripePaymentIntentId,
        chargeId: source.stripeChargeId,
        amountCents: Math.round(cardRefund * 100),
        reason: "requested_by_customer",
        metadata: { bookingId: booking.id, kind: "date-change-reduction" },
        idempotencyKey,
      });
      stripeRefundId = res.id;
      refundOk = res.status === "succeeded" || res.status === "pending";
    } catch (err) {
      failNote = err instanceof Error ? err.message.slice(0, 160) : "Stripe refund failed";
      logger.error(
        { err: failNote, bookingId: booking.id, cardRefund },
        "date-change reduction refund failed at Stripe",
      );
    }
  } else {
    failNote = "no Stripe charge on file; manual refund required";
  }

  const row = await prisma.payment.create({
    data: {
      reference: `REF-CHG-${booking.id}-${seq}`,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: "REFUND",
      method: "STRIPE",
      amount: cardRefund,
      gstAmount: gstFromInclusive(cardRefund),
      status: refundOk ? "SUCCEEDED" : "FAILED",
      stripeChargeId: stripeRefundId,
      processedAt: refundOk ? new Date() : null,
      processedById: args.actorUserId,
      notes: refundOk
        ? "Date-change reduction refunded to card"
        : `Date-change reduction refund FAILED — ${failNote}`,
    },
  });

  if (refundOk) {
    const fresh = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { amountPaid: true },
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { amountPaid: Math.max(0, r2(Number(fresh.amountPaid) - cardRefund)) },
    });
    return;
  }

  // Same recovery ladder as the cancellation refund: automated retry +
  // manager alert. The retry job decrements amountPaid when it lands.
  if (source) {
    try {
      const { enqueueRefundRetry } = await import("@/server/jobs/refund-retry");
      await enqueueRefundRetry({
        paymentId: row.id,
        paymentIntentId: source.stripePaymentIntentId,
        chargeId: source.stripeChargeId,
        amountCents: Math.round(cardRefund * 100),
        idempotencyKey,
        attempt: 1,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
        "date-change reduction: could not enqueue refund retry",
      );
    }
  }
  try {
    const { prisma: rootPrisma } = await import("@/lib/prisma");
    const managers = await rootPrisma.user.findMany({
      where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
      take: 5,
    });
    for (const m of managers) {
      await sendNotification({
        userId: m.id,
        type: "INCIDENT_REPORTED",
        channels: ["IN_APP", "EMAIL"],
        subject: `Refund FAILED — ${booking.bookingReference}`,
        title: "Date-change reduction refund failed",
        body: `The A$${cardRefund.toFixed(2)} overpayment refund for booking ${booking.bookingReference} failed at Stripe (${failNote}). An automatic retry is queued; if it keeps failing, refund manually from the payment console.`,
        bookingId: booking.id,
        data: { refundPaymentId: row.id, amountAud: cardRefund },
      });
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
      "date-change reduction: manager alert failed",
    );
  }
}
