import { TRPCError } from "@trpc/server";
import type {
  LossTerminationCause,
  PrismaClient,
  TerminationBondDisposition,
  TerminationRefundMode,
} from "@prisma/client";
import { logger } from "@/lib/logger";
import { aud, gstFromInclusive, toNumber } from "@/lib/money";
import { cancelPaymentIntent, refundCharge } from "@/lib/stripe";
import { getBranding } from "@/lib/branding";
import { BALANCE_AFFECTING_CHARGE_TYPES } from "./balance-due";
import { calcEarlyReturnRefund } from "./fees";
import { tryIssueAdjustmentForBooking } from "./invoice-lifecycle";
import {
  recordBookingCompletion,
  invalidateRevenueCaches,
} from "./revenue-aggregator";
import { issueGiftCard, restoreGiftCardForBooking } from "./gift-card";
import { sendNotification } from "./notification-sender";
import { autoCloseByTarget } from "./staff-tasks";
import { writePaymentEvent } from "./payment-events";

/**
 * Mid-hire loss termination (Area 2): ends a hire early because the vehicle
 * was lost in service (written off / stolen / destroyed). The booking lands
 * COMPLETED — the BookingTermination row + status log carry the loss
 * semantics — and the invoice is written down to the consumed portion so
 * revenue/loyalty/commission recognise only what was actually supplied.
 *
 * Money rules honoured here:
 *  - Pro-rata unused value uses the DISCOUNTED EFFECTIVE per-day rate
 *    ((subtotal − discountAmount) / durationDays) plus the booking's per-day
 *    addons and insurance — `calcEarlyReturnRefund` with adminFee 0 and
 *    minUnusedDays 0 so a single unused day still counts.
 *  - The manager chooses `refundMode` per case (REFUND pre-selected for
 *    company-side causes, FORFEIT for STOLEN in the UI); FORFEIT computes
 *    unusedDays but returns/credits nothing and leaves the invoice intact.
 *  - Post-loss PENDING `LATE-<bookingId>-D%` rows are cancelled (FAILED, the
 *    `voidPayment` convention) with a matching balanceDue decrement in the
 *    same tx — the raise/void halves of the balance-due contract stay paired.
 *    `waiveAccruedLateFees` extends the cancellation to pre-loss PENDING late
 *    fees. Late fees ALREADY COLLECTED (SUCCEEDED) are deliberately left
 *    alone and no DECREASE note slice is issued for them — money collected
 *    for genuine pre-loss lateness stays; simpler and defensible.
 *  - The write-down first offsets the unpaid (non-PENDING-backed) balance,
 *    and only the cash surplus is returned, following the
 *    `refundChangeOverpayment` ladder: gift-card-funded money restores to the
 *    funding card(s), the remainder refunds via Stripe (idempotency key
 *    `term-refund-<bookingId>`; failure → FAILED row + queued retry + manager
 *    alert; >180d-old source charge → PENDING MANUAL_CREDIT row). CREDIT mode
 *    issues a fresh ACTIVE gift card for the surplus instead.
 *  - Stripe calls run OUTSIDE the terminal $transaction; the status flip is a
 *    CAS (`updateMany` gated on the terminatable statuses) so a concurrent
 *    check-in conflicts instead of double-settling.
 *  - `recordBookingCompletion` runs in the terminal tx with the POST
 *    write-down totals (settlement before completion so revenue is never
 *    overstated), then `invalidateRevenueCaches` after commit.
 *  - The vehicle itself is NOT touched here — the decommission / theft flows
 *    own the vehicle's disposition status.
 */

export const TERMINATABLE_STATUSES = ["ACTIVE", "CHECKED_OUT", "OVERDUE"] as const;

const r2 = (x: number) => Math.round(x * 100) / 100;

export type PreviewLossTerminationArgs = {
  bookingId: string;
  lossAt?: Date;
  refundMode: TerminationRefundMode;
  waiveAccruedLateFees?: boolean;
};

export type TerminateBookingForLossArgs = PreviewLossTerminationArgs & {
  cause: LossTerminationCause;
  incidentId?: string | null;
  bondDisposition: TerminationBondDisposition;
  notes?: string | null;
  actorId: string;
};

export type LossTerminationQuote = {
  bookingId: string;
  bookingReference: string;
  status: string;
  lossAt: string;
  refundMode: TerminationRefundMode;
  unusedDays: number;
  effectiveDailyRate: number;
  perDayAddonsTotal: number;
  perDayInsuranceRate: number;
  /** Full value of the unused days (base + addons + insurance). */
  grossUnusedValue: number;
  /** Invoice write-down actually applied (0 for FORFEIT). */
  writedownAmount: number;
  /** Slice of the write-down consumed by the unpaid balance. */
  balanceOffset: number;
  /** Cash/credit returned to the customer (gift restore + card refund). */
  cashRefund: number;
  giftRestoreAmount: number;
  cardRefundAmount: number;
  /** PENDING post-loss LATE-…-D% rows that will be cancelled. */
  postLossLateFeeCancel: number;
  /** Additional pre-loss PENDING late fees cancelled when waiving. */
  preLossLateFeeWaive: number;
  /** Already-collected late fees that stay collected. */
  collectedLateFees: number;
  projectedTotalAmount: number;
  projectedBalanceDue: number;
  bondHeldRemaining: number;
};

