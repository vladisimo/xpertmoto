import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, managerProcedure, staffProcedure } from "../trpc";
import { cancelPaymentIntent, capturePaymentIntent, refundCharge } from "@/lib/stripe";
import { chargeOffSessionForUser } from "@/server/services/stripe-customer";
import {
  applyCaptureToBalanceDue,
  BALANCE_AFFECTING_CHARGE_TYPES,
} from "@/server/services/balance-due";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { captureBookingId, readCapturedBookingId } from "@/server/services/audit";
import { writePaymentEvent } from "@/server/services/payment-events";
import { gstFromInclusive, aud, roundCents, times } from "@/lib/money";
import { trackServer } from "@/lib/analytics";

/**
 * Phase B — booking-settlement router.
 *
 * Powers the unified Payment Console on the staff booking detail page.
 * Every button in the console goes through one of these procedures:
 *
 *   - addManualCharge   — add an ad-hoc charge (cleaning fee, misc).
 *   - voidPayment       — mark a PENDING row VOID without charging.
 *   - captureNow        — force the off-session charge for a PENDING row
 *                         instead of waiting for the capture-pending job.
 *   - refundPayment     — issue a Stripe refund against a SUCCEEDED row
 *                         (thin wrapper that calls into staffBooking.refundPayment
 *                         semantics so the console has a single entry point).
 *   - releaseBond       — release all or part of a HELD BondLedger early.
 *   - captureBond       — capture a specific amount from a HELD bond and
 *                         append a deduction record.
 *   - pauseBillingPlan /
 *     resumeBillingPlan /
 *     cancelBillingPlan /
 *     rescheduleNextCharge — control a long-term hire's recurring plan.
 *   - settle            — the "Settle & close" button at the bottom of the
 *                         console. Replaces the old check-in/settle page.
 */

const MANUAL_CHARGE_TYPES = [
  "MANUAL_CHARGE",
  "CLEANING_FEE",
  "FUEL_CHARGE",
  "LATE_FEE",
  "DAMAGE_CHARGE",
  "EXTENSION",
  "ADDON_CHARGE",
] as const;

