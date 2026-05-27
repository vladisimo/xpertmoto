import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { createTRPCRouter, staffProcedure, managerProcedure } from "../trpc";
import { isVehicleFree } from "@/server/services/availability";
import { quoteSwapDelta } from "@/server/services/pricing";
import { refundCharge } from "@/lib/stripe";
import { renderSwapAgreementPdf } from "@/lib/pdf/swap-agreement";
import { uploadFile } from "@/lib/storage";
import { sendNotification } from "@/server/services/notification-sender";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { logger } from "@/lib/logger";
import {
  captureBookingId,
  readCapturedBookingId,
  skipAutoAudit,
  writeAudit,
  writeBookingAuditAsync,
  writeCustomerAuditAsync,
} from "@/server/services/audit";
import { generateWorkOrderNumber, generateIncidentNumber, withUniqueRetry } from "@/lib/id-gen";
import { toStoredMarkers, type DamageMarkerInput } from "./inspection";

/**
 * Mid-rental vehicle-swap router.
 *
 * A swap is the in-place replacement of a booking's vehicle without
 * cancelling the booking. It keeps the Stripe payment chain intact
 * (no new bond hold, no new auth) and records the event as a
 * first-class `BookingSwap` row linking the outgoing POST_HIRE and
 * incoming PRE_HIRE inspections, any work order / incident lodged
 * at swap time, and the price adjustment Payment (if any).
 *
 * Two orthogonal dimensions:
 *
 *   - `reason` drives pricing. UPGRADE / DOWNGRADE / LATERAL can
 *     settle a delta between the old and new category rates. Fault,
 *     accident, and operational reasons force zero delta regardless
 *     of the incoming vehicle's spec — the customer didn't choose
 *     the swap, so they don't pay/get refunded for it.
 *   - `origin` is audit-only. A fault reported by a customer phoning
 *     support is (reason=MECHANICAL_FAULT, origin=CUSTOMER_PHONE_SUPPORT)
 *     and still zero-delta.
 *
 * Wizard flow: `startSwapDraft` creates a DRAFT row on wizard entry;
 * staff walks through outgoing inspection, vehicle pick, pricing
 * confirmation, incoming inspection, signatures; `confirmSwap`
 * commits the whole thing in one transaction. Abandoned drafts
 * expire via `voidSwapDraft` (staff action) or a nightly cleanup job.
 */

const SWAP_ALLOWED_STATUSES = ["ACTIVE", "CHECKED_OUT", "OVERDUE"] as const;

// Reason families — keyed off for pricing/workflow decisions.
const NO_DELTA_REASONS = ["MECHANICAL_FAULT", "ACCIDENT_DAMAGE", "OPERATIONAL"] as const;
const REQUIRES_WORK_ORDER = ["MECHANICAL_FAULT", "ACCIDENT_DAMAGE"] as const;
const REQUIRES_MANAGER = [
  "DOWNGRADE",
  "MECHANICAL_FAULT",
  "ACCIDENT_DAMAGE",
] as const;

const HIGH_DELTA_THRESHOLD = 200; // AUD — swaps above this require manager.

const damageMarkerSchema = z.object({
  id: z.string().optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
  note: z.string().optional(),
  source: z.enum(["staff", "customer"]).default("staff"),
  view: z.enum(["LEFT", "RIGHT", "FRONT", "REAR"]).default("LEFT"),
  addedAt: z.string().optional(),
});

const inspectionPayloadSchema = z.object({
  odometerKm: z.number().int().min(0),
  fuelLevel: z.number().int().min(0).max(100),
  overallCondition: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]),
  tyreFrontDepth: z.number().optional(),
  tyreRearDepth: z.number().optional(),
  lightsWorking: z.boolean().default(true),
  hornWorking: z.boolean().default(true),
  indicatorsWorking: z.boolean().default(true),
  engineRunning: z.boolean().default(true),
  lockProvided: z.boolean().default(false),
  notes: z.string().optional(),
  damageMarkers: z.array(damageMarkerSchema).default([]),
});

/**
 * Shape of the wizard's resumable state, persisted to `BookingSwap.draftState`
 * while the swap is in DRAFT. Mirrors the client-side wizard state so a
 * reopened draft rehydrates onto the exact step the author left off at. Kept
 * deliberately lenient — it is replayed into React state, never trusted for
 * the committed write (that still flows through `confirmSwap`'s own schemas).
 */
const swapDraftInspectionSchema = z.object({
  odometerKm: z.string(),
  fuelLevel: z.number(),
  overallCondition: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]),
  notes: z.string(),
  markers: z
    .array(
      z.object({
        id: z.string().optional(),
        x: z.number(),
        y: z.number(),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
        note: z.string().optional(),
        source: z.enum(["staff", "customer"]).optional(),
        view: z.enum(["LEFT", "RIGHT", "FRONT", "REAR"]).optional(),
        addedAt: z.string().optional(),
      }),
    )
    .default([]),
  activeSeverity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
});

const swapDraftStateSchema = z.object({
  step: z.enum(["reason", "outgoing", "select", "incoming", "review"]),
  outgoing: swapDraftInspectionSchema,
  incoming: swapDraftInspectionSchema,
  incomingVehicleId: z.string(),
  includeCrossCategory: z.boolean(),
  customerSignatureUrl: z.string().nullable(),
  staffSignatureUrl: z.string().nullable(),
  incidentSeverity: z.enum(["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"]),
  workOrderPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
});

