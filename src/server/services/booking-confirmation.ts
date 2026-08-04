import type { Booking, PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { render as renderEmail } from "@react-email/render";
import {
  acquireAllocationLock,
  allocateVehicle,
  isVehicleFree,
} from "@/server/services/availability";
import { retrievePaymentIntent } from "@/lib/stripe";
import { sendNotification } from "@/server/services/notification-sender";
import { writeAudit, writeCustomerAuditAsync } from "@/server/services/audit";
import { trackServer } from "@/lib/analytics";
import { gstFromInclusive } from "@/lib/money";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { getBranding } from "@/lib/branding";
import { logger } from "@/lib/logger";

/**
 * Confirm-payment outcomes that callers translate into their own error
 * surface (TRPCError for the router, log-and-skip for the webhook / TTL
 * sweep).
 */
export class PaymentNotSucceededError extends Error {
  constructor(public readonly piStatus: string) {
    super(`Payment has not completed (status: ${piStatus}). Please retry the payment.`);
    this.name = "PaymentNotSucceededError";
  }
}

export class BondNotHeldError extends Error {
  constructor(public readonly piStatus: string) {
    super(`Bond authorisation not held (status: ${piStatus}). Please retry the payment.`);
    this.name = "BondNotHeldError";
  }
}

/**
 * The PaymentIntent id could not be retrieved from Stripe — an invalid or
 * forged reference (Stripe `resource_missing`). Distinct from
 * PaymentNotSucceededError (the PI exists but isn't `succeeded`). Callers map
 * this to a 400 so a bad/forged id surfaces as a clean client error rather
 * than a 500 (R2-L9).
 */
export class PaymentIntentInvalidError extends Error {
  constructor(public readonly paymentIntentId: string) {
    super("The payment reference is invalid. Please retry the payment.");
    this.name = "PaymentIntentInvalidError";
  }
}

/** A Stripe `StripeInvalidRequestError` means the id was malformed or doesn't
 *  exist (a client/forged error) — not an outage. Outages (connection, auth,
 *  rate-limit) keep their original error so they remain a retryable 500. */
function isInvalidStripeRequest(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { type?: string }).type === "StripeInvalidRequestError"
  );
}

/** Retrieve a PaymentIntent, converting a forged/invalid id into a typed
 *  client error instead of letting the raw Stripe throw become a 500. */
async function retrievePaymentIntentOrThrow(paymentIntentId: string) {
  try {
    return await retrievePaymentIntent(paymentIntentId);
  } catch (err) {
    if (isInvalidStripeRequest(err)) {
      throw new PaymentIntentInvalidError(paymentIntentId);
    }
    throw err;
  }
}

/** Booking is in a state that can never be confirmed (e.g. CANCELLED). */
export class BookingNotConfirmableError extends Error {
  constructor(public readonly bookingStatus: string) {
    super(`Booking cannot be confirmed from status ${bookingStatus}.`);
    this.name = "BookingNotConfirmableError";
  }
}

/** Statuses at or past CONFIRMED — a confirm call on these is a no-op. */
const CONFIRMED_OR_BEYOND = new Set([
  "CONFIRMED",
  "CHECKED_OUT",
  "ACTIVE",
  "OVERDUE",
  "RETURNED",
  "COMPLETED",
]);

export type ConfirmBookingPaymentArgs = {
  bookingId: string;
  paymentIntentId?: string | null;
  bondPaymentIntentId?: string | null;
  preferredVehicleId?: string | null;
  /** Who triggered the confirmation. Falls back to the booking's customer
   *  for system paths (Stripe webhook, TTL sweep). */
  actorUserId?: string | null;
  /** Recorded on the audit trail so finance can tell a checkout confirm
   *  from a webhook/sweep rescue. */
  source: "checkout" | "stripe-webhook" | "ttl-sweep";
  reqId?: string;
};

export type ConfirmBookingPaymentResult = {
  booking: Booking;
  /** True when the booking was already CONFIRMED (or beyond) — the call
   *  was an idempotent retry and no side effects were re-run. */
  alreadyConfirmed: boolean;
};