export const bookingSettlementRouter = createTRPCRouter({
  // ---------------------------------------------------------------------
  // Charge management
  // ---------------------------------------------------------------------
  addManualCharge: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        amount: z.number().positive("Enter a charge amount"),
        description: z.string().min(1, "Describe the charge"),
        type: z.enum(MANUAL_CHARGE_TYPES).default("MANUAL_CHARGE"),
        gstInclusive: z.boolean().default(true),
      }),
    )
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { id: true, bookingReference: true, customerId: true, balanceDue: true },
      });
      // GST = total / 11 when inclusive; zero when caller opted out.
      const gst = input.gstInclusive ? gstFromInclusive(input.amount) : 0;
      // Charge row + balanceDue increment are one atomic unit (the balanceDue
      // invariant: every raise increments it) — a Payment without its
      // increment is money settlement will never collect. The increment is
      // atomic rather than read-modify-write so concurrent charges can't
      // lose updates.
      const payment = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            reference: `MAN-${Date.now()}`,
            bookingId: b.id,
            customerId: b.customerId,
            type: input.type,
            method: "STRIPE",
            amount: input.amount,
            gstAmount: gst,
            status: "PENDING",
            notes: input.description,
          },
        });
        await tx.booking.update({
          where: { id: b.id },
          data: { balanceDue: { increment: input.amount } },
        });
        return created;
      });
      await writePaymentAudit(ctx.prisma, {
        action: "payment.manual_charge_created",
        entity: "Payment",
        entityId: payment.id,
        userId: ctx.user.id,
        status: "SUCCESS",
        newData: { amount: input.amount, type: input.type },
      });
      return payment;
    }),

  voidPayment: staffProcedure
    .input(
      z.object({
        paymentId: z.string(),
        reason: z.string().min(1, "Reason is required"),
      }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        select: { id: true, status: true, amount: true, bookingId: true, reference: true },
      });
      captureBookingId(ctx, p.bookingId);
      if (p.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only PENDING payments can be voided (this one is ${p.status}).`,
        });
      }
      await ctx.prisma.$transaction(async (tx) => {
        // CAS on PENDING: two concurrent voids (or a void racing a capture)
        // must decrement balanceDue at most once. The pre-check above is
        // advisory only — this is the authoritative gate.
        const voided = await tx.payment.updateMany({
          where: { id: p.id, status: "PENDING" },
          data: {
            status: "FAILED",
            notes: `VOIDED by staff: ${input.reason}`,
            processedById: ctx.user.id,
            processedAt: new Date(),
          },
        });
        if (voided.count === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment is no longer PENDING — it was captured or voided concurrently.",
          });
        }
        if (p.bookingId) {
          // Atomic decrement (no stale read), clamped back to zero after —
          // a balance can never go negative.
          await tx.booking.update({
            where: { id: p.bookingId },
            data: { balanceDue: { decrement: Number(p.amount) } },
          });
          await tx.booking.updateMany({
            where: { id: p.bookingId, balanceDue: { lt: 0 } },
            data: { balanceDue: 0 },
          });
        }
        // Revert the Infringement back to NOMINATED (or RECEIVED) when
        // an INFRINGEMENT_RECOVERY payment is voided so the Tolls tab
        // stops showing it as Charged. Reference is `INFR-<refNumber>`.
        if (p.reference.startsWith("INFR-")) {
          const { revertInfringementOnVoid } = await import(
            "@/server/services/infringement-charge"
          );
          await revertInfringementOnVoid(tx, p.reference);
        }
        await writePaymentEvent(
          tx,
          {
            paymentId: p.id,
            eventType: "STATUS_CHANGED",
            previousStatus: "PENDING",
            newStatus: "FAILED",
            source: "staff:voidPayment",
            data: { reason: input.reason },
          },
          { swallow: true },
        );
      });
      return { ok: true };
    }),

  captureNow: staffProcedure
    .input(z.object({ paymentId: z.string() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        select: {
          id: true,
          amount: true,
          customerId: true,
          bookingId: true,
          status: true,
          type: true,
          reference: true,
          booking: { select: { bookingReference: true } },
        },
      });
      captureBookingId(ctx, p.bookingId);
      if (p.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only PENDING payments can be captured (this one is ${p.status}).`,
        });
      }
      if (!p.customerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment has no customer on file — capture not possible.",
        });
      }
      // Key + params are VERBATIM the capture-pending-payments first-attempt
      // request (see attemptKey there): a staff click racing the 5-minute
      // sweep must collapse to one PaymentIntent at Stripe, and Stripe only
      // dedupes when key AND params match — hence no staffId in metadata
      // (the audit log carries the actor).
      const charge = await chargeOffSessionForUser({
        userId: p.customerId,
        amount: Number(p.amount),
        description: `${p.type} — ${p.booking?.bookingReference ?? p.reference}`,
        idempotencyKey: `payment-capture:${p.id}`,
        metadata: {
          paymentId: p.id,
          paymentReference: p.reference,
          paymentType: p.type,
          bookingId: p.bookingId ?? "",
        },
      });
      if (!charge) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Customer has no card on file. Add a card first (customer portal → Payment methods) or take a manual payment.",
        });
      }
      if (charge.status === "succeeded") {
        // CAS on the PENDING status: the Stripe webhook for this same
        // payment intent races this mutation, and both decrement balanceDue
        // when they win the flip — so only the winner may apply it. Flip +
        // decrement share one transaction: the flip is a consumed-once
        // gate, so a decrement failure after a committed flip could never
        // be retried.
        await ctx.prisma.$transaction(async (tx) => {
          const flipped = await tx.payment.updateMany({
            where: { id: p.id, status: "PENDING" },
            data: {
              status: "SUCCEEDED",
              stripePaymentIntentId: charge.id,
              stripeChargeId: charge.chargeId ?? null,
              processedAt: new Date(),
              processedById: ctx.user.id,
            },
          });
          // Remove the charge's increment from balanceDue now it's collected
          // (it was added when the PENDING charge was raised). Shared with the
          // capture-pending job and the Stripe webhook so they can't drift.
          if (flipped.count > 0) {
            await applyCaptureToBalanceDue(tx, {
              bookingId: p.bookingId,
              type: p.type,
              amount: p.amount,
              previousStatus: "PENDING",
            });
          }
        });
        // Keep the Infringement row in sync when staff capture an
        // INFRINGEMENT_RECOVERY payment manually — the Tolls tab and
        // customer surfaces both derive their paid/unpaid status from
        // Infringement.status. Best-effort, never blocks the capture.
        if (p.reference.startsWith("INFR-")) {
          try {
            const { markInfringementPaidOnCapture } = await import(
              "@/server/services/infringement-charge"
            );
            await markInfringementPaidOnCapture(ctx.prisma, p.reference);
          } catch {
            // logged downstream by the helper / Prisma
          }
        }
        await writePaymentEvent(
          ctx.prisma,
          {
            paymentId: p.id,
            eventType: "CAPTURED",
            previousStatus: "PENDING",
            newStatus: "SUCCEEDED",
            source: "staff:captureNow",
            data: { stripePaymentIntentId: charge.id },
          },
          { swallow: true },
        );
        return { status: "SUCCEEDED" as const, stripeId: charge.id };
      }
      // requires_action or hard failure — record the attempt but leave status
      // alone so the caller sees the outcome.
      await ctx.prisma.payment.update({
        where: { id: p.id },
        data: {
          stripePaymentIntentId: charge.id,
          notes: `captureNow: ${charge.status}${charge.errorMessage ? ` — ${charge.errorMessage}` : ""}`,
        },
      });
      return {
        status:
          charge.status === "requires_action"
            ? ("REQUIRES_ACTION" as const)
            : ("FAILED" as const),
        stripeId: charge.id,
        errorMessage: charge.errorMessage ?? null,
      };
    }),

  // ---------------------------------------------------------------------
  // Bond controls
  // ---------------------------------------------------------------------
  releaseBond: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        // Undefined = release the whole remaining amount.
        amount: z.number().positive().optional(),
        reason: z.string().min(1, "Reason is required"),
      }),
    )
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const ledger = await ctx.prisma.bondLedger.findUniqueOrThrow({
        where: { bookingId: input.bookingId },
      });
      if (ledger.status === "RELEASED" || ledger.status === "FULLY_CAPTURED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Bond is already ${ledger.status}; nothing to release.`,
        });
      }
      const held = Number(ledger.heldAmount);
      const captured = Number(ledger.capturedAmount);
      const alreadyReleased = Number(ledger.releasedAmount);
      const remaining = held - captured - alreadyReleased;
      const releaseAmount = input.amount ?? remaining;
      if (releaseAmount <= 0 || releaseAmount > remaining + 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Release must be between A$0.01 and A$${remaining.toFixed(2)}.`,
        });
      }
      // Full release cancels the Stripe auth; partial release leaves the
      // auth alive and just records the split in the ledger (Stripe
      // doesn't support partial uncapture on a hold). When partial, the
      // remaining balance naturally releases when the 7-day auth window
      // expires.
      const fullRelease = releaseAmount >= remaining - 0.01;
      if (fullRelease) {
        await cancelPaymentIntent(ledger.stripePaymentIntentId);
      }
      const newReleased = alreadyReleased + releaseAmount;
      const newStatus =
        fullRelease ? "RELEASED" : captured > 0 ? "PARTIALLY_CAPTURED" : ledger.status;

      await ctx.prisma.$transaction(async (tx) => {
        await tx.bondLedger.update({
          where: { bookingId: input.bookingId },
          data: { releasedAmount: newReleased, status: newStatus },
        });
        await tx.payment.create({
          data: {
            reference: `BOND-REL-${Date.now()}`,
            bookingId: input.bookingId,
            customerId: ledger.customerId,
            type: "BOND_RELEASE",
            method: "STRIPE",
            amount: releaseAmount,
            gstAmount: 0,
            status: "SUCCEEDED",
            processedAt: new Date(),
            processedById: ctx.user.id,
            notes: `Bond release: ${input.reason}`,
          },
        });
      });
      await trackServer({
        event: "bond.released",
        distinctId: ledger.customerId,
        properties: {
          bookingId: input.bookingId,
          releasedAud: releaseAmount,
          fullRelease,
          status: newStatus,
          reason: input.reason,
          actorUserId: ctx.user.id,
        },
      });
      return { releasedAmount: releaseAmount, status: newStatus };
    }),

  captureBond: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        amount: z.number().positive(),
        deductionLabel: z.string().min(1, "Label the deduction"),
      }),
    )
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const ledger = await ctx.prisma.bondLedger.findUniqueOrThrow({
        where: { bookingId: input.bookingId },
      });
      if (ledger.status === "RELEASED" || ledger.status === "FULLY_CAPTURED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Bond is already ${ledger.status}; nothing to capture.`,
        });
      }
      // A Stripe manual-capture hold can only be captured ONCE — the first
      // (even partial) capture finalises the auth and releases the remainder.
      // So a bond can be captured exactly once; any further recovery goes to
      // the card on file as a separate charge.
      if (Number(ledger.capturedAmount) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This bond has already been captured once — Stripe holds are single-capture. Charge the card on file for any further amount.",
        });
      }
      const held = Number(ledger.heldAmount);
      const alreadyReleased = Number(ledger.releasedAmount);
      // How much of the hold is still capturable per our ledger. Capturing
      // this much releases the rest at Stripe automatically.
      const capturable = Math.max(0, held - alreadyReleased);
      const fromBond = Math.min(input.amount, capturable);
      const fromCard = roundCents(aud(input.amount).minus(fromBond)).toNumber();

      // Capture the held PaymentIntent BEFORE any DB write — never hold a
      // Postgres transaction open across a Stripe round-trip. On a Stripe
      // failure this throws and we write nothing.
      let chargeId: string | null = null;
      if (fromBond > 0) {
        try {
          const capture = await capturePaymentIntent(ledger.stripePaymentIntentId, {
            amountToCaptureCents: Math.round(fromBond * 100),
            idempotencyKey: `bond-capture-${ledger.id}`,
          });
          chargeId = capture.latestChargeId;
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Stripe could not capture the bond hold: ${
              err instanceof Error ? err.message : "unknown error"
            }. The bond was not captured.`,
          });
        }
      }

      // After a single capture the hold is finalised: captured = fromBond,
      // everything else is released by Stripe. Land terminal so the DB CHECK
      // (captured + released == held) holds and no second capture is invited.
      const newReleased = roundCents(aud(held).minus(fromBond)).toNumber();
      const deductions = Array.isArray(ledger.deductions)
        ? [...(ledger.deductions as Array<{ reason: string; amount: number }>)]
        : [];
      if (fromBond > 0) deductions.push({ reason: input.deductionLabel, amount: fromBond });

      const captureResult = await ctx.prisma.$transaction(async (tx) => {
        let bondPaymentId: string | null = null;
        if (fromBond > 0) {
          await tx.bondLedger.update({
            where: { bookingId: input.bookingId },
            data: {
              capturedAmount: fromBond,
              releasedAmount: newReleased,
              status: "FULLY_CAPTURED",
              deductions: deductions as unknown as Prisma.InputJsonValue,
            },
          });
          const payment = await tx.payment.create({
            data: {
              reference: `BOND-CAP-${Date.now()}`,
              bookingId: input.bookingId,
              customerId: ledger.customerId,
              type: "BOND_CAPTURE",
              method: "STRIPE",
              amount: fromBond,
              // Bond-funded damage recovery is taxable consideration — same GST
              // treatment as the card-overflow slice of the identical recovery.
              gstAmount: gstFromInclusive(fromBond),
              status: "SUCCEEDED",
              // Link the Stripe ids so stripe-reconcile's SYSTEM_LEDGER
              // cross-check matches this row to the captured charge.
              stripePaymentIntentId: ledger.stripePaymentIntentId,
              stripeChargeId: chargeId,
              processedAt: new Date(),
              processedById: ctx.user.id,
              notes: `Bond capture: ${input.deductionLabel}`,
            },
            select: { id: true },
          });
          bondPaymentId = payment.id;
        }
        // Overflow beyond the hold → PENDING card charge for the capture-
        // pending job to collect off-session (mirrors fleet.ts). Added to
        // balanceDue so applyCaptureToBalanceDue nets it out on capture.
        if (fromCard > 0) {
          await tx.payment.create({
            data: {
              reference: `BOND-CAP-OVF-${Date.now()}`,
              bookingId: input.bookingId,
              customerId: ledger.customerId,
              type: "DAMAGE_CHARGE",
              method: "STRIPE",
              amount: fromCard,
              gstAmount: gstFromInclusive(fromCard),
              status: "PENDING",
              notes: `Bond capture overflow (exceeds hold): ${input.deductionLabel}`,
            },
          });
          const b = await tx.booking.findUnique({
            where: { id: input.bookingId },
            select: { balanceDue: true },
          });
          if (b) {
            await tx.booking.update({
              where: { id: input.bookingId },
              data: { balanceDue: Number(b.balanceDue) + fromCard },
            });
          }
        }
        return { paymentId: bondPaymentId };
      });
      // Issue an adjustment note for the amount captured from the bond so the
      // customer gets the GST-compliant document via the auto-email pipeline.
      // Best effort — sweep job retries any captures that miss the note.
      if (fromBond > 0) {
        try {
          const { tryIssueAdjustmentForBooking } = await import(
            "@/server/services/invoice-lifecycle"
          );
          await tryIssueAdjustmentForBooking({
            bookingId: input.bookingId,
            type: "INCREASE",
            reason: "OTHER",
            description: `Bond capture — ${input.deductionLabel}`,
            lineItems: [
              {
                description: `Bond capture — ${input.deductionLabel}`,
                quantity: 1,
                unitPrice: fromBond,
                totalPrice: fromBond,
                gstIncluded: true,
              },
            ],
            paymentId: captureResult.paymentId,
            issuedById: ctx.user.id,
          });
        } catch {
          // tryIssueAdjustmentForBooking already logs internal failures.
        }
      }
      await trackServer({
        event: "bond.captured",
        distinctId: ledger.customerId,
        properties: {
          bookingId: input.bookingId,
          capturedAud: fromBond,
          overflowToCardAud: fromCard,
          totalCapturedAud: fromBond,
          status: "FULLY_CAPTURED",
          deductionLabel: input.deductionLabel,
          actorUserId: ctx.user.id,
        },
      });
      return { capturedAmount: fromBond, overflowToCard: fromCard, status: "FULLY_CAPTURED" as const };
    }),

  // ---------------------------------------------------------------------
  // Billing plan controls
  // ---------------------------------------------------------------------
  pauseBillingPlan: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().min(1) }))
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.bookingBillingPlan.findUniqueOrThrow({
        where: { bookingId: input.bookingId },
      });
      if (plan.status !== "ACTIVE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Plan is ${plan.status}; can only pause an ACTIVE plan.`,
        });
      }
      return ctx.prisma.bookingBillingPlan.update({
        where: { bookingId: input.bookingId },
        data: { status: "PAUSED", pauseReason: input.reason },
      });
    }),

  resumeBillingPlan: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.bookingBillingPlan.findUniqueOrThrow({
        where: { bookingId: input.bookingId },
      });
      if (plan.status !== "PAUSED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Plan is ${plan.status}; can only resume a PAUSED plan.`,
        });
      }
      return ctx.prisma.bookingBillingPlan.update({
        where: { bookingId: input.bookingId },
        data: { status: "ACTIVE", pauseReason: null },
      });
    }),

  cancelBillingPlan: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().min(1) }))
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.bookingBillingPlan.update({
        where: { bookingId: input.bookingId },
        data: { status: "CANCELLED", cancelReason: input.reason },
      });
    }),

  rescheduleNextCharge: staffProcedure
    .input(z.object({ bookingId: z.string(), nextChargeAt: z.date() }))
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.bookingBillingPlan.update({
        where: { bookingId: input.bookingId },
        data: { nextChargeAt: input.nextChargeAt },
      });
    }),

  // ---------------------------------------------------------------------
  // Refund — thin wrapper reusing the Stripe refund path so the console
  // has a single entry point and reasons get audited the same way.
  // ---------------------------------------------------------------------
  refund: staffProcedure
    .input(
      z.object({
        paymentId: z.string(),
        amount: z.number().positive().optional(),
        reason: z.string().min(1),
      }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
      });
      captureBookingId(ctx, source.bookingId);
      if (source.status !== "SUCCEEDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only SUCCEEDED payments can be refunded.",
        });
      }
      const originalAmount = Number(source.amount);
      const refundAmount = input.amount ?? originalAmount;
      if (refundAmount > originalAmount + 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Refund amount exceeds original charge of A$${originalAmount.toFixed(2)}.`,
        });
      }

      // Stripe refuses refunds on charges older than 180 days with a
      // generic `charge_already_refunded` / `resource_missing` error. Guard
      // early so staff get a clear explanation + the Credit Note route as
      // the recommended fallback. The processedAt / createdAt is our
      // source of truth for charge age (matches what Stripe stored).
      const chargeAt = source.processedAt ?? source.createdAt;
      const daysSince = (Date.now() - chargeAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 180) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Charge is ${Math.floor(daysSince)} days old — Stripe only permits automatic refunds within 180 days. Issue a Credit Note instead and reconcile the funds via bank transfer.`,
        });
      }
      let stripeRefundId: string | null = null;
      let status: "SUCCEEDED" | "FAILED" | "PENDING" = "PENDING";
      try {
        const res = await refundCharge({
          paymentIntentId: source.stripePaymentIntentId,
          chargeId: source.stripeChargeId,
          amountCents: Math.round(refundAmount * 100),
          reason: "requested_by_customer",
          idempotencyKey: `refund-${source.id}-${Math.round(refundAmount * 100)}`,
          metadata: { paymentId: source.id, staffId: ctx.user.id },
        });
        stripeRefundId = res.id;
        status = res.status === "succeeded" ? "SUCCEEDED" : "PENDING";
      } catch {
        status = "FAILED";
      }
      const newSourceStatus =
        refundAmount >= originalAmount - 0.01 ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const refundPayment = await ctx.prisma.$transaction(async (tx) => {
        if (status === "SUCCEEDED") {
          await tx.payment.update({
            where: { id: source.id },
            data: { status: newSourceStatus },
          });
        }
        return tx.payment.create({
          data: {
            reference: `REF-${Date.now()}`,
            customerId: source.customerId,
            bookingId: source.bookingId,
            // Link the refund to the charge it reverses so the rewards
            // aggregator can attribute it to the source PaymentType.
            parentPaymentId: source.id,
            type: "REFUND",
            method: "STRIPE",
            amount: refundAmount,
            // Credit GST proportional to the slice of the source charge being
            // refunded, so the GST/BAS export nets the reversal correctly.
            // (Was hardcoded 0, which overstated GST collected on partial/full
            // refunds of GST-inclusive charges.)
            gstAmount:
              originalAmount > 0
                ? roundCents(times(aud(source.gstAmount), refundAmount / originalAmount))
                : 0,
            status,
            stripeChargeId: stripeRefundId,
            processedAt: status === "SUCCEEDED" ? new Date() : null,
            processedById: ctx.user.id,
            notes: `Refund: ${input.reason}`,
          },
        });
      });

      // Mirror the cancellation / swap / bond-capture protocol: a processed
      // refund produces a GST-compliant adjustment note (DECREASE / REFUND)
      // which auto-emails the customer the document via the same pipeline.
      // Gated on SUCCEEDED — a failed or pending refund hasn't moved money,
      // so issuing a tax credit document would be premature; the retroactive
      // sweep picks up any that land later. Best-effort and non-blocking: we
      // never roll back the refund if the note can't be produced.
      if (status === "SUCCEEDED" && source.bookingId) {
        try {
          const { tryIssueAdjustmentForBooking } = await import(
            "@/server/services/invoice-lifecycle"
          );
          await tryIssueAdjustmentForBooking({
            bookingId: source.bookingId,
            type: "DECREASE",
            reason: "REFUND",
            description: `Refund — ${input.reason}`,
            lineItems: [
              {
                description: `Refund — ${input.reason}`,
                quantity: 1,
                unitPrice: refundAmount,
                totalPrice: refundAmount,
                gstIncluded: true,
              },
            ],
            paymentId: refundPayment.id,
            issuedById: ctx.user.id,
          });
        } catch {
          // tryIssueAdjustmentForBooking already logs internal failures.
        }
      }

      await trackServer({
        event: "payment.refunded",
        distinctId: source.customerId ?? ctx.user.id,
        properties: {
          paymentId: source.id,
          bookingId: source.bookingId,
          refundAud: refundAmount,
          originalAud: originalAmount,
          isPartial: refundAmount < originalAmount,
          status,
          actorUserId: ctx.user.id,
        },
      });

      return refundPayment;
    }),

  /**
   * Bad-debt write-off — the terminal lever for money that will never be
   * collected (dunning stage 5's "write-off proposal" previously dead-ended
   * with no way to act). Managers only. Flips the booking's open charge rows
   * (PENDING/FAILED) to WRITTEN_OFF, zeroes balanceDue (the debtors list and
   * dunning key off it), and issues a DECREASE adjustment note so the ATO
   * paper trail reflects the forgiven consideration.
   */
  writeOffBalance: managerProcedure
    .input(
      z.object({
        bookingId: z.string(),
        reason: z.string().min(5, "A written reason is required for a write-off"),
      }),
    )
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: {
          id: true,
          bookingReference: true,
          customerId: true,
          balanceDue: true,
        },
      });
      const balance = Number(booking.balanceDue);
      if (balance <= 0.009) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nothing to write off — the booking balance is already zero.",
        });
      }

      const writtenOff = await ctx.prisma.$transaction(async (tx) => {
        // Terminal-ise every open charge row so no sweep / retry /
        // reactivation path can resurrect the forgiven debt.
        const rows = await tx.payment.findMany({
          where: {
            bookingId: booking.id,
            status: { in: ["PENDING", "FAILED"] },
            type: { in: [...BALANCE_AFFECTING_CHARGE_TYPES, "BOOKING_PAYMENT"] },
          },
          select: { id: true, notes: true },
        });
        for (const row of rows) {
          await tx.payment.update({
            where: { id: row.id },
            data: {
              status: "WRITTEN_OFF",
              notes: `${row.notes ? `${row.notes}\n` : ""}[written-off] ${input.reason}`,
            },
          });
        }
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            balanceDue: 0,
            bookingNotes: {
              create: {
                userId: ctx.user.id,
                note: `Bad-debt write-off: A$${balance.toFixed(2)} forgiven — ${input.reason}`,
                isInternal: true,
              },
            },
          },
        });
        return { amount: balance, rowsClosed: rows.length };
      });

      // ATO §29-75 decreasing adjustment for the forgiven consideration.
      // Best-effort — the write-off stands even if the document fails.
      try {
        const { tryIssueAdjustmentForBooking } = await import(
          "@/server/services/invoice-lifecycle"
        );
        await tryIssueAdjustmentForBooking({
          bookingId: booking.id,
          type: "DECREASE",
          reason: "OTHER",
          description: `Bad-debt write-off — ${input.reason}`,
          lineItems: [
            {
              description: "Uncollectable balance written off",
              quantity: 1,
              unitPrice: writtenOff.amount,
              totalPrice: writtenOff.amount,
              gstAmount: gstFromInclusive(writtenOff.amount).toNumber(),
              gstIncluded: true,
            },
          ],
          paymentId: null,
          issuedById: ctx.user.id,
        });
      } catch {
        // tryIssueAdjustmentForBooking swallows + logs its own failures.
      }

      await writePaymentAudit(ctx.prisma, {
        action: "payment.balance_written_off",
        entity: "Payment",
        entityId: `booking:${booking.id}`,
        userId: ctx.user.id,
        status: "SUCCESS",
        newData: {
          bookingReference: booking.bookingReference,
          amountAud: writtenOff.amount,
          rowsClosed: writtenOff.rowsClosed,
          reason: input.reason,
        },
      });

      return writtenOff;
    }),
});
