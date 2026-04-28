import { createElement } from "react";
import { render } from "@react-email/render";
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { CANCELLATION_POLICY } from "@/lib/constants";
import { getSettings } from "@/lib/settings";
import { cancelPaymentIntent, refundCharge } from "@/lib/stripe";
import { sendNotification } from "@/server/services/notification-sender";
import { invalidateRevenueCaches } from "@/server/services/revenue-aggregator";
import { supersedeByTarget } from "@/server/services/staff-tasks";
import { writeAudit } from "@/server/services/audit";
import { logger } from "@/lib/logger";
import { getBranding } from "@/lib/branding";
import { formatCurrency } from "@/lib/utils";
import BookingCancelled from "../../../emails/booking-cancelled";

/**
 * Shared booking-cancellation service. Staff, customer, and
 * system-driven cancel paths converge here so there is one source of
 * truth for the refund maths, bond release, Stripe refund, status
 * transitions, audit trail, and customer email.
 *
 * Rule sources — CLAUDE.md §CRITICAL BUSINESS RULES:
 *  - 5 (cancellation policy): >72h full refund less admin fee, 24–72h 50%
 *    less admin fee, <24h no refund.
 *  - Bond: released on cancel if still HELD; partially captured bonds only
 *    release the remainder.
 */

export type CancellationSource = "CUSTOMER" | "STAFF" | "SYSTEM";

export type CancellationPolicy = {
  fullRefundHours: number;
  halfRefundHours: number;
  adminFee: number;
};

export type CancellationIneligibleReason =
  | "ALREADY_CANCELLED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "DISPUTED"
  | "EXTENSION_CHILD"
  | "SUBSCRIPTION_PARENT";

const INELIGIBLE_REASON_MESSAGES: Record<CancellationIneligibleReason, string> = {
  ALREADY_CANCELLED:
    "This booking has already been cancelled — no further action is needed.",
  IN_PROGRESS:
    "The customer has already collected the vehicle, so the booking can't be cancelled. Use Check-in / Return to close it out instead, and apply any refund through the return workflow.",
  COMPLETED:
    "This booking is already completed. Issue a refund or credit note from the booking detail page instead of cancelling.",
  DISPUTED:
    "This booking is in dispute. Resolve the dispute before cancelling so the refund decision is recorded against the disputed payment.",
  EXTENSION_CHILD:
    "This is an extension attached to a parent booking. Cancel or shorten the parent booking instead — the extension will follow.",
  SUBSCRIPTION_PARENT:
    "This booking is part of an active subscription. End the subscription from the customer's profile and the upcoming bookings will cancel automatically.",
};

export type QuoteCancellationResult = {
  eligible: boolean;
  ineligibleReason?: CancellationIneligibleReason;
  refundTier: "FULL" | "HALF" | "NONE";
  refundPct: number;
  refundAmount: number;
  adminFee: number;
  bondReleaseAmount: number;
  hoursUntilPickup: number;
  amountPaid: number;
  policy: CancellationPolicy;
};

export type CancelResult = {
  bookingId: string;
  refundAmount: number;
  refundPct: number;
  refundStatus: "SUCCEEDED" | "FAILED" | "PENDING" | "NOT_APPLICABLE";
  bondReleasedAmount: number;
  cascadedBookingIds: string[];
};

type Db = PrismaClient | Prisma.TransactionClient;

async function readPolicy(): Promise<CancellationPolicy> {
  const overrides = await getSettings([
    "cancellation.fullRefundHours",
    "cancellation.halfRefundHours",
    "cancellation.adminFee",
  ] as const);
  return {
    fullRefundHours:
      overrides["cancellation.fullRefundHours"] ?? CANCELLATION_POLICY.fullRefundHours,
    halfRefundHours:
      overrides["cancellation.halfRefundHours"] ?? CANCELLATION_POLICY.halfRefundHours,
    adminFee: overrides["cancellation.adminFee"] ?? CANCELLATION_POLICY.adminFee,
  };
}