/**
 * C1: the single confirm-and-allocate path for a paid booking. Callable
 * from the checkout mutation (`booking.confirmPayment`), the Stripe
 * `payment_intent.succeeded` webhook (rescues bookings whose browser died
 * after the charge), and the pending-payment TTL sweep (nightly heal).
 *
 * Idempotent: a booking already at CONFIRMED-or-beyond returns
 * `alreadyConfirmed: true` without re-running allocation, payments, or
 * notifications. Concurrent calls serialise on the per-(depot, category)
 * allocation advisory lock and the second caller sees the flipped status
 * inside its own transaction.
 */
export async function confirmBookingPayment(
  prisma: PrismaClient,
  args: ConfirmBookingPaymentArgs,
): Promise<ConfirmBookingPaymentResult> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: args.bookingId },
    include: {
      category: true,
      pickupDepot: true,
      customer: { select: { firstName: true } },
    },
  });
  const actorId = args.actorUserId ?? booking.customerId;

  // Fast idempotency path — retries (client "Try again", webhook
  // redelivery, TTL sweep after the webhook already healed) land here.
  if (CONFIRMED_OR_BEYOND.has(booking.status)) {
    return { booking, alreadyConfirmed: true };
  }
  if (booking.status !== "PENDING_PAYMENT") {
    throw new BookingNotConfirmableError(booking.status);
  }

  // Server-side verification. We never trust the caller — the supplied PI
  // must be THE PI created for this booking (identity via the persisted id,
  // with a metadata.bookingId fallback for bookings created before the ids
  // were persisted), must have actually succeeded, and must have captured at
  // least the booking's payOnlineAmount. Without the amount/identity checks
  // a $1 PI — or another booking's succeeded PI — would confirm this booking
  // and allocate a vehicle. For stub-mode PIs (no real Stripe)
  // retrievePaymentIntent returns null and we skip the checks so local dev
  // still works.
  let depositPaymentMethodId: string | null = null;
  if (args.paymentIntentId) {
    if (
      booking.stripePaymentIntentId &&
      args.paymentIntentId !== booking.stripePaymentIntentId
    ) {
      logger.warn(
        {
          bookingId: booking.id,
          supplied: args.paymentIntentId,
          expected: booking.stripePaymentIntentId,
          source: args.source,
        },
        "booking.confirm: supplied PaymentIntent is not the booking's deposit PI",
      );
      throw new PaymentIntentInvalidError(args.paymentIntentId);
    }
    const pi = await retrievePaymentIntentOrThrow(args.paymentIntentId);
    if (pi) {
      if (pi.status !== "succeeded") {
        throw new PaymentNotSucceededError(pi.status);
      }
      if (!booking.stripePaymentIntentId && pi.metadata?.bookingId !== booking.id) {
        logger.warn(
          { bookingId: booking.id, supplied: args.paymentIntentId, piBookingId: pi.metadata?.bookingId },
          "booking.confirm: PaymentIntent metadata names a different booking",
        );
        throw new PaymentIntentInvalidError(args.paymentIntentId);
      }
      const expectedCents = Math.round(Number(booking.payOnlineAmount) * 100);
      if (pi.amountReceivedCents < expectedCents) {
        logger.warn(
          {
            bookingId: booking.id,
            supplied: args.paymentIntentId,
            receivedCents: pi.amountReceivedCents,
            expectedCents,
          },
          "booking.confirm: PaymentIntent captured less than the booking's online amount",
        );
        throw new PaymentIntentInvalidError(args.paymentIntentId);
      }
      // The verified deposit PI carries the card the customer just paid
      // with (attached via setup_future_usage) — remember it so the
      // customer's default PM can be persisted after the confirm commits.
      depositPaymentMethodId = pi.paymentMethodId;
    }
  }
  if (args.bondPaymentIntentId) {
    if (
      booking.bondPaymentIntentId &&
      args.bondPaymentIntentId !== booking.bondPaymentIntentId
    ) {
      logger.warn(
        {
          bookingId: booking.id,
          supplied: args.bondPaymentIntentId,
          expected: booking.bondPaymentIntentId,
          source: args.source,
        },
        "booking.confirm: supplied bond PaymentIntent is not the booking's bond hold",
      );
      throw new PaymentIntentInvalidError(args.bondPaymentIntentId);
    }
    const bondPi = await retrievePaymentIntentOrThrow(args.bondPaymentIntentId);
    if (bondPi) {
      if (bondPi.status !== "requires_capture") {
        throw new BondNotHeldError(bondPi.status);
      }
      if (!booking.bondPaymentIntentId && bondPi.metadata?.bookingId !== booking.id) {
        throw new PaymentIntentInvalidError(args.bondPaymentIntentId);
      }
      const expectedBondCents = Math.round(Number(booking.bondAmount) * 100);
      if (bondPi.amountCents < expectedBondCents) {
        logger.warn(
          {
            bookingId: booking.id,
            supplied: args.bondPaymentIntentId,
            authorizedCents: bondPi.amountCents,
            expectedCents: expectedBondCents,
          },
          "booking.confirm: bond authorisation is under the booking's bond amount",
        );
        throw new PaymentIntentInvalidError(args.bondPaymentIntentId);
      }
    }
  }

  // A1-a: allocate + confirm inside a single transaction under an
  // advisory lock so concurrent confirmPayment calls for the same
  // depot+category can't both grab the same vehicle. A1-b: exclusion
  // constraint catches the truly pathological case where the lock
  // isn't effective (separate processes on a replica).
  let assignedVehicleId: string | null = null;
  const txResult = await prisma.$transaction(async (tx) => {
    await acquireAllocationLock(tx, booking.pickupDepotId, booking.categoryId);

    // Re-read under the lock: a concurrent confirm (checkout mutation vs
    // webhook racing each other) may have flipped the status while we
    // waited. Treat that as the idempotent no-op path.
    const current = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { status: true },
    });
    if (CONFIRMED_OR_BEYOND.has(current.status)) {
      return { alreadyConfirmed: true as const, row: null };
    }
    if (current.status !== "PENDING_PAYMENT") {
      throw new BookingNotConfirmableError(current.status);
    }

    if (args.preferredVehicleId) {
      const v = await tx.vehicle.findUnique({
        where: { id: args.preferredVehicleId },
      });
      if (
        v &&
        v.categoryId === booking.categoryId &&
        v.depotId === booking.pickupDepotId &&
        (await isVehicleFree(tx, {
          vehicleId: v.id,
          pickup: booking.pickupDateTime,
          ret: booking.returnDateTime,
        }))
      ) {
        assignedVehicleId = v.id;
      }
    }
    if (!assignedVehicleId) {
      assignedVehicleId = await allocateVehicle(tx, {
        categoryId: booking.categoryId,
        depotId: booking.pickupDepotId,
        pickup: booking.pickupDateTime,
        ret: booking.returnDateTime,
      });
    }

    // Phase A1 — only the online portion is captured up front. The
    // remainder stays on balanceDue and is collected at pickup via
    // the staff console. When payOnlineAmount is zero (ZERO strategy)
    // we skip creating the Payment row entirely.
    const payOnline = Number(booking.payOnlineAmount);
    const totalAmount = Number(booking.totalAmount);
    const remainder = Math.max(0, totalAmount - payOnline);

    // Rescue paths (webhook / TTL sweep) can run after a deposit Payment
    // row already exists — e.g. staff recorded a manual payment against
    // the still-pending booking. In that case the money fields were
    // already maintained by whatever created the row: don't create a
    // duplicate Payment and don't clobber amountPaid/balanceDue.
    const existingDeposit =
      payOnline > 0
        ? await tx.payment.findFirst({
            where: {
              bookingId: booking.id,
              type: "BOOKING_PAYMENT",
              status: "SUCCEEDED",
            },
            select: { id: true },
          })
        : null;

    const row = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        vehicleId: assignedVehicleId,
        ...(existingDeposit
          ? {}
          : { amountPaid: payOnline, balanceDue: remainder }),
        confirmedById: actorId,
        statusLog: {
          create: {
            previousStatus: "PENDING_PAYMENT",
            newStatus: "CONFIRMED",
            changedById: actorId,
          },
        },
        payments:
          payOnline > 0 && !existingDeposit
            ? {
                create: {
                  reference: `PAY-${Date.now()}`,
                  customerId: booking.customerId,
                  type: "BOOKING_PAYMENT",
                  method: "STRIPE",
                  amount: payOnline,
                  // GST portion on the online charge, pro-rata of total.
                  gstAmount:
                    Number(booking.gstAmount) *
                    (totalAmount > 0 ? payOnline / totalAmount : 0),
                  status: "SUCCEEDED",
                  stripePaymentIntentId: args.paymentIntentId ?? undefined,
                  processedAt: new Date(),
                },
              }
            : undefined,
      },
    });

    if (booking.bondAmount && Number(booking.bondAmount) > 0) {
      await tx.bondLedger.upsert({
        where: { bookingId: booking.id },
        update: args.bondPaymentIntentId
          ? { stripePaymentIntentId: args.bondPaymentIntentId, authorizedAt: new Date() }
          : {},
        create: {
          bookingId: booking.id,
          customerId: booking.customerId,
          heldAmount: booking.bondAmount,
          status: "HELD",
          stripePaymentIntentId: args.bondPaymentIntentId ?? undefined,
          // The auth-expiry clock starts at authorisation, not row creation
          // — the rolling re-hold job keys its horizon off this.
          authorizedAt: args.bondPaymentIntentId ? new Date() : undefined,
        },
      });
    }

    // Phase A2 — if the pricing quote flagged this booking as
    // long-term, create the BookingBillingPlan so the hourly
    // booking-billing job can charge the recurring periods. The
    // first period was either fully covered by payOnlineAmount (for
    // FULL/FLAT/PERCENT strategies that meet or exceed it) or still
    // sits on balanceDue (for ZERO). Either way the plan's
    // nextChargeAt fires one period after pickup.
    const snapshot = booking.pricingSnapshot as {
      isLongTerm?: boolean;
      recurringFrequency?: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
      recurringAmount?: number;
      recurringPeriodsTotal?: number;
      gstAmount?: number;
    };
    if (
      snapshot.isLongTerm &&
      snapshot.recurringFrequency &&
      snapshot.recurringPeriodsTotal &&
      snapshot.recurringPeriodsTotal > 0 &&
      snapshot.recurringAmount &&
      snapshot.recurringAmount > 0
    ) {
      const periodDays =
        snapshot.recurringFrequency === "WEEKLY"
          ? 7
          : snapshot.recurringFrequency === "FORTNIGHTLY"
            ? 14
            : 30;
      const nextChargeAt = new Date(
        booking.pickupDateTime.getTime() + periodDays * 24 * 60 * 60 * 1000,
      );
      // Per-period GST is recurringAmount / 11 (GST-inclusive) — via the
      // shared money utility, never an inline divide-by-11.
      const perPeriodGst = gstFromInclusive(snapshot.recurringAmount).toNumber();
      await tx.bookingBillingPlan.upsert({
        where: { bookingId: booking.id },
        update: {},
        create: {
          bookingId: booking.id,
          frequency: snapshot.recurringFrequency,
          amountPerPeriod: snapshot.recurringAmount,
          gstPerPeriod: perPeriodGst,
          periodsTotal: snapshot.recurringPeriodsTotal,
          nextChargeAt,
          status: "ACTIVE",
        },
      });
    }

    return { alreadyConfirmed: false as const, row };
  });

  if (txResult.alreadyConfirmed || !txResult.row) {
    const fresh = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    return { booking: fresh, alreadyConfirmed: true };
  }
  const updated = txResult.row;

  // KEYSTONE for off-session automation: persist the card the customer just
  // paid with as their default PM. The deposit PI attached it to the Stripe
  // Customer (setup_future_usage), but without this DB pointer every
  // downstream auto-charge (recurring periods, late/damage fees, extensions)
  // skips with "no stored PM". Best-effort — never blocks the confirmation.
  if (depositPaymentMethodId) {
    try {
      const { persistDefaultPaymentMethodFromIntent } = await import(
        "@/server/services/stripe-customer"
      );
      await persistDefaultPaymentMethodFromIntent(
        booking.customerId,
        depositPaymentMethodId,
        { prisma },
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
        "booking.confirm: default-PM persistence failed; off-session charges may skip until the customer saves a card",
      );
    }
  }

  // Drop cached availability for the days this booking now blocks so the
  // public wizard stops offering the just-taken capacity ahead of the
  // cache TTL. Best-effort — the exclusion constraint is the backstop.
  try {
    const { invalidateAvailability } = await import("@/server/services/availability-cache");
    await invalidateAvailability(
      booking.pickupDepotId,
      booking.pickupDateTime,
      booking.returnDateTime,
    );
  } catch {
    // non-fatal — TTL expiry covers it
  }

  // Issue the canonical Tax Invoice for the booking. Best-effort —
  // failures here don't roll back the confirmation; the retroactive
  // sweep job picks up bookings without invoices on its next run.
  try {
    const { issueInvoiceForBooking } = await import(
      "@/server/services/invoice-lifecycle"
    );
    await issueInvoiceForBooking({ bookingId: booking.id });
  } catch (err) {
    logger.warn(
      { err, bookingId: booking.id },
      "booking.confirm: tax invoice issuance failed; retry sweep will retry",
    );
  }

  // If the booking generated a SUCCEEDED Payment row up-front (online
  // capture), issue a branded receipt PDF for it now.
  if (Number(booking.payOnlineAmount) > 0) {
    try {
      const { issueReceiptForPayment } = await import(
        "@/server/services/invoice-lifecycle"
      );
      const onlinePayment = await prisma.payment.findFirst({
        where: { bookingId: booking.id, type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      if (onlinePayment) {
        await issueReceiptForPayment({ paymentId: onlinePayment.id });
      }
    } catch (err) {
      logger.warn(
        { err, bookingId: booking.id },
        "booking.confirm: receipt issuance failed; non-blocking",
      );
    }
  }

  // The confirmation email/SMS (render + Resend/Twilio round trips) rides
  // the booking-confirmation-notify queue so checkout responds as soon as
  // the booking is CONFIRMED. Without Redis the enqueue helper runs the
  // same send inline. Dynamic import to avoid a module cycle (the job
  // module imports sendBookingConfirmationNotification from this file).
  const { enqueueBookingConfirmationNotify } = await import(
    "@/server/jobs/booking-confirmation-notify"
  );
  await enqueueBookingConfirmationNotify(booking.id);

  await writeAudit(prisma, {
    userId: actorId,
    action: "BOOKING_CONFIRMED",
    entity: "Booking",
    entityId: booking.id,
    newData: {
      reference: booking.bookingReference,
      total: Number(booking.totalAmount),
      vehicleId: assignedVehicleId,
      source: args.source,
    },
  });
  writeCustomerAuditAsync(prisma, booking.customerId, {
    userId: actorId,
    action: "BOOKING_CONFIRMED",
    reqId: args.reqId,
    newData: {
      bookingId: booking.id,
      reference: booking.bookingReference,
      total: Number(booking.totalAmount),
      vehicleId: assignedVehicleId,
      source: args.source,
    },
  });

  // Lifetime confirmed-or-beyond bookings for this customer, used to
  // refresh the PostHog person profile. Best-effort alongside the event.
  const lifetimeBookings = await prisma.booking.count({
    where: {
      customerId: booking.customerId,
      status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE", "RETURNED", "COMPLETED"] },
    },
  });
  await trackServer({
    event: "booking.confirmed",
    distinctId: booking.customerId,
    properties: {
      bookingId: booking.id,
      reference: booking.bookingReference,
      category: booking.category.slug,
      depotSlug: booking.pickupDepot.slug,
      totalAud: Number(booking.totalAmount),
      durationDays: booking.durationDays,
      hasBond: Number(booking.bondAmount) > 0,
      source: booking.source,
    },
    groups: { depot: booking.pickupDepot.slug },
    set: { lifetimeBookings, depotAffinity: booking.pickupDepot.slug },
  });

  return { booking: updated, alreadyConfirmed: false };
}

/**
 * Builds and sends the booking-confirmation email/SMS, attaching the tax
 * invoice and online-payment receipt issued during confirm. Runs on the
 * `booking-confirmation-notify` queue (or inline when Redis is absent) so
 * the render + Resend/Twilio round trips stay out of the checkout
 * response. The booking is CONFIRMED before this ever runs, so a failure
 * or BullMQ retry here can only affect the notification — never money or
 * allocation state.
 */
export async function sendBookingConfirmationNotification(
  prisma: PrismaClient,
  bookingId: string,
): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      category: true,
      pickupDepot: true,
      customer: { select: { firstName: true } },
    },
  });
  if (!booking) {
    logger.warn({ bookingId }, "confirmation notify: booking not found; skipping");
    return;
  }

  const payOnline = Number(booking.payOnlineAmount);
  const totalAud = Number(booking.totalAmount);
  const remainder = Math.max(0, totalAud - payOnline);
  const bondAud = Number(booking.bondAmount);
  const snap = booking.pricingSnapshot as {
    isLongTerm?: boolean;
    recurringFrequency?: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
    recurringAmount?: number;
    recurringPeriodsTotal?: number;
  };
  const recurringSummary =
    snap.isLongTerm &&
    snap.recurringFrequency &&
    snap.recurringAmount &&
    snap.recurringPeriodsTotal
      ? (() => {
          const freqLower = snap.recurringFrequency!.toLowerCase();
          const periodWord = freqLower.replace(/ly$/, "");
          return `Long-term hire: today's payment covers your first ${periodWord}. Then ${formatCurrency(
            snap.recurringAmount!,
          )} ${freqLower} × ${snap.recurringPeriodsTotal} period(s) is charged automatically to your card on file.`;
        })()
      : null;

  const branding = await getBranding();
  const portalUrl = `${
    process.env.AUTH_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  }/dashboard/bookings/${booking.id}`;
  const depotAddress = [
    booking.pickupDepot.addressLine1,
    booking.pickupDepot.addressLine2,
    `${booking.pickupDepot.suburb} ${booking.pickupDepot.state} ${booking.pickupDepot.postcode}`,
  ]
    .filter(Boolean)
    .join(", ");

  const { default: BookingConfirmationEmail } = await import(
    "../../../emails/booking-confirmation"
  );
  const html = await renderEmail(
    createElement(BookingConfirmationEmail, {
      customerName: booking.customer?.firstName ?? "there",
      bookingReference: booking.bookingReference,
      categoryName: booking.category.name,
      pickupDepotName: booking.pickupDepot.name,
      pickupDepotAddress: depotAddress,
      pickupDateTime: formatDateTime(booking.pickupDateTime),
      returnDateTime: formatDateTime(booking.returnDateTime),
      durationDays: booking.durationDays,
      totalAmount: formatCurrency(totalAud),
      paidOnline: formatCurrency(payOnline),
      dueAtPickup: remainder > 0 ? formatCurrency(remainder) : null,
      bondAmount: bondAud > 0 ? formatCurrency(bondAud) : null,
      recurringSummary,
      portalUrl,
      siteName: branding.siteName,
    }),
  );

  // Find the just-issued tax invoice for the booking so it rides out
  // with the confirmation email. Best-effort — if invoice issuance
  // failed during confirm, there's no row to attach and the resolver
  // drops the entry.
  const issuedInvoice = await prisma.invoice.findFirst({
    where: { bookingId: booking.id, deletedAt: null, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const onlinePayment =
    payOnline > 0
      ? await prisma.payment.findFirst({
          where: { bookingId: booking.id, type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null;

  const attachments: import("@/server/services/notification-sender").AttachmentRef[] = [];
  if (issuedInvoice) attachments.push({ kind: "invoice", invoiceId: issuedInvoice.id });
  if (onlinePayment) attachments.push({ kind: "receipt", paymentId: onlinePayment.id });

  await sendNotification({
    userId: booking.customerId,
    type: "BOOKING_CONFIRMATION",
    channels: ["EMAIL", "SMS"],
    subject: `Booking confirmed — ${booking.bookingReference}`,
    title: `Booking confirmed — ${booking.bookingReference}`,
    body:
      `Your ${branding.siteName} booking ${booking.bookingReference} is confirmed. ` +
      `Pickup ${formatDateTime(booking.pickupDateTime)} at ${booking.pickupDepot.name}. ` +
      `Total ${formatCurrency(totalAud)}` +
      (remainder > 0 ? `, ${formatCurrency(remainder)} due at pickup.` : ".") +
      (bondAud > 0 ? ` Bond hold ${formatCurrency(bondAud)}.` : ""),
    html,
    templateKey: "booking-confirmation",
    bookingId: booking.id,
    attachments,
    data: {
      bookingReference: booking.bookingReference,
      pickupAt: booking.pickupDateTime.toISOString(),
      depotName: booking.pickupDepot.name,
      totalAud,
      payOnlineAud: payOnline,
      remainderAud: remainder,
      bondAud,
    },
  });
}