type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

async function loadBooking(prisma: PrismaClient, bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      addons: { include: { addon: { select: { isPerDay: true } } } },
      insurance: { select: { dailyRate: true } },
      customer: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
      bondLedger: true,
      termination: { select: { id: true } },
    },
  });
}

function assertTerminatable(booking: LoadedBooking): void {
  if (booking.termination) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Booking has already been terminated for loss.",
    });
  }
  if (!(TERMINATABLE_STATUSES as readonly string[]).includes(booking.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot terminate a booking in status ${booking.status} — only an in-flight hire (ACTIVE / CHECKED_OUT / OVERDUE) can be terminated for loss.`,
    });
  }
}

function resolveLossAt(booking: LoadedBooking, lossAt: Date | undefined): Date {
  const at = lossAt ?? new Date();
  if (at.getTime() > Date.now() + 60_000) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Loss time cannot be in the future.",
    });
  }
  const pickupFloor = booking.actualPickupDateTime ?? booking.pickupDateTime;
  if (at.getTime() < pickupFloor.getTime()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Loss time cannot be before the hire started.",
    });
  }
  return at;
}

type LateFeePartition = {
  postLossIds: string[];
  postLossTotal: number;
  preLossIds: string[];
  preLossTotal: number;
  collectedTotal: number;
};

/**
 * Partition the booking's late fees. Auto-cancelled = PENDING overdue-job
 * rows (`LATE-<bookingId>-D<n>`) raised at/after the loss — the customer
 * cannot be charged lateness for days after the vehicle was lost. The waive
 * option extends cancellation to every remaining PENDING late fee.
 * `createdAt` is the day marker: the overdue job raises each day's fee as
 * that late day completes, so rows created after the loss are post-loss days
 * (a fee-day straddling the loss cancels too — generous by at most one day).
 */
async function partitionLateFees(
  db: Pick<PrismaClient, "payment">,
  booking: { id: string },
  lossAt: Date,
): Promise<LateFeePartition> {
  const rows = await db.payment.findMany({
    where: {
      bookingId: booking.id,
      type: "LATE_FEE",
      status: { in: ["PENDING", "SUCCEEDED"] },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      reference: true,
      createdAt: true,
    },
  });
  const out: LateFeePartition = {
    postLossIds: [],
    postLossTotal: 0,
    preLossIds: [],
    preLossTotal: 0,
    collectedTotal: 0,
  };
  const dayPrefix = `LATE-${booking.id}-D`;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (row.status === "SUCCEEDED") {
      out.collectedTotal = r2(out.collectedTotal + amount);
      continue;
    }
    const isAccruedDayRow = row.reference.startsWith(dayPrefix);
    if (isAccruedDayRow && row.createdAt.getTime() >= lossAt.getTime()) {
      out.postLossIds.push(row.id);
      out.postLossTotal = r2(out.postLossTotal + amount);
    } else {
      out.preLossIds.push(row.id);
      out.preLossTotal = r2(out.preLossTotal + amount);
    }
  }
  return out;
}

type ComputedQuote = LossTerminationQuote & {
  lossAtDate: Date;
  baseSlice: number;
  addonSlice: number;
  insuranceSlice: number;
  writedownGst: number;
  lateFeeCancelIds: string[];
  lateFeeCancelTotal: number;
};

async function computeQuote(
  prisma: PrismaClient,
  booking: LoadedBooking,
  args: PreviewLossTerminationArgs,
): Promise<ComputedQuote> {
  const lossAt = resolveLossAt(booking, args.lossAt);
  const waive = args.waiveAccruedLateFees === true;
  const durationDays = Math.max(1, booking.durationDays);

  // Discounted effective per-day base rate. `subtotal` is the base rental
  // subtotal (post duration-discount/season, pre discount code) and
  // `discountAmount` the code discount — see booking.create — so
  // (subtotal − discountAmount) / durationDays is what the customer actually
  // paid per hire day. Unrounded division; the final figure rounds once.
  const effectiveDailyRate = aud(booking.subtotal)
    .minus(aud(booking.discountAmount))
    .div(durationDays)
    .toNumber();
  const perDayAddonsTotal = booking.addons
    .filter((a) => a.addon.isPerDay)
    .reduce((acc, a) => acc + Number(a.unitPrice) * a.quantity, 0);
  const perDayInsuranceRate = booking.insurance[0]
    ? Number(booking.insurance[0].dailyRate)
    : 0;

  const proRata = calcEarlyReturnRefund({
    scheduledReturn: booking.returnDateTime,
    actualReturn: lossAt,
    dailyRate: effectiveDailyRate,
    perDayAddonsTotal,
    perDayInsuranceRate,
    adminFee: 0,
    minUnusedDays: 0,
  });
  const unusedDays = proRata.unusedDays;
  const grossUnusedValue = proRata.refund; // adminFee 0 → refund == gross

  const forfeit = args.refundMode === "FORFEIT";
  const writedownAmount = forfeit ? 0 : grossUnusedValue;
  const writedownGst = toNumber(gstFromInclusive(writedownAmount));
  // FORFEIT keeps the invoice intact, so every slice must be zero too.
  const baseSlice = forfeit
    ? 0
    : toNumber(aud(effectiveDailyRate).times(unusedDays));
  const insuranceSlice = forfeit
    ? 0
    : toNumber(aud(perDayInsuranceRate).times(unusedDays));
  // Assign rounding residue to the addon slice so the three slices always
  // sum exactly to the write-down.
  const addonSliceRaw = r2(writedownAmount - baseSlice - insuranceSlice);
  const addonSlice = Math.max(0, addonSliceRaw);

  const lateFees = await partitionLateFees(prisma, booking, lossAt);
  const lateFeeCancelIds = waive
    ? [...lateFees.postLossIds, ...lateFees.preLossIds]
    : lateFees.postLossIds;
  const lateFeeCancelTotal = waive
    ? r2(lateFees.postLossTotal + lateFees.preLossTotal)
    : lateFees.postLossTotal;

  // Offset the write-down against the unpaid balance first — only the cash
  // surplus goes back. "Unpaid base" excludes PENDING-backed charges: those
  // raised rows settle (or void) through their own balance-due pairing. Only
  // balance-affecting raise types count here — a PENDING MANUAL_CREDIT /
  // REFUND row is money owed TO the customer, was never added to balanceDue,
  // and counting it would understate the offset and double the give-back.
  const pendingAgg = await prisma.payment.aggregate({
    where: {
      bookingId: booking.id,
      status: "PENDING",
      type: { in: [...BALANCE_AFFECTING_CHARGE_TYPES] },
    },
    _sum: { amount: true },
  });
  const pendingAfterCancel = Math.max(
    0,
    r2(Number(pendingAgg._sum.amount ?? 0) - lateFeeCancelTotal),
  );
  const balanceAfterCancel = Math.max(
    0,
    r2(Number(booking.balanceDue) - lateFeeCancelTotal),
  );
  const unpaidBase = Math.max(0, r2(balanceAfterCancel - pendingAfterCancel));
  const balanceOffset = Math.min(writedownAmount, unpaidBase);
  const surplus = r2(writedownAmount - balanceOffset);
  // Never return more cash than has actually been collected.
  const cashRefund = Math.min(surplus, Math.max(0, Number(booking.amountPaid)));

  // REFUND mode restores the gift-card-funded slice to the funding card(s)
  // first; CREDIT mode converts the whole surplus into a fresh gift card.
  let giftRestoreAmount = 0;
  let cardRefundAmount = cashRefund;
  if (args.refundMode === "REFUND" && cashRefund > 0) {
    const giftAgg = await prisma.payment.aggregate({
      where: {
        bookingId: booking.id,
        type: "GIFT_CARD_REDEMPTION",
        status: "SUCCEEDED",
      },
      _sum: { amount: true },
    });
    const giftPaid = Math.abs(Number(giftAgg._sum.amount ?? 0));
    giftRestoreAmount = r2(Math.min(cashRefund, giftPaid));
    cardRefundAmount = r2(cashRefund - giftRestoreAmount);
  }
  if (args.refundMode === "CREDIT") {
    giftRestoreAmount = 0;
    cardRefundAmount = 0;
  }

  const bond = booking.bondLedger;
  const bondHeldRemaining =
    bond && bond.status === "HELD"
      ? Math.max(
          0,
          r2(
            Number(bond.heldAmount) -
              Number(bond.capturedAmount) -
              Number(bond.releasedAmount),
          ),
        )
      : 0;

  return {
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    status: booking.status,
    lossAt: lossAt.toISOString(),
    lossAtDate: lossAt,
    refundMode: args.refundMode,
    unusedDays,
    effectiveDailyRate: r2(effectiveDailyRate),
    perDayAddonsTotal: r2(perDayAddonsTotal),
    perDayInsuranceRate: r2(perDayInsuranceRate),
    grossUnusedValue,
    writedownAmount,
    writedownGst,
    baseSlice,
    addonSlice,
    insuranceSlice,
    balanceOffset,
    cashRefund,
    giftRestoreAmount,
    cardRefundAmount,
    postLossLateFeeCancel: lateFees.postLossTotal,
    preLossLateFeeWaive: waive ? lateFees.preLossTotal : 0,
    collectedLateFees: lateFees.collectedTotal,
    lateFeeCancelIds,
    lateFeeCancelTotal,
    projectedTotalAmount: Math.max(
      0,
      r2(Number(booking.totalAmount) - writedownAmount),
    ),
    projectedBalanceDue: Math.max(
      0,
      r2(Number(booking.balanceDue) - lateFeeCancelTotal - balanceOffset),
    ),
    bondHeldRemaining,
  };
}

/** Pure quote — never mutates. Backs the terminate dialog's preview panel. */
export async function previewLossTermination(
  prisma: PrismaClient,
  args: PreviewLossTerminationArgs,
): Promise<LossTerminationQuote> {
  const booking = await loadBooking(prisma, args.bookingId);
  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }
  assertTerminatable(booking);
  const { lossAtDate: _lossAtDate, lateFeeCancelIds: _ids, ...quote } =
    await computeQuote(prisma, booking, args);
  return quote;
}

export type TerminateBookingForLossResult = {
  bookingId: string;
  bookingReference: string;
  customerId: string;
  status: "COMPLETED";
  terminationId: string;
  cause: LossTerminationCause;
  refundMode: TerminationRefundMode;
  unusedDays: number;
  refundAmount: number;
  writedownAmount: number;
  waivedLateFeeAmount: number;
  cancelledLateFees: number;
  bondDisposition: TerminationBondDisposition;
  bondReleasedAmount: number;
  creditGiftCardId: string | null;
  creditGiftCardCode: string | null;
  cardRefundOutcome: "NONE" | "SUCCEEDED" | "FAILED" | "MANUAL_CREDIT";
};

export async function terminateBookingForLoss(
  prisma: PrismaClient,
  args: TerminateBookingForLossArgs,
): Promise<TerminateBookingForLossResult> {
  const booking = await loadBooking(prisma, args.bookingId);
  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }
  assertTerminatable(booking);
  if (args.incidentId) {
    const incident = await prisma.incident.findUnique({
      where: { id: args.incidentId },
      select: { id: true },
    });
    if (!incident) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Linked incident not found" });
    }
  }

  const quote = await computeQuote(prisma, booking, args);
  const lossAt = quote.lossAtDate;

  // ── Stripe / gift-card side effects — OUTSIDE the terminal transaction ──

  // Bond release (RELEASED disposition): cancel the manual-capture PI now.
  // On Stripe failure we log and leave the ledger HELD — the gated
  // auto-release / re-hold jobs own the retry; the hire still terminates.
  const bond = booking.bondLedger;
  let bondReleaseSucceeded = false;
  let bondReleasedAmount = 0;
  if (
    args.bondDisposition === "RELEASED" &&
    bond &&
    bond.status === "HELD" &&
    quote.bondHeldRemaining > 0
  ) {
    try {
      await cancelPaymentIntent(bond.stripePaymentIntentId);
      bondReleaseSucceeded = true;
      bondReleasedAmount = quote.bondHeldRemaining;
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          bookingId: booking.id,
          bondLedgerId: bond.id,
        },
        "booking-termination: bond release failed at Stripe — ledger left HELD for auto-release",
      );
    }
  }

  // Card refund slice (REFUND mode).
  type CardOutcome = "NONE" | "SUCCEEDED" | "FAILED" | "MANUAL_CREDIT";
  let cardOutcome: CardOutcome = "NONE";
  let stripeRefundId: string | null = null;
  let cardFailNote = "";
  let refundSource: {
    id: string;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
  } | null = null;
  const refundIdempotencyKey = `term-refund-${booking.id}`;
  if (args.refundMode === "REFUND" && quote.cardRefundAmount > 0.005) {
    refundSource = await prisma.payment.findFirst({
      where: {
        bookingId: booking.id,
        type: "BOOKING_PAYMENT",
        status: "SUCCEEDED",
        stripePaymentIntentId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        stripePaymentIntentId: true,
        stripeChargeId: true,
        processedAt: true,
        createdAt: true,
      },
    });
    if (!refundSource) {
      cardOutcome = "FAILED";
      cardFailNote = "no Stripe charge on file; manual refund required";
    } else {
      const src = refundSource as typeof refundSource & {
        processedAt: Date | null;
        createdAt: Date;
      };
      const chargeAt = src.processedAt ?? src.createdAt;
      const daysSince = (Date.now() - chargeAt.getTime()) / 86_400_000;
      if (daysSince > 180) {
        // Too old for a card refund — record intent as a PENDING
        // MANUAL_CREDIT for finance to settle by bank transfer.
        cardOutcome = "MANUAL_CREDIT";
      } else {
        try {
          const res = await refundCharge({
            paymentIntentId: refundSource.stripePaymentIntentId,
            chargeId: refundSource.stripeChargeId,
            amountCents: Math.round(quote.cardRefundAmount * 100),
            reason: "requested_by_customer",
            metadata: { bookingId: booking.id, kind: "loss-termination" },
            idempotencyKey: refundIdempotencyKey,
          });
          stripeRefundId = res.id;
          cardOutcome =
            res.status === "succeeded" || res.status === "pending"
              ? "SUCCEEDED"
              : "FAILED";
        } catch (err) {
          cardOutcome = "FAILED";
          cardFailNote =
            err instanceof Error ? err.message.slice(0, 160) : "Stripe refund failed";
          logger.error(
            { err: cardFailNote, bookingId: booking.id, amount: quote.cardRefundAmount },
            "booking-termination: card refund failed at Stripe",
          );
        }
      }
    }
  }

  // CREDIT mode: issue ACTIVE gift card(s) for the surplus (money already
  // settled — the admin-comp precedent). Cards cap at A$2000 each, so large
  // surpluses split. Issued before the terminal tx so the id can be stored
  // on the termination row; a tx failure voids them best-effort below.
  let creditGiftCardId: string | null = null;
  let creditGiftCardCode: string | null = null;
  const issuedCreditCardIds: string[] = [];
  const creditCardCodes: string[] = [];
  if (args.refundMode === "CREDIT" && quote.cashRefund > 0.005) {
    let remaining = quote.cashRefund;
    while (remaining > 0.005) {
      const slice = Math.min(2000, remaining);
      const card = await issueGiftCard(prisma, {
        amount: slice,
        purchasedById: booking.customerId,
        purchaserEmail: booking.customer.email,
        recipientEmail: booking.customer.email,
        recipientName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        personalMessage: `Credit for terminated booking ${booking.bookingReference} (vehicle lost in service)`,
        status: "ACTIVE",
      });
      issuedCreditCardIds.push(card.id);
      creditCardCodes.push(card.code);
      remaining = r2(remaining - slice);
    }
    creditGiftCardId = issuedCreditCardIds[0] ?? null;
    creditGiftCardCode = creditCardCodes[0] ?? null;
  }

  // Total actually being returned/credited to the customer (intended figure
  // — a FAILED card refund still records it; the retry ladder lands it).
  const refundAmount =
    args.refundMode === "FORFEIT" ? 0 : quote.cashRefund;

  // ── Terminal transaction ─────────────────────────────────────────────────
  let result: TerminateBookingForLossResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      // CAS the status flip + write-down together: a concurrent check-in /
      // termination makes this match zero rows and the whole tx aborts.
      const postSubtotal = Math.max(
        0,
        toNumber(aud(booking.subtotal).minus(quote.baseSlice)),
      );
      const postAddonTotal = Math.max(
        0,
        toNumber(aud(booking.addonTotal).minus(quote.addonSlice)),
      );
      const postInsuranceTotal = Math.max(
        0,
        toNumber(aud(booking.insuranceTotal).minus(quote.insuranceSlice)),
      );
      const postGst = Math.max(
        0,
        toNumber(aud(booking.gstAmount).minus(quote.writedownGst)),
      );
      const postTotal = Math.max(
        0,
        toNumber(aud(booking.totalAmount).minus(quote.writedownAmount)),
      );

      const flipped = await tx.booking.updateMany({
        where: { id: booking.id, status: { in: [...TERMINATABLE_STATUSES] } },
        data: {
          status: "COMPLETED",
          actualReturnDateTime: lossAt,
          checkedInById: args.actorId,
          subtotal: postSubtotal,
          addonTotal: postAddonTotal,
          insuranceTotal: postInsuranceTotal,
          gstAmount: postGst,
          totalAmount: postTotal,
        },
      });
      if (flipped.count === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Booking changed while terminating (checked in or terminated concurrently). Reload and retry.",
        });
      }
      await tx.bookingStatusLog.create({
        data: {
          bookingId: booking.id,
          previousStatus: booking.status,
          newStatus: "COMPLETED",
          changedById: args.actorId,
          reason: `Terminated for loss: ${args.cause}`,
        },
      });

      // Cancel late-fee rows (void convention: FAILED + note) and pair the
      // balanceDue decrement in the same tx. CAS on PENDING so a concurrent
      // capture can't be double-counted.
      let cancelledLateFees = 0;
      if (quote.lateFeeCancelIds.length > 0) {
        const rows = await tx.payment.findMany({
          where: { id: { in: quote.lateFeeCancelIds }, status: "PENDING" },
          select: { id: true, amount: true },
        });
        if (rows.length > 0) {
          await tx.payment.updateMany({
            where: { id: { in: rows.map((row) => row.id) }, status: "PENDING" },
            data: {
              status: "FAILED",
              notes: `VOIDED by staff: booking terminated for loss (${args.cause}) — late fee not chargeable`,
              processedById: args.actorId,
              processedAt: new Date(),
            },
          });
          cancelledLateFees = r2(
            rows.reduce((acc, row) => acc + Number(row.amount), 0),
          );
          // Same status-change trail voidPayment writes — the payment
          // console's event history must not have silent voids.
          for (const row of rows) {
            await writePaymentEvent(
              tx,
              {
                paymentId: row.id,
                eventType: "STATUS_CHANGED",
                previousStatus: "PENDING",
                newStatus: "FAILED",
                source: "staff:terminateForLoss",
                actorUserId: args.actorId,
                data: { reason: `booking terminated for loss (${args.cause})` },
              },
              { swallow: true },
            );
          }
        }
      }

      // Balance: remove the cancelled late fees + the write-down offset,
      // then clamp at zero (a balance can never go negative).
      const balanceDecrement = r2(cancelledLateFees + quote.balanceOffset);
      if (balanceDecrement > 0) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { balanceDue: { decrement: balanceDecrement } },
        });
      }
      await tx.booking.updateMany({
        where: { id: booking.id, balanceDue: { lt: 0 } },
        data: { balanceDue: 0 },
      });

      // Refund ledger rows.
      let amountPaidDecrement = 0;
      if (args.refundMode === "REFUND" && quote.giftRestoreAmount > 0.005) {
        const { restored } = await restoreGiftCardForBooking(tx, {
          bookingId: booking.id,
          amount: quote.giftRestoreAmount,
          reason: `Refund — booking ${booking.bookingReference} terminated (vehicle lost in service)`,
        });
        await tx.payment.create({
          data: {
            reference: `TERM-REF-GC-${booking.id}`,
            bookingId: booking.id,
            customerId: booking.customerId,
            type: "REFUND",
            method: "CARD",
            amount: quote.giftRestoreAmount,
            gstAmount: gstFromInclusive(quote.giftRestoreAmount),
            status: "SUCCEEDED",
            processedAt: new Date(),
            processedById: args.actorId,
            notes:
              restored >= quote.giftRestoreAmount
                ? "Loss-termination refund restored to gift card"
                : `Loss-termination refund restored to gift card (A$${restored.toFixed(2)} of A$${quote.giftRestoreAmount.toFixed(2)} — remainder needs manual follow-up)`,
          },
        });
        amountPaidDecrement = r2(amountPaidDecrement + quote.giftRestoreAmount);
      }
      if (args.refundMode === "REFUND" && quote.cardRefundAmount > 0.005) {
        if (cardOutcome === "MANUAL_CREDIT") {
          await tx.payment.create({
            data: {
              reference: `TERM-CREDIT-${booking.id}`,
              bookingId: booking.id,
              customerId: booking.customerId,
              type: "MANUAL_CREDIT",
              method: "BANK_TRANSFER",
              amount: quote.cardRefundAmount,
              gstAmount: gstFromInclusive(quote.cardRefundAmount),
              status: "PENDING",
              processedById: args.actorId,
              notes:
                "Loss-termination refund >180d after source charge: needs manual reconcile via credit note / bank transfer.",
            },
          });
        } else {
          await tx.payment.create({
            data: {
              reference: `TERM-REF-${booking.id}`,
              bookingId: booking.id,
              customerId: booking.customerId,
              type: "REFUND",
              method: "STRIPE",
              amount: quote.cardRefundAmount,
              gstAmount: gstFromInclusive(quote.cardRefundAmount),
              status: cardOutcome === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
              stripeChargeId: stripeRefundId,
              processedAt: cardOutcome === "SUCCEEDED" ? new Date() : null,
              processedById: args.actorId,
              notes:
                cardOutcome === "SUCCEEDED"
                  ? "Loss-termination refund of unused hire days"
                  : `Loss-termination refund FAILED — ${cardFailNote}`,
            },
          });
          if (cardOutcome === "SUCCEEDED") {
            amountPaidDecrement = r2(amountPaidDecrement + quote.cardRefundAmount);
          }
        }
      }
      if (args.refundMode === "CREDIT" && quote.cashRefund > 0.005) {
        await tx.payment.create({
          data: {
            reference: `TERM-CREDIT-GC-${booking.id}`,
            bookingId: booking.id,
            customerId: booking.customerId,
            type: "REFUND",
            method: "CARD",
            amount: quote.cashRefund,
            gstAmount: gstFromInclusive(quote.cashRefund),
            status: "SUCCEEDED",
            processedAt: new Date(),
            processedById: args.actorId,
            notes: `Loss-termination credit issued as gift card ${creditCardCodes.join(", ")}`,
          },
        });
        amountPaidDecrement = r2(amountPaidDecrement + quote.cashRefund);
      }
      if (amountPaidDecrement > 0) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { amountPaid: { decrement: amountPaidDecrement } },
        });
        await tx.booking.updateMany({
          where: { id: booking.id, amountPaid: { lt: 0 } },
          data: { amountPaid: 0 },
        });
      }

      // Bond bookkeeping for a successful Stripe cancel above. HELD_FOR_CLAIM
      // deliberately leaves the ledger HELD (the bond-auth-expiry keep-alive
      // now re-auths it); CAPTURED_VIA_INCIDENT is a no-op — the incident
      // charge owns the capture.
      if (bondReleaseSucceeded && bond) {
        await tx.bondLedger.update({
          where: { id: bond.id },
          data: {
            status: "RELEASED",
            releasedAmount: r2(
              Number(bond.heldAmount) - Number(bond.capturedAmount),
            ),
          },
        });
        await tx.payment.create({
          data: {
            reference: `TERM-RELEASE-${booking.id}`,
            bookingId: booking.id,
            customerId: booking.customerId,
            type: "BOND_RELEASE",
            method: "STRIPE",
            amount: bondReleasedAmount,
            status: "SUCCEEDED",
            processedAt: new Date(),
            notes: "Bond released at loss termination",
          },
        });
      }

      const termination = await tx.bookingTermination.create({
        data: {
          bookingId: booking.id,
          incidentId: args.incidentId ?? null,
          cause: args.cause,
          lossAt,
          unusedDays: quote.unusedDays,
          refundMode: args.refundMode,
          refundAmount,
          creditGiftCardId,
          waivedLateFeeAmount: quote.preLossLateFeeWaive,
          bondDisposition: args.bondDisposition,
          notes: args.notes ?? null,
          terminatedById: args.actorId,
        },
      });

      // Completion counters with the POST-write-down totals — settlement
      // before completion so revenue is never overstated.
      await recordBookingCompletion(tx, {
        id: booking.id,
        customerId: booking.customerId,
        depotId: booking.depotId,
        actualReturnDateTime: lossAt,
        subtotal: aud(postSubtotal),
        addonTotal: aud(postAddonTotal),
        gstAmount: aud(postGst),
        totalAmount: aud(postTotal),
      });
      await autoCloseByTarget(tx, "Booking", booking.id, {
        types: ["BOOKING_RETURN", "BOOKING_OVERDUE_CHASE"],
        reason: "completed",
        closingUserId: args.actorId,
      });

      return {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        customerId: booking.customerId,
        status: "COMPLETED" as const,
        terminationId: termination.id,
        cause: args.cause,
        refundMode: args.refundMode,
        unusedDays: quote.unusedDays,
        refundAmount,
        writedownAmount: quote.writedownAmount,
        waivedLateFeeAmount: quote.preLossLateFeeWaive,
        cancelledLateFees,
        bondDisposition: args.bondDisposition,
        bondReleasedAmount,
        creditGiftCardId,
        creditGiftCardCode,
        cardRefundOutcome: cardOutcome,
      };
    });
  } catch (err) {
    // Terminal tx failed after credit cards were issued — void them so the
    // customer can't spend an orphaned credit. Best-effort.
    for (const cardId of issuedCreditCardIds) {
      try {
        await prisma.giftCard.update({
          where: { id: cardId },
          data: { status: "VOIDED" },
        });
      } catch (voidErr) {
        logger.error(
          {
            err: voidErr instanceof Error ? voidErr.message : String(voidErr),
            giftCardId: cardId,
            bookingId: booking.id,
          },
          "booking-termination: could not void orphaned credit gift card",
        );
      }
    }
    throw err;
  }

  await invalidateRevenueCaches(booking.depotId);

  // ATO §29-75 adjustment note for the write-down (non-blocking).
  if (quote.writedownAmount > 0.01) {
    await tryIssueAdjustmentForBooking({
      bookingId: booking.id,
      type: "DECREASE",
      reason: "TERMINATION",
      description: `Hire terminated — vehicle lost in service (${args.cause})`,
      lineItems: [
        {
          description: `Unused hire days — vehicle lost in service (${quote.unusedDays} days)`,
          detail: `Loss recorded ${lossAt.toLocaleString("en-AU", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Australia/Brisbane",
          })}`,
          quantity: 1,
          unitPrice: quote.writedownAmount,
          totalPrice: quote.writedownAmount,
          gstAmount: quote.writedownGst,
          gstIncluded: true,
        },
      ],
      issuedById: args.actorId,
    });
  }

  // Failed card refund → queued retry + manager alert (never silently kept).
  if (cardOutcome === "FAILED" && refundSource) {
    try {
      const failedRow = await prisma.payment.findFirst({
        where: { bookingId: booking.id, reference: `TERM-REF-${booking.id}` },
        select: { id: true },
      });
      if (failedRow) {
        const { enqueueRefundRetry } = await import("@/server/jobs/refund-retry");
        await enqueueRefundRetry({
          paymentId: failedRow.id,
          paymentIntentId: refundSource.stripePaymentIntentId,
          chargeId: refundSource.stripeChargeId,
          amountCents: Math.round(quote.cardRefundAmount * 100),
          idempotencyKey: refundIdempotencyKey,
          attempt: 1,
        });
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
        "booking-termination: could not enqueue refund retry",
      );
    }
  }
  if (cardOutcome === "FAILED") {
    try {
      const managers = await prisma.user.findMany({
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
          title: "Loss-termination refund failed",
          body: `The A$${quote.cardRefundAmount.toFixed(2)} unused-days refund for terminated booking ${booking.bookingReference} failed at Stripe (${cardFailNote || "see payment row"}). An automatic retry is queued; if it keeps failing, refund manually from the payment console.`,
          bookingId: booking.id,
          data: { amountAud: quote.cardRefundAmount },
        });
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
        "booking-termination: manager refund alert failed",
      );
    }
  }

  await notifyTermination(prisma, booking, {
    cause: args.cause,
    lossAt,
    quote,
    refundAmount,
    cardOutcome,
    creditGiftCardCode,
    bondDisposition: args.bondDisposition,
    bondReleasedAmount,
    bondHeldRemaining: quote.bondHeldRemaining,
  }).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
      "booking-termination: notifications failed; non-blocking",
    );
  });

  logger.info(
    {
      bookingId: booking.id,
      cause: args.cause,
      refundMode: args.refundMode,
      unusedDays: quote.unusedDays,
      writedown: quote.writedownAmount,
      refundAmount,
      bondDisposition: args.bondDisposition,
    },
    "booking terminated for loss",
  );

  return result;
}

const CAUSE_LABELS: Record<LossTerminationCause, string> = {
  WRITTEN_OFF: "was written off",
  STOLEN: "was reported stolen",
  DESTROYED: "was destroyed",
  OTHER: "was lost in service",
};

async function notifyTermination(
  prisma: PrismaClient,
  booking: LoadedBooking,
  info: {
    cause: LossTerminationCause;
    lossAt: Date;
    quote: ComputedQuote;
    refundAmount: number;
    cardOutcome: "NONE" | "SUCCEEDED" | "FAILED" | "MANUAL_CREDIT";
    creditGiftCardCode: string | null;
    bondDisposition: TerminationBondDisposition;
    bondReleasedAmount: number;
    bondHeldRemaining: number;
  },
): Promise<void> {
  const { siteName } = await getBranding();
  const fmt = (n: number) => `A$${n.toFixed(2)}`;

  let bondLine: string;
  if (info.bondDisposition === "RELEASED") {
    bondLine =
      info.bondReleasedAmount > 0
        ? `Your bond hold of ${fmt(info.bondReleasedAmount)} has been released — depending on your bank, funds may take 3–5 business days to appear.`
        : "No bond was held at termination.";
  } else if (info.bondDisposition === "HELD_FOR_CLAIM") {
    bondLine =
      "Your bond remains held while the incident is assessed. We will contact you about its release or any applicable charges.";
  } else {
    bondLine =
      "Your bond has been applied toward the incident charges — see the incident correspondence for the breakdown.";
  }

  const { render } = await import("@react-email/render");
  const { createElement } = await import("react");
  const { default: BookingTerminated } = await import(
    "../../../emails/booking-terminated"
  );
  const html = await render(
    createElement(BookingTerminated, {
      customerName: booking.customer.firstName,
      bookingReference: booking.bookingReference,
      causeLabel: CAUSE_LABELS[info.cause],
      lossAt: info.lossAt.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Australia/Brisbane",
      }),
      unusedDays: info.quote.unusedDays,
      refundMode: info.quote.refundMode,
      refundAmount: info.refundAmount > 0 ? fmt(info.refundAmount) : null,
      refundDelayed: info.cardOutcome === "FAILED" || info.cardOutcome === "MANUAL_CREDIT",
      creditGiftCardCode: info.creditGiftCardCode,
      writedownAmount: info.quote.writedownAmount > 0 ? fmt(info.quote.writedownAmount) : null,
      waivedLateFees:
        info.quote.preLossLateFeeWaive > 0 ? fmt(info.quote.preLossLateFeeWaive) : null,
      bondLine,
    }),
  );

  const refundSentence =
    info.quote.refundMode === "FORFEIT" || info.refundAmount <= 0
      ? "No refund applies for the unused days."
      : info.quote.refundMode === "CREDIT"
        ? `A credit of ${fmt(info.refundAmount)} has been issued to you as a gift card.`
        : `A refund of ${fmt(info.refundAmount)} for the unused days is on its way.`;
  await sendNotification({
    userId: booking.customerId,
    type: "BOOKING_CANCELLED",
    channels: ["EMAIL"],
    subject: `Your booking ${booking.bookingReference} has ended`,
    title: "Booking ended — vehicle unavailable",
    html,
    body: `${siteName}: your booking ${booking.bookingReference} has ended because the vehicle ${CAUSE_LABELS[info.cause]}. ${refundSentence} ${bondLine}`,
    bookingId: booking.id,
    data: {
      cause: info.cause,
      refundMode: info.quote.refundMode,
      refundAmount: info.refundAmount,
      unusedDays: info.quote.unusedDays,
    },
  });

  // Depot managers: IN_APP heads-up.
  const managers = await prisma.user.findMany({
    where: {
      role: { in: ["MANAGER", "ADMIN"] },
      status: "ACTIVE",
      OR: [{ depotId: booking.depotId }, { depotId: null }],
    },
    select: { id: true },
  });
  for (const m of managers) {
    await sendNotification({
      userId: m.id,
      type: "INCIDENT_REPORTED",
      category: "OPERATIONAL",
      channels: ["IN_APP"],
      title: `Hire terminated for loss — ${booking.bookingReference}`,
      body: `Booking ${booking.bookingReference} was terminated (${info.cause}). ${info.quote.unusedDays} unused day(s), ${info.quote.refundMode.toLowerCase()} ${fmt(info.refundAmount)}, bond ${info.bondDisposition.replace(/_/g, " ").toLowerCase()}.`,
      bookingId: booking.id,
      data: { url: `/staff/bookings/${booking.id}`, cause: info.cause },
    });
  }
}
