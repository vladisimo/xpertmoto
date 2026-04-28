import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, staffProcedure } from "../trpc";
import { cancelPaymentIntent, refundCharge } from "@/lib/stripe";
import { chargeOffSessionForUser } from "@/server/services/stripe-customer";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { writePaymentEvent } from "@/server/services/payment-events";
import { gstFromInclusive } from "@/lib/money";

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
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { id: true, bookingReference: true, customerId: true, balanceDue: true },
      });
      // GST = total / 11 when inclusive; zero when caller opted out.
      const gst = input.gstInclusive ? gstFromInclusive(input.amount) : 0;
      const payment = await ctx.prisma.payment.create({
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
      await ctx.prisma.booking.update({
        where: { id: b.id },
        data: { balanceDue: Number(b.balanceDue) + input.amount },
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
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        select: { id: true, status: true, amount: true, bookingId: true, reference: true },
      });
      if (p.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only PENDING payments can be voided (this one is ${p.status}).`,
        });
      }
      await ctx.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: p.id },
          data: {
            status: "FAILED",
            notes: `VOIDED by staff: ${input.reason}`,
            processedById: ctx.user.id,
            processedAt: new Date(),
          },
        });
        if (p.bookingId) {
          const current = await tx.booking.findUnique({
            where: { id: p.bookingId },
            select: { balanceDue: true },
          });
          if (current) {
            await tx.booking.update({
              where: { id: p.bookingId },
              data: {
                balanceDue: Math.max(0, Number(current.balanceDue) - Number(p.amount)),
              },
            });
          }
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
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        select: {
          id: true,
          amount: true,
          customerId: true,
          bookingId: true,
          status: true,
          reference: true,
          booking: { select: { bookingReference: true } },
        },
      });
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
      const charge = await chargeOffSessionForUser({
        userId: p.customerId,
        amount: Number(p.amount),
        description: `Manual capture — ${p.reference}`,
        idempotencyKey: `manual-capture-${p.id}`,
        metadata: {
          paymentId: p.id,
          bookingId: p.bookingId ?? "",
          staffId: ctx.user.id,
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
        await ctx.prisma.payment.update({
          where: { id: p.id },
          data: {
            status: "SUCCEEDED",
            stripePaymentIntentId: charge.id,
            stripeChargeId: charge.chargeId ?? null,
            processedAt: new Date(),
            processedById: ctx.user.id,
          },
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
      const held = Number(ledger.heldAmount);
      const captured = Number(ledger.capturedAmount);
      const alreadyReleased = Number(ledger.releasedAmount);
      const remaining = held - captured - alreadyReleased;
      if (input.amount > remaining + 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Bond only has A$${remaining.toFixed(2)} available to capture.`,
        });
      }
      const newCaptured = captured + input.amount;
      const newStatus =
        Math.abs(newCaptured + alreadyReleased - held) < 0.01
          ? "FULLY_CAPTURED"
          : "PARTIALLY_CAPTURED";
      const deductions = Array.isArray(ledger.deductions)
        ? [...(ledger.deductions as Array<{ reason: string; amount: number }>)]
        : [];
      deductions.push({ reason: input.deductionLabel, amount: input.amount });

      const captureResult = await ctx.prisma.$transaction(async (tx) => {
        await tx.bondLedger.update({
          where: { bookingId: input.bookingId },
          data: {
            capturedAmount: newCaptured,
            status: newStatus,
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
            amount: input.amount,
            gstAmount: 0,
            status: "SUCCEEDED",
            processedAt: new Date(),
            processedById: ctx.user.id,
            notes: `Bond capture: ${input.deductionLabel}`,
          },
          select: { id: true },
        });
        return { paymentId: payment.id };
      });
      // Issue an adjustment note for the captured amount so the customer
      // gets the GST-compliant document via the auto-email pipeline. Best
      // effort — sweep job retries any captures that miss the note.
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
              unitPrice: input.amount,
              totalPrice: input.amount,
              gstIncluded: true,
            },
          ],
          paymentId: captureResult.paymentId,
          issuedById: ctx.user.id,
        });
      } catch {
        // tryIssueAdjustmentForBooking already logs internal failures.
      }
      return { capturedAmount: newCaptured, status: newStatus };
    }),

  // ---------------------------------------------------------------------
  // Billing plan controls
  // ---------------------------------------------------------------------
  pauseBillingPlan: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().min(1) }))
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
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.bookingBillingPlan.update({
        where: { bookingId: input.bookingId },
        data: { status: "CANCELLED", cancelReason: input.reason },
      });
    }),

  rescheduleNextCharge: staffProcedure
    .input(z.object({ bookingId: z.string(), nextChargeAt: z.date() }))
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
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
      });
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
      return ctx.prisma.$transaction(async (tx) => {
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
            type: "REFUND",
            method: "STRIPE",
            amount: refundAmount,
            gstAmount: 0,
            status,
            stripeChargeId: stripeRefundId,
            processedAt: status === "SUCCEEDED" ? new Date() : null,
            processedById: ctx.user.id,
            notes: `Refund: ${input.reason}`,
          },
        });
      });
    }),
});