function computeRefund(args: {
  amountPaid: number;
  pickupDateTime: Date;
  policy: CancellationPolicy;
  now?: Date;
}): { refundPct: number; refundAmount: number; adminFeeCharged: number; hoursUntilPickup: number } {
  const now = args.now ?? new Date();
  const hoursUntilPickup =
    (args.pickupDateTime.getTime() - now.getTime()) / 3_600_000;
  let refundPct = 0;
  if (hoursUntilPickup > args.policy.fullRefundHours) refundPct = 1;
  else if (hoursUntilPickup > args.policy.halfRefundHours) refundPct = 0.5;
  if (refundPct === 0) {
    return { refundPct: 0, refundAmount: 0, adminFeeCharged: 0, hoursUntilPickup };
  }
  const gross = args.amountPaid * refundPct;
  const adminFeeCharged = Math.min(gross, args.policy.adminFee);
  const refundAmount = Math.max(0, +(gross - adminFeeCharged).toFixed(2));
  return { refundPct, refundAmount, adminFeeCharged, hoursUntilPickup };
}

function evaluateEligibility(
  booking: { status: string; subscriptionId: string | null; extensionOfId: string | null },
  source: CancellationSource,
): { eligible: true } | { eligible: false; reason: CancellationIneligibleReason } {
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
    return { eligible: false, reason: "ALREADY_CANCELLED" };
  }
  if (booking.status === "DISPUTED") {
    return { eligible: false, reason: "DISPUTED" };
  }
  if (
    ["CHECKED_OUT", "ACTIVE", "OVERDUE", "RETURNED"].includes(booking.status)
  ) {
    return { eligible: false, reason: "IN_PROGRESS" };
  }
  if (booking.status === "COMPLETED") {
    return { eligible: false, reason: "COMPLETED" };
  }
  if (booking.extensionOfId) {
    return { eligible: false, reason: "EXTENSION_CHILD" };
  }
  if (source === "CUSTOMER" && booking.subscriptionId) {
    return { eligible: false, reason: "SUBSCRIPTION_PARENT" };
  }
  return { eligible: true };
}

export async function quoteCancellation(
  bookingId: string,
  db: Db = defaultPrisma,
): Promise<QuoteCancellationResult> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      status: true,
      pickupDateTime: true,
      amountPaid: true,
      subscriptionId: true,
      extensionOfId: true,
      bondLedger: { select: { status: true, heldAmount: true, capturedAmount: true } },
    },
  });
  const policy = await readPolicy();
  const amountPaid = Number(booking.amountPaid);
  const { refundPct, refundAmount, adminFeeCharged, hoursUntilPickup } = computeRefund({
    amountPaid,
    pickupDateTime: booking.pickupDateTime,
    policy,
  });
  const bondReleaseAmount =
    booking.bondLedger && booking.bondLedger.status === "HELD"
      ? Math.max(
          0,
          Number(booking.bondLedger.heldAmount) -
            Number(booking.bondLedger.capturedAmount),
        )
      : 0;
  // Evaluate eligibility from the customer-facing perspective by default;
  // staff/system callers also see the same result and can choose to ignore
  // SUBSCRIPTION_PARENT, but customers must not.
  const eligibility = evaluateEligibility(
    { status: booking.status, subscriptionId: booking.subscriptionId, extensionOfId: booking.extensionOfId },
    "CUSTOMER",
  );
  return {
    eligible: eligibility.eligible,
    ineligibleReason: eligibility.eligible ? undefined : eligibility.reason,
    refundTier: refundPct === 1 ? "FULL" : refundPct === 0.5 ? "HALF" : "NONE",
    refundPct,
    refundAmount,
    adminFee: adminFeeCharged,
    bondReleaseAmount,
    hoursUntilPickup,
    amountPaid,
    policy,
  };
}