/** Odometer-rollback guard replicated from `inspectionRouter.create`. */
async function assertNoOdometerRollback(
  tx: Prisma.TransactionClient | PrismaClient,
  vehicleId: string,
  odometerKm: number,
): Promise<void> {
  const latest = await tx.inspection.findFirst({
    where: { vehicleId, status: { not: "DRAFT" } },
    orderBy: { dateTime: "desc" },
    select: { odometerKm: true, dateTime: true },
  });
  if (latest && odometerKm < latest.odometerKm) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Odometer rollback on vehicle — entered ${odometerKm}km, previous reading was ${latest.odometerKm}km on ${latest.dateTime.toISOString().slice(0, 10)}.`,
    });
  }
}

export const bookingSwapRouter = createTRPCRouter({
  /**
   * Candidates for the Swap wizard. Mirrors the guard enforced in
   * `confirmSwap`: currently AVAILABLE + isActive + free for the
   * rental's remaining window. When `includeCrossCategory` is true,
   * returns vehicles from any category (used for fault swaps where
   * the replacement spec doesn't need to match). Otherwise restricted
   * to the booking's current category.
   */
  listCandidates: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        includeCrossCategory: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: {
          status: true,
          vehicleId: true,
          categoryId: true,
          returnDateTime: true,
          pickupDepotId: true,
        },
      });
      const eligible =
        Boolean(b.vehicleId) &&
        (SWAP_ALLOWED_STATUSES as readonly string[]).includes(b.status);
      if (!eligible) {
        return { eligible: false as const, vehicles: [] };
      }
      const remainderStart = new Date();
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: {
          isActive: true,
          status: "AVAILABLE",
          id: { not: b.vehicleId ?? undefined },
          ...(input.includeCrossCategory ? {} : { categoryId: b.categoryId }),
        },
        orderBy: [{ categoryId: "asc" }, { currentOdometerKm: "asc" }],
        select: {
          id: true,
          internalCode: true,
          rego: true,
          make: true,
          model: true,
          year: true,
          colour: true,
          condition: true,
          currentOdometerKm: true,
          regoExpiry: true,
          ctpExpiry: true,
          insuranceExpiry: true,
          categoryId: true,
          category: { select: { id: true, name: true, engineCapacity: true } },
          depot: { select: { name: true } },
          images: {
            select: { url: true, isPrimary: true, displayOrder: true, caption: true },
            orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
          },
        },
      });
      const candidates = await Promise.all(
        vehicles.map(async (v) => {
          const free = await isVehicleFree(ctx.prisma, {
            vehicleId: v.id,
            pickup: remainderStart,
            ret: b.returnDateTime,
          });
          const docsExpiringDuringRental: string[] = [];
          if (v.regoExpiry && v.regoExpiry < b.returnDateTime)
            docsExpiringDuringRental.push("rego");
          if (v.ctpExpiry && v.ctpExpiry < b.returnDateTime)
            docsExpiringDuringRental.push("ctp");
          if (v.insuranceExpiry && v.insuranceExpiry < b.returnDateTime)
            docsExpiringDuringRental.push("insurance");
          return {
            id: v.id,
            internalCode: v.internalCode,
            rego: v.rego,
            make: v.make,
            model: v.model,
            year: v.year,
            colour: v.colour,
            condition: v.condition,
            currentOdometerKm: v.currentOdometerKm,
            categoryId: v.categoryId,
            categoryName: v.category.name,
            engineCapacity: v.category.engineCapacity,
            depotName: v.depot.name,
            images: v.images,
            isSameCategory: v.categoryId === b.categoryId,
            free,
            docsExpiringDuringRental,
          };
        }),
      );
      return { eligible: true as const, vehicles: candidates };
    }),

  /**
   * Live pricing preview for a candidate. Returns NONE direction when
   * same category (no rate difference possible) or when the reason
   * forces zero delta.
   */
  quoteDelta: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        newCategoryId: z.string(),
        reason: z.enum([
          "UPGRADE",
          "DOWNGRADE",
          "LATERAL",
          "MECHANICAL_FAULT",
          "ACCIDENT_DAMAGE",
          "OPERATIONAL",
        ]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { categoryId: true, returnDateTime: true, status: true },
      });
      const zeroDelta = (NO_DELTA_REASONS as readonly string[]).includes(input.reason);
      const sameCategory = b.categoryId === input.newCategoryId;
      const raw = await quoteSwapDelta(ctx.prisma, {
        oldCategoryId: b.categoryId,
        newCategoryId: input.newCategoryId,
        swapAt: new Date(),
        returnDateTime: b.returnDateTime,
      });
      if (zeroDelta || sameCategory) {
        return {
          ...raw,
          deltaAmount: 0,
          gstAmount: 0,
          direction: "NONE" as const,
          forcedZero: zeroDelta ? "reason" : sameCategory ? "same-category" : null,
        };
      }
      return { ...raw, forcedZero: null };
    }),

  /**
   * Open a DRAFT swap when the wizard starts. Presence of a DRAFT row
   * serves as a soft lock — a second `startSwapDraft` call on the
   * same booking rejects until the first is committed or voided.
   */
  startSwapDraft: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        reason: z.enum([
          "UPGRADE",
          "DOWNGRADE",
          "LATERAL",
          "MECHANICAL_FAULT",
          "ACCIDENT_DAMAGE",
          "OPERATIONAL",
        ]),
        origin: z.enum([
          "CUSTOMER_WALK_IN",
          "CUSTOMER_PHONE_SUPPORT",
          "CUSTOMER_SELF_SERVICE",
          "ROADSIDE_ASSIST",
          "STAFF_OBSERVED",
          "TELEMATICS_ALERT",
        ]),
        reasonNotes: z.string().min(1),
        originDetails: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { id: true, status: true, vehicleId: true, customerId: true },
      });
      if (!b.vehicleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking has no assigned vehicle to swap from.",
        });
      }
      if (!(SWAP_ALLOWED_STATUSES as readonly string[]).includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot swap vehicle from status ${b.status}.`,
        });
      }
      // Authorisation: fault/downgrade reasons are manager-only.
      if (
        (REQUIRES_MANAGER as readonly string[]).includes(input.reason) &&
        !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Reason "${input.reason}" requires a manager-role user.`,
        });
      }

      const existing = await ctx.prisma.bookingSwap.findFirst({
        where: { bookingId: b.id, status: "DRAFT" },
        select: { id: true, swappedById: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A swap is already in progress for this booking. Void it first or have the original author complete it.",
        });
      }

      const draft = await ctx.prisma.bookingSwap.create({
        data: {
          bookingId: b.id,
          outgoingVehicleId: b.vehicleId,
          swappedById: ctx.user.id,
          reason: input.reason,
          origin: input.origin,
          reasonNotes: input.reasonNotes,
          originDetails: input.originDetails,
          status: "DRAFT",
        },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_SWAP_DRAFT_STARTED",
        entity: "BookingSwap",
        entityId: draft.id,
        newData: {
          bookingId: b.id,
          reason: input.reason,
          origin: input.origin,
        },
      });
      // Companion row so the swap draft surfaces on the booking's Activity tab.
      writeBookingAuditAsync(ctx.prisma, b.id, {
        userId: ctx.user.id,
        action: "BOOKING_SWAP_DRAFT_STARTED",
        reqId: ctx.reqId,
        newData: { swapId: draft.id, reason: input.reason, origin: input.origin },
      });
      return draft;
    }),

  /**
   * The booking's open DRAFT swap, if any. The wizard calls this on mount to
   * resume an abandoned draft instead of starting fresh — returning the
   * persisted reason fields plus the saved `draftState` so the UI rehydrates
   * onto the step the author left off at. Null when no draft is open.
   */
  activeDraft: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.bookingSwap.findFirst({
        where: { bookingId: input.bookingId, status: "DRAFT" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reason: true,
          origin: true,
          reasonNotes: true,
          originDetails: true,
          draftState: true,
          swappedById: true,
        },
      }),
    ),

  /**
   * Persist the wizard's in-progress state onto an open DRAFT so it survives
   * the staff member closing the tab mid-swap. Updates the reason fields
   * (editable until commit) and the `draftState` blob. Author-or-manager only,
   * and only while still a DRAFT — committed/voided swaps are immutable here.
   * Transient bookkeeping, so no audit row.
   */
  saveDraftProgress: staffProcedure
    .input(
      z.object({
        swapId: z.string(),
        reason: z
          .enum([
            "UPGRADE",
            "DOWNGRADE",
            "LATERAL",
            "MECHANICAL_FAULT",
            "ACCIDENT_DAMAGE",
            "OPERATIONAL",
          ])
          .optional(),
        origin: z
          .enum([
            "CUSTOMER_WALK_IN",
            "CUSTOMER_PHONE_SUPPORT",
            "CUSTOMER_SELF_SERVICE",
            "ROADSIDE_ASSIST",
            "STAFF_OBSERVED",
            "TELEMATICS_ALERT",
          ])
          .optional(),
        reasonNotes: z.string().min(1).optional(),
        originDetails: z.string().nullable().optional(),
        draftState: swapDraftStateSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const draft = await ctx.prisma.bookingSwap.findUniqueOrThrow({
        where: { id: input.swapId },
        select: { id: true, status: true, swappedById: true },
      });
      if (draft.status !== "DRAFT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot edit swap in status ${draft.status}.`,
        });
      }
      if (
        draft.swappedById !== ctx.user.id &&
        !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the author or a manager can edit this draft.",
        });
      }
      return ctx.prisma.bookingSwap.update({
        where: { id: draft.id },
        data: {
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
          ...(input.reasonNotes !== undefined ? { reasonNotes: input.reasonNotes } : {}),
          ...(input.originDetails !== undefined ? { originDetails: input.originDetails } : {}),
          ...(input.draftState !== undefined
            ? { draftState: input.draftState as Prisma.InputJsonValue }
            : {}),
        },
      });
    }),

  /**
   * Commit the swap. Single transaction: creates outgoing/incoming
   * inspections, reassigns the vehicle, updates vehicle statuses,
   * creates work order (fault), incident (accident), Payment delta
   * row (charge or refund), and generates the swap agreement PDF
   * outside the txn (non-critical).
   */
  confirmSwap: staffProcedure
    .input(
      z.object({
        swapId: z.string(),
        incomingVehicleId: z.string(),
        outgoingInspection: inspectionPayloadSchema,
        incomingInspection: inspectionPayloadSchema,
        // Accepts storage URL or a `data:image/...` data-URL; the inspection
        // row just stores whichever string the caller supplies.
        customerSignatureUrl: z.string().min(1).optional(),
        staffSignatureUrl: z.string().min(1).optional(),
        // Manager override for the pricing delta; if omitted we use the
        // freshly recomputed quote. Validated against the recomputed
        // value below — small drift allowed (5¢) without escalation.
        priceAdjustmentOverride: z.number().optional(),
        // For ACCIDENT_DAMAGE, staff pick severity of the incident.
        incidentSeverity: z.enum(["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"]).optional(),
        // For MECHANICAL_FAULT, work-order priority; defaults to HIGH.
        workOrderPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("HIGH"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);

      const draft = await ctx.prisma.bookingSwap.findUnique({
        where: { id: input.swapId },
      });
      if (!draft || draft.status !== "DRAFT") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Swap draft not found or already committed.",
        });
      }
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: draft.bookingId },
        include: {
          category: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          bondLedger: true,
          payments: {
            where: { type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
            orderBy: { processedAt: "desc" },
            take: 1,
          },
          billingPlan: { select: { id: true } },
          pickupDepot: { select: { slug: true } },
        },
      });
      if (!(SWAP_ALLOWED_STATUSES as readonly string[]).includes(booking.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot commit swap — booking is now ${booking.status}.`,
        });
      }
      if (!booking.vehicleId || booking.vehicleId !== draft.outgoingVehicleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Booking's current vehicle no longer matches the swap draft. Start a new swap.",
        });
      }
      if (input.incomingVehicleId === booking.vehicleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Incoming vehicle is the same as the current vehicle.",
        });
      }

      const incomingVehicle = await ctx.prisma.vehicle.findUniqueOrThrow({
        where: { id: input.incomingVehicleId },
        include: { category: true },
      });
      if (!incomingVehicle.isActive || incomingVehicle.status !== "AVAILABLE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Replacement vehicle ${incomingVehicle.internalCode} is not available (status ${incomingVehicle.status}).`,
        });
      }
      const free = await isVehicleFree(ctx.prisma, {
        vehicleId: incomingVehicle.id,
        pickup: new Date(),
        ret: booking.returnDateTime,
      });
      if (!free) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Replacement vehicle ${incomingVehicle.internalCode} has a conflicting booking or work order for the remainder of this rental.`,
        });
      }

      // Cross-category guard: fault reasons allow any category, spec-change
      // reasons are what actually change category. LATERAL must be same
      // category.
      const categoryChanged = incomingVehicle.categoryId !== booking.categoryId;
      if (draft.reason === "LATERAL" && categoryChanged) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "LATERAL swap must stay within the same category.",
        });
      }
      if (draft.reason === "UPGRADE" && !categoryChanged) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "UPGRADE must change category; use LATERAL for same-category swaps.",
        });
      }
      if (draft.reason === "DOWNGRADE" && !categoryChanged) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "DOWNGRADE must change category.",
        });
      }
      if (draft.reason === "ACCIDENT_DAMAGE" && !input.incidentSeverity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "incidentSeverity is required for ACCIDENT_DAMAGE swaps.",
        });
      }

      // Re-quote pricing at commit time. Zero out if reason forces it or
      // if same category. Override is allowed for managers only, within 5¢.
      const zeroDelta = (NO_DELTA_REASONS as readonly string[]).includes(draft.reason);
      const quote = await quoteSwapDelta(ctx.prisma, {
        oldCategoryId: booking.categoryId,
        newCategoryId: incomingVehicle.categoryId,
        swapAt: new Date(),
        returnDateTime: booking.returnDateTime,
      });
      let deltaAmount = zeroDelta || !categoryChanged ? 0 : quote.deltaAmount;
      let gstAmount = zeroDelta || !categoryChanged ? 0 : quote.gstAmount;

      if (input.priceAdjustmentOverride !== undefined) {
        if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only managers can override the computed price delta.",
          });
        }
        if (Math.abs(input.priceAdjustmentOverride - deltaAmount) > 0.05) {
          // Manager is setting a different value — accept it explicitly.
          deltaAmount = input.priceAdjustmentOverride;
          // GST: still 1/11 of the absolute delta for display.
          gstAmount = Math.round((Math.abs(deltaAmount) / 11) * 100) / 100;
        }
      }

      // High-delta gate: require manager for any non-zero delta above
      // threshold, or when a billingPlan is attached (progressive-billing
      // hires need manager sign-off regardless).
      const needsManager =
        (Math.abs(deltaAmount) >= HIGH_DELTA_THRESHOLD ||
          booking.billingPlan !== null) &&
        !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role);
      if (needsManager) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This swap (delta A$${deltaAmount.toFixed(2)}${booking.billingPlan ? " + billing plan" : ""}) requires a manager to confirm.`,
        });
      }

      // Odometer rollback guards before we open the transaction.
      await assertNoOdometerRollback(
        ctx.prisma,
        booking.vehicleId,
        input.outgoingInspection.odometerKm,
      );
      await assertNoOdometerRollback(
        ctx.prisma,
        incomingVehicle.id,
        input.incomingInspection.odometerKm,
      );

      const outgoingVehicleId = booking.vehicleId;
      const direction: "NONE" | "CHARGE" | "REFUND" =
        Math.abs(deltaAmount) < 0.005
          ? "NONE"
          : deltaAmount > 0
            ? "CHARGE"
            : "REFUND";
      const absDelta = Math.abs(deltaAmount);
      const outgoingMarkers = toStoredMarkers(
        input.outgoingInspection.damageMarkers as DamageMarkerInput[],
      );
      const incomingMarkers = toStoredMarkers(
        input.incomingInspection.damageMarkers as DamageMarkerInput[],
      );

      // Pre-compute bond variance note (we leave the bond hold untouched).
      const newBondAmount = Number(incomingVehicle.category.bondAmount);
      const oldBondAmount = Number(booking.category.bondAmount);
      const bondVariance = newBondAmount - oldBondAmount;
      const bondLedger = booking.bondLedger;

      // Stripe refund happens BEFORE the DB transaction so a refund
      // failure doesn't leave DB state inconsistent. Charge rows are
      // created PENDING and captured by G5 off-session.
      let refundPaymentData:
        | {
            stripeChargeId: string | null;
            status: "SUCCEEDED" | "FAILED" | "PENDING";
          }
        | null = null;
      let fallbackToCredit = false;
      if (direction === "REFUND") {
        const sourcePayment = booking.payments[0];
        if (!sourcePayment) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No SUCCEEDED booking payment found to refund against. Contact finance.",
          });
        }
        const chargeAt = sourcePayment.processedAt ?? sourcePayment.createdAt;
        const daysSince = (Date.now() - chargeAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 180) {
          fallbackToCredit = true;
        } else if (Number(sourcePayment.amount) < absDelta - 0.01) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Refund A$${absDelta.toFixed(2)} exceeds original charge A$${Number(sourcePayment.amount).toFixed(2)}.`,
          });
        } else {
          try {
            const res = await refundCharge({
              paymentIntentId: sourcePayment.stripePaymentIntentId,
              chargeId: sourcePayment.stripeChargeId,
              amountCents: Math.round(absDelta * 100),
              reason: "requested_by_customer",
              idempotencyKey: `swap-refund-${draft.id}`,
              metadata: { swapId: draft.id, paymentId: sourcePayment.id, staffId: ctx.user.id },
            });
            refundPaymentData = {
              stripeChargeId: res.id,
              status: res.status === "succeeded" ? "SUCCEEDED" : "PENDING",
            };
          } catch {
            refundPaymentData = {
              stripeChargeId: null,
              status: "FAILED",
            };
          }
        }
      }

      const result = await ctx.prisma.$transaction(async (tx) => {
        // Re-check availability inside the transaction to close the
        // race window between pre-flight and commit.
        const freeNow = await isVehicleFree(tx, {
          vehicleId: incomingVehicle.id,
          pickup: new Date(),
          ret: booking.returnDateTime,
        });
        if (!freeNow) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Replacement vehicle was taken by another booking or work order while you were confirming.",
          });
        }

        // 1. Outgoing POST_HIRE inspection (purpose=SWAP_OUT).
        const outgoingInspection = await tx.inspection.create({
          data: {
            vehicleId: outgoingVehicleId,
            bookingId: booking.id,
            type: "POST_HIRE",
            purpose: "SWAP_OUT",
            depotId: incomingVehicle.depotId,
            inspectorId: ctx.user.id,
            odometerKm: input.outgoingInspection.odometerKm,
            fuelLevel: input.outgoingInspection.fuelLevel,
            overallCondition: input.outgoingInspection.overallCondition,
            tyreFrontDepth: input.outgoingInspection.tyreFrontDepth,
            tyreRearDepth: input.outgoingInspection.tyreRearDepth,
            lightsWorking: input.outgoingInspection.lightsWorking,
            hornWorking: input.outgoingInspection.hornWorking,
            indicatorsWorking: input.outgoingInspection.indicatorsWorking,
            engineRunning: input.outgoingInspection.engineRunning,
            lockProvided: input.outgoingInspection.lockProvided,
            notes: input.outgoingInspection.notes,
            customerSignatureUrl: input.customerSignatureUrl,
            staffSignatureUrl: input.staffSignatureUrl,
            bodyDamageMap: { markers: outgoingMarkers } as unknown as Prisma.InputJsonValue,
            status: "COMPLETED",
          },
        });

        // 2. Incoming PRE_HIRE inspection (purpose=SWAP_IN).
        const incomingInspection = await tx.inspection.create({
          data: {
            vehicleId: incomingVehicle.id,
            bookingId: booking.id,
            type: "PRE_HIRE",
            purpose: "SWAP_IN",
            depotId: incomingVehicle.depotId,
            inspectorId: ctx.user.id,
            odometerKm: input.incomingInspection.odometerKm,
            fuelLevel: input.incomingInspection.fuelLevel,
            overallCondition: input.incomingInspection.overallCondition,
            tyreFrontDepth: input.incomingInspection.tyreFrontDepth,
            tyreRearDepth: input.incomingInspection.tyreRearDepth,
            lightsWorking: input.incomingInspection.lightsWorking,
            hornWorking: input.incomingInspection.hornWorking,
            indicatorsWorking: input.incomingInspection.indicatorsWorking,
            engineRunning: input.incomingInspection.engineRunning,
            lockProvided: input.incomingInspection.lockProvided,
            notes: input.incomingInspection.notes,
            customerSignatureUrl: input.customerSignatureUrl,
            staffSignatureUrl: input.staffSignatureUrl,
            bodyDamageMap: { markers: incomingMarkers } as unknown as Prisma.InputJsonValue,
            status: "COMPLETED",
          },
        });

        // 3. Vehicle odometer hand-off: outgoing POST_HIRE km becomes
        // the outgoing vehicle's current, incoming PRE_HIRE km becomes
        // the incoming vehicle's current (may be a correction from a
        // prior drift).
        await tx.vehicle.update({
          where: { id: outgoingVehicleId },
          data: { currentOdometerKm: input.outgoingInspection.odometerKm },
        });
        await tx.vehicle.update({
          where: { id: incomingVehicle.id },
          data: { currentOdometerKm: input.incomingInspection.odometerKm },
        });

        // 4. Vehicle status transitions + logs.
        const outgoingNextStatus = (REQUIRES_WORK_ORDER as readonly string[]).includes(
          draft.reason,
        )
          ? "IN_MAINTENANCE"
          : "AVAILABLE";
        await tx.vehicle.update({
          where: { id: outgoingVehicleId },
          data: {
            status: outgoingNextStatus,
            statusLog: {
              create: {
                previousStatus: "RENTED",
                newStatus: outgoingNextStatus,
                changedById: ctx.user.id,
                reason: `Swapped off ${booking.bookingReference}: ${draft.reason}`,
              },
            },
          },
        });
        await tx.vehicle.update({
          where: { id: incomingVehicle.id },
          data: {
            status: "RENTED",
            statusLog: {
              create: {
                previousStatus: "AVAILABLE",
                newStatus: "RENTED",
                changedById: ctx.user.id,
                reason: `Swapped onto ${booking.bookingReference}: ${draft.reason}`,
              },
            },
          },
        });

        // 5. Booking vehicle reassignment + booking log + note.
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            vehicleId: incomingVehicle.id,
            bookingNotes: {
              create: {
                userId: ctx.user.id,
                note: `Vehicle swapped → ${incomingVehicle.internalCode} (${incomingVehicle.rego}). Reason: ${draft.reason} — ${draft.reasonNotes}. Origin: ${draft.origin}${draft.originDetails ? ` (${draft.originDetails})` : ""}.${direction !== "NONE" ? ` Price adjustment: ${direction} A$${absDelta.toFixed(2)}.` : ""}`,
                isInternal: false,
              },
            },
            statusLog: {
              create: {
                previousStatus: booking.status,
                newStatus: booking.status,
                changedById: ctx.user.id,
                reason: `Vehicle swap ${outgoingVehicleId} → ${incomingVehicle.id}: ${draft.reason}`,
              },
            },
          },
        });

        // 6. Work order on fault. Includes origin in notes so the
        // repair shop sees the customer's description verbatim.
        let workOrderId: string | null = null;
        if ((REQUIRES_WORK_ORDER as readonly string[]).includes(draft.reason)) {
          const wo = await withUniqueRetry(
            () =>
              tx.maintenanceWorkOrder.create({
                data: {
                  workOrderNumber: generateWorkOrderNumber(),
                  vehicleId: outgoingVehicleId,
                  depotId: incomingVehicle.depotId,
                  type: "CUSTOM",
                  priority: input.workOrderPriority,
                  title:
                    draft.reason === "ACCIDENT_DAMAGE"
                      ? `Accident damage — ${booking.bookingReference}`
                      : `Fault reported mid-rental — ${booking.bookingReference}`,
                  description: `${draft.reasonNotes}\n\nReported via: ${draft.origin}${draft.originDetails ? ` — ${draft.originDetails}` : ""}\nBooking: ${booking.bookingReference}`,
                  reportedById: ctx.user.id,
                  relatedInspectionId: outgoingInspection.id,
                  logs: {
                    create: {
                      action: "OPEN",
                      performedById: ctx.user.id,
                      notes: `Opened from mid-rental swap ${draft.id}`,
                    },
                  },
                },
              }),
            { constraintFields: ["workOrderNumber"] },
          );
          workOrderId = wo.id;
        }

        // 7. Incident on accident. `customerLiable` left at default
        // (false); staff adjust later from the incident detail page.
        let incidentId: string | null = null;
        if (draft.reason === "ACCIDENT_DAMAGE" && input.incidentSeverity) {
          const customerChannels: Array<typeof draft.origin> = [
            "CUSTOMER_PHONE_SUPPORT",
            "CUSTOMER_SELF_SERVICE",
            "ROADSIDE_ASSIST",
          ];
          const inc = await withUniqueRetry(
            () =>
              tx.incident.create({
                data: {
                  incidentNumber: generateIncidentNumber(),
                  vehicleId: outgoingVehicleId,
                  bookingId: booking.id,
                  customerId: booking.customerId,
                  type: "ACCIDENT",
                  severity: input.incidentSeverity!,
                  dateTime: new Date(),
                  description: draft.reasonNotes,
                  reportedById: ctx.user.id,
                  thirdPartyDetails: customerChannels.includes(draft.origin)
                    ? ({
                        reportingChannel: draft.origin,
                        details: draft.originDetails ?? null,
                      } as unknown as Prisma.InputJsonValue)
                    : undefined,
                },
              }),
            { constraintFields: ["incidentNumber"] },
          );
          incidentId = inc.id;
        }

        // 8. Pricing delta settlement.
        let paymentId: string | null = null;
        if (direction === "CHARGE") {
          const p = await tx.payment.create({
            data: {
              reference: `SWAP-${draft.id}`,
              customerId: booking.customerId,
              bookingId: booking.id,
              type: "SWAP_ADJUSTMENT",
              method: "STRIPE",
              amount: absDelta,
              gstAmount,
              status: "PENDING",
              processedById: ctx.user.id,
              notes: `Swap ${draft.reason}: ${incomingVehicle.category.name} remainder upcharge.`,
            },
          });
          paymentId = p.id;
        } else if (direction === "REFUND") {
          if (fallbackToCredit) {
            // >180d — record as MANUAL_CREDIT so the ledger reflects
            // intent; manager reconciles via bank transfer.
            const p = await tx.payment.create({
              data: {
                reference: `SWAP-CREDIT-${draft.id}`,
                customerId: booking.customerId,
                bookingId: booking.id,
                type: "MANUAL_CREDIT",
                method: "BANK_TRANSFER",
                amount: absDelta,
                gstAmount,
                status: "PENDING",
                processedById: ctx.user.id,
                notes: `Swap DOWNGRADE refund >180d: needs manual reconcile via credit note / bank transfer.`,
              },
            });
            paymentId = p.id;
          } else if (refundPaymentData) {
            const p = await tx.payment.create({
              data: {
                reference: `SWAP-REF-${draft.id}`,
                customerId: booking.customerId,
                bookingId: booking.id,
                type: "REFUND",
                method: "STRIPE",
                amount: absDelta,
                gstAmount,
                status: refundPaymentData.status,
                stripeChargeId: refundPaymentData.stripeChargeId,
                processedAt: refundPaymentData.status === "SUCCEEDED" ? new Date() : null,
                processedById: ctx.user.id,
                notes: `Swap DOWNGRADE refund: ${draft.reasonNotes}`,
              },
            });
            paymentId = p.id;
            // Update source Payment's rollup status.
            if (refundPaymentData.status === "SUCCEEDED") {
              const source = booking.payments[0];
              if (source) {
                const newStatus =
                  absDelta >= Number(source.amount) - 0.01
                    ? "REFUNDED"
                    : "PARTIALLY_REFUNDED";
                await tx.payment.update({
                  where: { id: source.id },
                  data: { status: newStatus },
                });
              }
            }
          }
        }

        // 9. Bond variance — do not resize the Stripe hold. Record the
        // difference in BondLedger.deductions for audit.
        if (bondLedger && Math.abs(bondVariance) > 0.005) {
          const prior =
            (bondLedger.deductions as unknown as Array<Record<string, unknown>>) ??
            [];
          const next = [
            ...prior,
            {
              reason: "bond_variance_acknowledged",
              swapId: draft.id,
              oldBondAmount,
              newBondAmount,
              variance: bondVariance,
              note: "Bond hold kept at original amount across swap; variance recorded for audit only.",
            },
          ];
          await tx.bondLedger.update({
            where: { id: bondLedger.id },
            data: {
              deductions: next as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // 10. Commit the BookingSwap row.
        const committed = await tx.bookingSwap.update({
          where: { id: draft.id },
          data: {
            incomingVehicleId: incomingVehicle.id,
            swappedAt: new Date(),
            priceAdjustmentAmount: absDelta,
            priceAdjustmentGst: gstAmount,
            priceAdjustmentDirection: direction,
            paymentId,
            outgoingInspectionId: outgoingInspection.id,
            incomingInspectionId: incomingInspection.id,
            workOrderId,
            incidentId,
            customerSignatureUrl: input.customerSignatureUrl,
            staffSignatureUrl: input.staffSignatureUrl,
            bondVarianceAmount: Math.abs(bondVariance) > 0.005 ? bondVariance : null,
            status: "COMMITTED",
          },
        });

        return { committed, outgoingInspection, incomingInspection, paymentId, direction, absDelta, gstAmount };
      });

      // Issue an ATO §29-75 adjustment note for the swap pricing delta.
      // CHARGE → INCREASE adjustment; REFUND (via Stripe or credit) →
      // DECREASE adjustment. Zero-delta swaps (operational / fault) skip
      // issuance — there's no consideration change.
      if (result.direction !== "NONE" && result.absDelta > 0.005) {
        try {
          const { tryIssueAdjustmentForBooking } = await import(
            "@/server/services/invoice-lifecycle"
          );
          const isRefund = result.direction === "REFUND";
          await tryIssueAdjustmentForBooking({
            bookingId: booking.id,
            type: isRefund ? "DECREASE" : "INCREASE",
            reason: "SWAP",
            description: `Vehicle swap — ${draft.reason.toLowerCase().replace(/_/g, " ")}${
              isRefund ? " (downgrade refund)" : " (upgrade charge)"
            }`,
            lineItems: [
              {
                description: `Swap from ${booking.category.name} to ${incomingVehicle.category.name}`,
                detail: draft.reasonNotes,
                quantity: 1,
                unitPrice: result.absDelta,
                totalPrice: result.absDelta,
                gstAmount: Number(result.gstAmount),
                gstIncluded: true,
              },
            ],
            paymentId: result.paymentId,
            issuedById: ctx.user.id,
          });
        } catch {
          // tryIssueAdjustmentForBooking already logs.
        }
      }

      // Audit logs (outside the transaction — failure here doesn't
      // roll back the swap; audit writing is best-effort).
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_VEHICLE_SWAPPED",
        entity: "Booking",
        entityId: booking.id,
        previousData: {
          vehicleId: outgoingVehicleId,
          categoryId: booking.categoryId,
        },
        newData: {
          swapId: draft.id,
          vehicleId: incomingVehicle.id,
          categoryId: incomingVehicle.categoryId,
          reason: draft.reason,
          origin: draft.origin,
          direction,
          deltaAmount: absDelta,
        },
      });
      writeCustomerAuditAsync(ctx.prisma, booking.customerId, {
        userId: ctx.user.id,
        action: "BOOKING_VEHICLE_SWAPPED",
        reqId: ctx.reqId,
        previousData: { bookingId: booking.id, vehicleId: outgoingVehicleId },
        newData: {
          bookingId: booking.id,
          reference: booking.bookingReference,
          swapId: draft.id,
          vehicleId: incomingVehicle.id,
          reason: draft.reason,
          direction,
          deltaAmount: absDelta,
        },
      });

      // Render the signed swap agreement PDF and persist the URL on the
      // BookingSwap row. Failures here don't roll back the swap — the swap
      // is committed; staff can regenerate the PDF from the history page.
      try {
        const [outgoingVehicleFull, staffUser, workOrder, incident] = await Promise.all([
          ctx.prisma.vehicle.findUniqueOrThrow({
            where: { id: outgoingVehicleId },
            select: { internalCode: true, rego: true, make: true, model: true },
          }),
          ctx.prisma.user.findUnique({
            where: { id: ctx.user.id },
            select: { firstName: true, lastName: true },
          }),
          result.committed.workOrderId
            ? ctx.prisma.maintenanceWorkOrder.findUnique({
                where: { id: result.committed.workOrderId },
                select: { workOrderNumber: true },
              })
            : Promise.resolve(null),
          result.committed.incidentId
            ? ctx.prisma.incident.findUnique({
                where: { id: result.committed.incidentId },
                select: { incidentNumber: true },
              })
            : Promise.resolve(null),
        ]);
        const pdf = await renderSwapAgreementPdf({
          swapId: result.committed.id,
          swappedAt: result.committed.swappedAt,
          reason: draft.reason,
          origin: draft.origin,
          reasonNotes: draft.reasonNotes,
          originDetails: draft.originDetails,
          priceAdjustment: { direction, amount: absDelta, gst: gstAmount },
          bondVariance: Math.abs(bondVariance) > 0.005 ? bondVariance : null,
          booking: {
            bookingReference: booking.bookingReference,
            pickupDateTime: booking.pickupDateTime,
            returnDateTime: booking.returnDateTime,
            customer: booking.customer,
          },
          outgoing: {
            ...outgoingVehicleFull,
            categoryName: booking.category.name,
            odometerKm: input.outgoingInspection.odometerKm,
            fuelLevel: input.outgoingInspection.fuelLevel,
            overallCondition: input.outgoingInspection.overallCondition,
            notes: input.outgoingInspection.notes ?? null,
          },
          incoming: {
            internalCode: incomingVehicle.internalCode,
            rego: incomingVehicle.rego,
            make: incomingVehicle.make,
            model: incomingVehicle.model,
            categoryName: incomingVehicle.category.name,
            odometerKm: input.incomingInspection.odometerKm,
            fuelLevel: input.incomingInspection.fuelLevel,
            overallCondition: input.incomingInspection.overallCondition,
            notes: input.incomingInspection.notes ?? null,
          },
          workOrderNumber: workOrder?.workOrderNumber ?? null,
          incidentNumber: incident?.incidentNumber ?? null,
          customerSignatureUrl: input.customerSignatureUrl ?? null,
          staffSignatureUrl: input.staffSignatureUrl ?? null,
          staffName: staffUser ? `${staffUser.firstName} ${staffUser.lastName}` : "Staff",
        });
        const uploaded = await uploadFile({
          folder: "swap-agreements",
          filename: `${booking.bookingReference}-${result.committed.id}.pdf`,
          contentType: "application/pdf",
          body: pdf,
        });
        await ctx.prisma.bookingSwap.update({
          where: { id: result.committed.id },
          data: { documentUrl: uploaded.url },
        });
      } catch (err) {
        logger.warn(
          { swapId: result.committed.id, err: err instanceof Error ? err.message : String(err) },
          "swap agreement PDF render/upload failed — swap committed, will need manual regenerate",
        );
      }

      // Notify depot managers when a fault/accident swap lodges a work order
      // or incident — mirrors fleet.createIncident's broadcast pattern so the
      // maintenance queue sees the same push they'd get from a direct report.
      if (result.committed.workOrderId || result.committed.incidentId) {
        const managers = await ctx.prisma.user.findMany({
          where: {
            role: { in: ["MANAGER", "ADMIN"] },
            deletedAt: null,
            OR: [{ depotId: incomingVehicle.depotId }, { depotId: null }],
          },
          select: { id: true },
        });
        const isAccident = draft.reason === "ACCIDENT_DAMAGE";
        const notifType = isAccident ? "INCIDENT_REPORTED" : "WORK_ORDER_ASSIGNED";
        const subject = isAccident
          ? `Accident swap on booking ${booking.bookingReference}`
          : `Fault swap on booking ${booking.bookingReference}`;
        const body = `${draft.reason.replace(/_/g, " ")} on the outgoing vehicle during a mid-rental swap. ${draft.reasonNotes}${draft.originDetails ? `\n\nOrigin: ${draft.origin} — ${draft.originDetails}` : `\n\nOrigin: ${draft.origin}`}`;
        for (const m of managers) {
          await sendNotification({
            userId: m.id,
            type: notifType,
            category: "OPERATIONAL",
            channels: ["IN_APP", "EMAIL"],
            subject,
            title: subject,
            body,
            data: {
              swapId: result.committed.id,
              bookingId: booking.id,
              workOrderId: result.committed.workOrderId,
              incidentId: result.committed.incidentId,
              reason: draft.reason,
              origin: draft.origin,
            },
            sentById: ctx.user.id,
            dedupKey: `swap-fault:${result.committed.id}:${m.id}`,
          });
        }
      }

      // Customer notification — render the dedicated VehicleSwap email so
      // the customer gets the same branded look as every other booking
      // event. Any GST adjustment note is delivered separately by the
      // adjustment-note auto-email.
      const { default: VehicleSwapEmail } = await import(
        "../../../../emails/vehicle-swap"
      );
      const { render: renderEmail } = await import("@react-email/render");
      const { createElement } = await import("react");
      const { formatCurrency } = await import("@/lib/utils");
      const swapHtml = await renderEmail(
        createElement(VehicleSwapEmail, {
          customerName: booking.customer.firstName,
          bookingReference: booking.bookingReference,
          incomingVehicleLabel: `${incomingVehicle.make} ${incomingVehicle.model} (${incomingVehicle.rego})`,
          reason: draft.reason.replace(/_/g, " ").toLowerCase(),
          direction,
          deltaAmount: direction === "NONE" ? null : formatCurrency(absDelta),
          gstAmount: direction === "NONE" ? null : formatCurrency(gstAmount),
          refundFallbackToCredit: fallbackToCredit,
        }),
      );
      const deltaLine =
        direction === "NONE"
          ? "No price change."
          : direction === "CHARGE"
            ? `Additional charge: ${formatCurrency(absDelta)} (GST ${formatCurrency(gstAmount)}) will be taken from your stored payment method.`
            : `Refund: ${formatCurrency(absDelta)} (GST ${formatCurrency(gstAmount)})${fallbackToCredit ? " to be reconciled by our finance team" : " returning to your original payment method"}.`;
      await sendNotification({
        userId: booking.customerId,
        type: "BOOKING_MODIFIED",
        category: "TRANSACTIONAL",
        channels: ["EMAIL", "SMS"],
        subject: `Vehicle swapped on booking ${booking.bookingReference}`,
        title: "Your vehicle has been swapped",
        body: `Hi ${booking.customer.firstName}, your booking ${booking.bookingReference} has been moved to ${incomingVehicle.make} ${incomingVehicle.model} (${incomingVehicle.rego}). Reason: ${draft.reason.replace(/_/g, " ").toLowerCase()}. ${deltaLine}`,
        html: swapHtml,
        templateKey: "vehicle-swap",
        bookingId: booking.id,
        data: {
          bookingReference: booking.bookingReference,
          swapId: draft.id,
          reason: draft.reason,
          direction,
          deltaAmount: absDelta,
        },
        sentById: ctx.user.id,
        dedupKey: `swap-confirmed:${draft.id}`,
      });

      await trackServer({
        event: SERVER_EVENTS.bookingSwapConfirmed,
        distinctId: booking.customerId,
        properties: {
          bookingId: booking.id,
          reference: booking.bookingReference,
          swapId: draft.id,
          reason: draft.reason,
          incomingVehicleId: input.incomingVehicleId,
          direction,
          deltaAmountAud: absDelta,
          gstAmountAud: gstAmount,
          actorUserId: ctx.user.id,
        },
        groups: { depot: booking.pickupDepot.slug },
      });

      return { swap: result.committed, direction, deltaAmount: absDelta, gstAmount };
    }),

  /**
   * Void an abandoned DRAFT. Any staff member who started the draft
   * or a manager can void it. Committed swaps can never be voided
   * (use a second swap to reverse).
   */
  voidSwapDraft: staffProcedure
    .input(z.object({ swapId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const draft = await ctx.prisma.bookingSwap.findUniqueOrThrow({
        where: { id: input.swapId },
      });
      if (draft.status !== "DRAFT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot void swap in status ${draft.status}.`,
        });
      }
      if (
        draft.swappedById !== ctx.user.id &&
        !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the author or a manager can void this draft.",
        });
      }
      const voided = await ctx.prisma.bookingSwap.update({
        where: { id: draft.id },
        data: {
          status: "VOIDED",
          reasonNotes:
            draft.reasonNotes +
            (input.reason ? `\n\n[VOIDED: ${input.reason}]` : "\n\n[VOIDED]"),
        },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_SWAP_VOIDED",
        entity: "BookingSwap",
        entityId: draft.id,
        previousData: { status: "DRAFT" },
        newData: { status: "VOIDED", reason: input.reason },
      });
      // Companion row so the void surfaces on the booking's Activity tab.
      writeBookingAuditAsync(ctx.prisma, draft.bookingId, {
        userId: ctx.user.id,
        action: "BOOKING_SWAP_VOIDED",
        reqId: ctx.reqId,
        newData: { swapId: draft.id, reason: input.reason },
      });
      return voided;
    }),

  /**
   * Manager-level reconciliation: mark a fallback MANUAL_CREDIT swap
   * payment as SUCCEEDED once the bank transfer has been made. Parallel
   * to the settlement-refund flow for downgrades older than 180 days.
   */
  reconcileCreditTransfer: managerProcedure
    .input(z.object({ paymentId: z.string(), reference: z.string().min(1) }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
      });
      captureBookingId(ctx, p.bookingId);
      if (p.type !== "MANUAL_CREDIT" || p.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only PENDING MANUAL_CREDIT payments can be reconciled here.",
        });
      }
      return ctx.prisma.payment.update({
        where: { id: p.id },
        data: {
          status: "SUCCEEDED",
          processedAt: new Date(),
          processedById: ctx.user.id,
          notes: `${p.notes ?? ""}\nReconciled via bank transfer ref ${input.reference} by ${ctx.user.id}.`,
        },
      });
    }),

  /** Swap history for a booking, for the booking-detail Activity tab. */
  listForBooking: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.bookingSwap.findMany({
        where: { bookingId: input.bookingId, status: { not: "VOIDED" } },
        orderBy: { swappedAt: "desc" },
        include: {
          outgoingVehicle: { select: { id: true, internalCode: true, rego: true } },
          incomingVehicle: { select: { id: true, internalCode: true, rego: true } },
          outgoingInspection: { select: { id: true } },
          incomingInspection: { select: { id: true } },
          workOrder: { select: { id: true, workOrderNumber: true, status: true } },
          incident: { select: { id: true, incidentNumber: true, status: true } },
          payment: { select: { id: true, reference: true, status: true, amount: true, type: true } },
          swappedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ),

  /** Fetch a single swap for review / PDF rendering. */
  byId: staffProcedure
    .input(z.object({ swapId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.bookingSwap.findUnique({
        where: { id: input.swapId },
        include: {
          booking: {
            include: {
              customer: { select: { id: true, firstName: true, lastName: true, email: true } },
              category: true,
            },
          },
          outgoingVehicle: { include: { category: true } },
          incomingVehicle: { include: { category: true } },
          outgoingInspection: true,
          incomingInspection: true,
          workOrder: true,
          incident: true,
          payment: true,
          swappedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ),
});