async function sendCancellationEmail(args: {
  customerId: string;
  customerFirstName: string;
  bookingId: string;
  bookingReference: string;
  refundAmount: number;
  refundPct: number;
  adminFee: number;
  bondReleasedAmount: number;
  reason: string;
  source: CancellationSource;
  actorUserId: string;
}): Promise<void> {
  const { siteName } = await getBranding();
  const html = await render(
    createElement(BookingCancelled, {
      customerName: args.customerFirstName,
      bookingReference: args.bookingReference,
      refundAmount: args.refundAmount > 0 ? formatCurrency(args.refundAmount) : null,
      refundPct: Math.round(args.refundPct * 100),
      adminFee: args.adminFee > 0 ? formatCurrency(args.adminFee) : null,
      bondReleasedAmount:
        args.bondReleasedAmount > 0 ? formatCurrency(args.bondReleasedAmount) : null,
      reason: args.reason,
      cancelledBy: args.source === "CUSTOMER" ? "you" : "our team",
    }),
  );
  const bodyLines = [
    `Hi ${args.customerFirstName},`,
    "",
    `Your ${siteName} booking ${args.bookingReference} has been cancelled.`,
    args.refundAmount > 0
      ? `Refund: ${formatCurrency(args.refundAmount)} (${Math.round(
          args.refundPct * 100,
        )}% less ${formatCurrency(args.adminFee)} admin fee). Funds return to your card within 5–10 business days.`
      : "No refund applies — cancellation was inside the no-refund window.",
    args.bondReleasedAmount > 0
      ? `Your bond hold of ${formatCurrency(args.bondReleasedAmount)} has been released.`
      : "",
    "",
    `Reason on file: ${args.reason}`,
  ].filter((line) => line !== "");
  await sendNotification({
    userId: args.customerId,
    type: "BOOKING_CANCELLED",
    channels: ["EMAIL"],
    subject: `Booking cancelled — ${args.bookingReference}`,
    title: "Booking cancelled",
    body: bodyLines.join("\n"),
    html,
    bookingId: args.bookingId,
    data: {
      bookingReference: args.bookingReference,
      refundAmount: args.refundAmount,
      refundPct: args.refundPct,
      bondReleasedAmount: args.bondReleasedAmount,
      reason: args.reason,
      source: args.source,
    },
    sentById: args.actorUserId,
    dedupKey: `booking-cancelled:${args.bookingId}`,
  });
}

export type CancelInput = {
  bookingId: string;
  reason: string;
  source: CancellationSource;
  actorUserId: string;
  allowSubscriptionOverride?: boolean;
};

const CANCELLABLE_STATUSES = ["QUOTE", "PENDING_PAYMENT", "CONFIRMED"] as const;

export async function cancel(
  input: CancelInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<CancelResult> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: input.bookingId },
    include: {
      customer: { select: { id: true, firstName: true } },
      bondLedger: true,
      payments: {
        where: { type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
      },
      extensions: { select: { id: true, status: true } },
    },
  });

  const eligibility = evaluateEligibility(
    { status: booking.status, subscriptionId: booking.subscriptionId, extensionOfId: booking.extensionOfId },
    input.source,
  );
  if (!eligibility.eligible) {
    if (
      eligibility.reason === "SUBSCRIPTION_PARENT" &&
      input.source !== "CUSTOMER" &&
      input.allowSubscriptionOverride
    ) {
      // Staff/system can explicitly override to cancel a subscription
      // parent booking. Subscription teardown itself is handled elsewhere.
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: INELIGIBLE_REASON_MESSAGES[eligibility.reason],
      });
    }
  }

  const policy = await readPolicy();
  const amountPaid = Number(booking.amountPaid);
  const { refundPct, refundAmount, adminFeeCharged } = computeRefund({
    amountPaid,
    pickupDateTime: booking.pickupDateTime,
    policy,
  });

  // Release bond hold BEFORE opening the transaction. Stripe is the source
  // of truth for the authorisation; if the release fails we log and
  // continue (the auth will expire naturally in ~7 days).
  let bondReleasedAmount = 0;
  if (booking.bondLedger && booking.bondLedger.status === "HELD") {
    const remainder = Math.max(
      0,
      Number(booking.bondLedger.heldAmount) -
        Number(booking.bondLedger.capturedAmount),
    );
    if (remainder > 0) {
      try {
        await cancelPaymentIntent(booking.bondLedger.stripePaymentIntentId);
      } catch (err) {
        logger.warn(
          { err, bookingId: booking.id },
          "bond release failed during cancel — Stripe auth will expire naturally",
        );
      }
      bondReleasedAmount = remainder;
    }
  }

  // Stripe refund runs outside the DB transaction so a Stripe failure
  // doesn't roll back the booking status change — the CANCELLED row is
  // the customer-visible truth, the refund row tracks reconciliation.
  let refundStripeId: string | null = null;
  let refundStatus: CancelResult["refundStatus"] = "NOT_APPLICABLE";
  let refundNote = `${Math.round(refundPct * 100)}% refund less admin fee`;
  if (refundAmount > 0) {
    refundStatus = "PENDING";
    const source = booking.payments[0];
    if (!source) {
      refundNote = `${refundNote} — no Stripe charge on file; manual refund required`;
    } else {
      try {
        const res = await refundCharge({
          paymentIntentId: source.stripePaymentIntentId,
          chargeId: source.stripeChargeId,
          amountCents: Math.round(refundAmount * 100),
          reason: "requested_by_customer",
          metadata: {
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            cancellationSource: input.source,
          },
          idempotencyKey: `refund-${booking.id}-${source.id}`,
        });
        refundStripeId = res.id;
        refundStatus = res.status === "succeeded" ? "SUCCEEDED" : "PENDING";
      } catch (err) {
        refundStatus = "FAILED";
        refundNote = `${refundNote} — Stripe refund failed: ${
          err instanceof Error ? err.message : "unknown"
        }`;
        logger.error(
          { err, bookingId: booking.id, refundAmount },
          "Stripe refund failed during cancel",
        );
      }
    }
  }

  const sourceTag = input.source === "CUSTOMER" ? "[customer]" : input.source === "STAFF" ? "[staff]" : "[system]";
  const reasonOnLog = `${sourceTag} ${input.reason}`;

  const cascadedBookingIds: string[] = [];

  const cancelTx = async (tx: Prisma.TransactionClient) => {
    // Compare-and-set on status — double-submit race / webhook collision
    // protection. If another path already moved the booking out of a
    // cancellable state we bail out cleanly.
    const allowedStatuses = [...CANCELLABLE_STATUSES];
    const updateResult = await tx.booking.updateMany({
      where: {
        id: booking.id,
        status: { in: allowedStatuses },
      },
      data: {
        status: "CANCELLED",
        cancellationReason: input.reason,
        cancelledById: input.actorUserId,
        // Zero the balance: any kept admin fee is fully covered by the
        // prior payment, and either the refund has been issued or we're
        // inside the no-refund window. Either way the customer owes
        // nothing further.
        balanceDue: 0,
      },
    });
    if (updateResult.count === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Booking is no longer in a cancellable state",
      });
    }
    const plan = await tx.bookingBillingPlan.findUnique({
      where: { bookingId: booking.id },
      select: { status: true },
    });
    if (plan && plan.status !== "CANCELLED" && plan.status !== "COMPLETED") {
      await tx.bookingBillingPlan.update({
        where: { bookingId: booking.id },
        data: {
          status: "CANCELLED",
          cancelReason: `Booking cancelled: ${input.reason}`,
        },
      });
    }
    await tx.bookingStatusLog.create({
      data: {
        bookingId: booking.id,
        previousStatus: booking.status,
        newStatus: "CANCELLED",
        changedById: input.actorUserId,
        reason: reasonOnLog,
      },
    });
    if (refundAmount > 0) {
      await tx.payment.create({
        data: {
          reference: `REF-${Date.now()}`,
          bookingId: booking.id,
          customerId: booking.customerId,
          type: "REFUND",
          method: "STRIPE",
          amount: refundAmount,
          status:
            refundStatus === "NOT_APPLICABLE" ? "PENDING" : refundStatus,
          stripeChargeId: refundStripeId,
          processedAt: refundStatus === "SUCCEEDED" ? new Date() : null,
          processedById: input.actorUserId,
          notes: refundNote,
        },
      });
    }
    if (booking.bondLedger && booking.bondLedger.status === "HELD" && bondReleasedAmount > 0) {
      await tx.bondLedger.update({
        where: { bookingId: booking.id },
        data: {
          status: "RELEASED",
          releasedAmount: bondReleasedAmount,
        },
      });
      await tx.payment.create({
        data: {
          reference: `BOND-REL-${booking.bookingReference}`,
          bookingId: booking.id,
          customerId: booking.customerId,
          type: "BOND_RELEASE",
          method: "STRIPE",
          amount: bondReleasedAmount,
          status: "SUCCEEDED",
          notes: "Bond released on cancellation",
        },
      });
    }
    // Cascade-cancel non-terminal extension children. The parent refund
    // covers the whole amount; children don't generate their own refund.
    for (const child of booking.extensions) {
      if (
        child.status === "CANCELLED" ||
        child.status === "COMPLETED" ||
        child.status === "NO_SHOW"
      )
        continue;
      await tx.booking.update({
        where: { id: child.id },
        data: {
          status: "CANCELLED",
          cancellationReason: `Parent booking cancelled`,
          cancelledById: input.actorUserId,
          statusLog: {
            create: {
              previousStatus: child.status,
              newStatus: "CANCELLED",
              changedById: input.actorUserId,
              reason: `${sourceTag} parent ${booking.bookingReference} cancelled`,
            },
          },
        },
      });
      cascadedBookingIds.push(child.id);
    }
    await supersedeByTarget(tx, "Booking", booking.id, `Booking cancelled: ${input.reason}`);
  };

  await prisma.$transaction(cancelTx);

  if (booking.vehicleId) {
    await prisma.vehicle.update({
      where: { id: booking.vehicleId },
      data: { status: "AVAILABLE" },
    });
  }

  await writeAudit(prisma, {
    userId: input.actorUserId,
    action: "BOOKING_CANCELLED",
    entity: "Booking",
    entityId: booking.id,
    previousData: { status: booking.status },
    newData: {
      status: "CANCELLED",
      source: input.source,
      reason: input.reason,
      refundAmount,
      refundPct,
      refundStatus,
      bondReleasedAmount,
      cascadedBookingIds,
    },
  });

  // Issue an ATO §29-75 adjustment note for the cancellation refund
  // (DECREASE) so the audit trail and the customer's documents page
  // reflect the consideration change against the original tax invoice.
  if (refundAmount > 0) {
    try {
      const { tryIssueAdjustmentForBooking } = await import(
        "@/server/services/invoice-lifecycle"
      );
      const refundPayment = await prisma.payment.findFirst({
        where: { bookingId: booking.id, type: "REFUND" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const pctLabel = Math.round(refundPct * 100);
      await tryIssueAdjustmentForBooking({
        bookingId: booking.id,
        type: "DECREASE",
        reason: "CANCELLATION",
        description: `Cancellation refund (${pctLabel}% of paid amount)`,
        lineItems: [
          {
            description: `Refund — booking cancelled`,
            detail: input.reason,
            quantity: 1,
            unitPrice: refundAmount,
            totalPrice: refundAmount,
            gstIncluded: true,
          },
        ],
        paymentId: refundPayment?.id ?? null,
        issuedById: input.actorUserId,
      });
    } catch {
      // tryIssueAdjustmentForBooking already logs.
    }
  }

  await sendCancellationEmail({
    customerId: booking.customerId,
    customerFirstName: booking.customer.firstName,
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    refundAmount,
    refundPct,
    adminFee: adminFeeCharged,
    bondReleasedAmount,
    reason: input.reason,
    source: input.source,
    actorUserId: input.actorUserId,
  });

  await invalidateRevenueCaches(booking.depotId);

  return {
    bookingId: booking.id,
    refundAmount,
    refundPct,
    refundStatus,
    bondReleasedAmount,
    cascadedBookingIds,
  };
}
