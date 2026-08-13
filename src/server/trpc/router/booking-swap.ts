import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import type { Inspection, PrismaClient, SwapOrigin, SwapReason } from "@prisma/client";

import { createTRPCRouter, staffProcedure, managerProcedure } from "../trpc";
import { assertBookingDepotAccess, assertDepotAccess } from "./_depot-scope";
import { isBookingOverlapViolation, isVehicleFree } from "@/server/services/availability";
import { quoteSwapDelta } from "@/server/services/pricing";
import { BOOKING_RULES } from "@/lib/constants";
import { TURNAROUND_WO_TITLE_PREFIX } from "@/server/jobs/swap-draft-cleanup";
import { aud, gstFromInclusive, roundCents, toNumber } from "@/lib/money";
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
import {
  toStoredMarkers,
  type DamageMarkerInput,
  type StoredDamageMarker,
} from "./inspection";

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
// LOSS_REPLACEMENT (Area 2): the customer didn't choose to lose the vehicle,
// so the replacement is forced zero-delta like the other involuntary reasons.
const NO_DELTA_REASONS = [
  "MECHANICAL_FAULT",
  "ACCIDENT_DAMAGE",
  "OPERATIONAL",
  "LOSS_REPLACEMENT",
] as const;
// LOSS_REPLACEMENT deliberately absent: the outgoing vehicle is gone, not
// repairable — no fault work order is lodged from the swap.
const REQUIRES_WORK_ORDER = ["MECHANICAL_FAULT", "ACCIDENT_DAMAGE"] as const;
// A loss event is significant — replacing a lost vehicle mid-hire is
// manager-only, same gate family as fault/downgrade.
const REQUIRES_MANAGER = [
  "DOWNGRADE",
  "MECHANICAL_FAULT",
  "ACCIDENT_DAMAGE",
  "LOSS_REPLACEMENT",
] as const;

/** Vehicle disposition statuses that mark the unit as lost to the fleet. */
const LOST_VEHICLE_STATUSES = ["STOLEN", "WRITTEN_OFF", "END_OF_LIFE"] as const;

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

/**
 * Mirror swap damage markers into first-class `InspectionIssue` rows so
 * swap-time damage feeds the same charge pipeline as return-time issues
 * (`return.upsertDamageCharge` accepts same-booking SWAP_OUT issues). The
 * deprecated `bodyDamageMap` blob is still written for UI back-compat.
 */
function markersToIssueRows(
  inspectionId: string,
  markers: StoredDamageMarker[],
  isPreExisting: boolean,
): Prisma.InspectionIssueCreateManyInput[] {
  return markers.map((m) => ({
    inspectionId,
    side: m.view,
    label: m.note?.trim() ? m.note.trim() : `Damage marker (${m.severity})`,
    severity: m.severity,
    note: m.note ?? null,
    posX: m.x,
    posY: m.y,
    source: m.source,
    isPreExisting,
  }));
}

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

/**
 * Shared tail of `startSwapDraft` / `startLossReplacementDraft`: enforces the
 * one-DRAFT-per-booking soft lock, creates the DRAFT row, and writes the
 * audit pair. Callers own the booking/status/role gates.
 */
async function openSwapDraft(
  ctx: { prisma: PrismaClient; user: { id: string }; reqId: string },
  args: {
    bookingId: string;
    outgoingVehicleId: string;
    reason: SwapReason;
    origin: SwapOrigin;
    reasonNotes: string;
    originDetails?: string;
    incidentId?: string;
  },
) {
  const existing = await ctx.prisma.bookingSwap.findFirst({
    where: { bookingId: args.bookingId, status: "DRAFT" },
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
      bookingId: args.bookingId,
      outgoingVehicleId: args.outgoingVehicleId,
      swappedById: ctx.user.id,
      reason: args.reason,
      origin: args.origin,
      reasonNotes: args.reasonNotes,
      originDetails: args.originDetails,
      incidentId: args.incidentId,
      status: "DRAFT",
    },
  });
  await writeAudit(ctx.prisma, {
    userId: ctx.user.id,
    action: "BOOKING_SWAP_DRAFT_STARTED",
    entity: "BookingSwap",
    entityId: draft.id,
    newData: {
      bookingId: args.bookingId,
      reason: args.reason,
      origin: args.origin,
      ...(args.incidentId ? { incidentId: args.incidentId } : {}),
    },
  });
  // Companion row so the swap draft surfaces on the booking's Activity tab.
  writeBookingAuditAsync(ctx.prisma, args.bookingId, {
    userId: ctx.user.id,
    action: "BOOKING_SWAP_DRAFT_STARTED",
    reqId: ctx.reqId,
    newData: {
      swapId: draft.id,
      reason: args.reason,
      origin: args.origin,
      ...(args.incidentId ? { incidentId: args.incidentId } : {}),
    },
  });
  return draft;
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
      await assertBookingDepotAccess(ctx, input.bookingId);
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
        // Vehicle-level pricing (baseRateOverride / model rates / vehicle
        // tiers) only applies when the candidate is known.
        incomingVehicleId: z.string().optional(),
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
      await assertBookingDepotAccess(ctx, input.bookingId);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { categoryId: true, vehicleId: true, returnDateTime: true, status: true },
      });
      const zeroDelta = (NO_DELTA_REASONS as readonly string[]).includes(input.reason);
      const sameCategory = b.categoryId === input.newCategoryId;
      // UPGRADE/DOWNGRADE carry the vehicle-level rate difference even within
      // one category; LATERAL keeps the same-category forced zero.
      const specChange = input.reason === "UPGRADE" || input.reason === "DOWNGRADE";
      const raw = await quoteSwapDelta(ctx.prisma, {
        oldCategoryId: b.categoryId,
        newCategoryId: input.newCategoryId,
        oldVehicleId: b.vehicleId ?? undefined,
        newVehicleId: input.incomingVehicleId,
        swapAt: new Date(),
        returnDateTime: b.returnDateTime,
      });
      if (zeroDelta || (sameCategory && !specChange)) {
        return {
          ...raw,
          deltaAmount: 0,
          gstAmount: 0,
          direction: "NONE" as const,
          forcedZero: zeroDelta ? "reason" : ("same-category" as const),
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
      await assertBookingDepotAccess(ctx, input.bookingId);
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

      return openSwapDraft(ctx, {
        bookingId: b.id,
        outgoingVehicleId: b.vehicleId,
        reason: input.reason,
        origin: input.origin,
        reasonNotes: input.reasonNotes,
        originDetails: input.originDetails,
      });
    }),

  /**
   * Open a DRAFT swap for a booking whose current vehicle has been lost
   * (stolen / written off / destroyed) — the LOSS_REPLACEMENT variant of
   * `startSwapDraft` (Area 2). Manager-only. Only valid while the loss is
   * real: the outgoing vehicle must already carry a disposition status
   * (STOLEN / WRITTEN_OFF / END_OF_LIFE), or an open TOTAL_LOSS incident
   * must be on file for it. Zero price delta by reason; at commit the
   * outgoing POST_HIRE inspection is waived and the lost vehicle's status
   * is left untouched.
   */
  startLossReplacementDraft: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        reasonNotes: z.string().min(1),
        /** Optional link to the loss incident (theft report, write-off). */
        incidentId: z.string().optional(),
        // Mirrors startSwapDraft's origin dimension; defaults to the staff
        // member recording the loss.
        origin: z
          .enum([
            "CUSTOMER_WALK_IN",
            "CUSTOMER_PHONE_SUPPORT",
            "CUSTOMER_SELF_SERVICE",
            "ROADSIDE_ASSIST",
            "STAFF_OBSERVED",
            "TELEMATICS_ALERT",
          ])
          .default("STAFF_OBSERVED"),
        originDetails: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      await assertBookingDepotAccess(ctx, input.bookingId);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { id: true, status: true, vehicleId: true },
      });
      if (!b.vehicleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking has no assigned vehicle to replace.",
        });
      }
      if (!(SWAP_ALLOWED_STATUSES as readonly string[]).includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot swap vehicle from status ${b.status}.`,
        });
      }
      // LOSS_REPLACEMENT is in REQUIRES_MANAGER — a loss event is significant.
      if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Reason "LOSS_REPLACEMENT" requires a manager-role user.`,
        });
      }

      // The current vehicle must actually be lost: disposition status, or an
      // open TOTAL_LOSS incident on file for it.
      const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({
        where: { id: b.vehicleId },
        select: { id: true, internalCode: true, status: true },
      });
      let lost = (LOST_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status);
      if (!lost) {
        const openTotalLoss = await ctx.prisma.incident.findFirst({
          where: {
            vehicleId: vehicle.id,
            severity: "TOTAL_LOSS",
            status: { notIn: ["RESOLVED", "CLOSED"] },
            deletedAt: null,
          },
          select: { id: true },
        });
        lost = openTotalLoss !== null;
      }
      if (!lost) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Vehicle ${vehicle.internalCode} is not recorded as lost (status ${vehicle.status}, no open TOTAL_LOSS incident) — use a normal swap instead.`,
        });
      }

      // Optional incident link must reference the outgoing vehicle, and the
      // 1:1 BookingSwap.incidentId slot must be free.
      if (input.incidentId) {
        const incident = await ctx.prisma.incident.findUnique({
          where: { id: input.incidentId },
          select: {
            id: true,
            vehicleId: true,
            deletedAt: true,
            bookingSwap: { select: { id: true } },
          },
        });
        if (!incident || incident.deletedAt || incident.vehicleId !== vehicle.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "incidentId does not reference an incident on the outgoing vehicle.",
          });
        }
        if (incident.bookingSwap) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That incident is already linked to another swap.",
          });
        }
      }

      return openSwapDraft(ctx, {
        bookingId: b.id,
        outgoingVehicleId: b.vehicleId,
        reason: "LOSS_REPLACEMENT",
        origin: input.origin,
        reasonNotes: input.reasonNotes,
        originDetails: input.originDetails,
        incidentId: input.incidentId,
      });
    }),

  /**
   * The booking's open DRAFT swap, if any. The wizard calls this on mount to
   * resume an abandoned draft instead of starting fresh — returning the
   * persisted reason fields plus the saved `draftState` so the UI rehydrates
   * onto the step the author left off at. Null when no draft is open.
   */
  activeDraft: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertBookingDepotAccess(ctx, input.bookingId);
      return ctx.prisma.bookingSwap.findFirst({
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
      });
    }),

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
   *
   * LOSS_REPLACEMENT (Area 2) waives the whole outgoing leg: no
   * POST_HIRE inspection or odometer hand-off, and the lost vehicle's
   * disposition status (STOLEN / WRITTEN_OFF / END_OF_LIFE) is left
   * untouched. Incoming side is unchanged.
   */
  confirmSwap: staffProcedure
    .input(
      z.object({
        swapId: z.string(),
        incomingVehicleId: z.string(),
        // Required for every reason except LOSS_REPLACEMENT, where the
        // outgoing vehicle is gone and the inspection is waived (enforced
        // below once the draft's reason is known).
        outgoingInspection: inspectionPayloadSchema.optional(),
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
      await assertBookingDepotAccess(ctx, draft.bookingId);
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

      // LOSS_REPLACEMENT waives the outgoing leg entirely — the vehicle is
      // not on hand to inspect, so no outgoing payload is accepted. Every
      // other reason still requires it.
      const isLossReplacement = draft.reason === "LOSS_REPLACEMENT";
      const outgoingPayload = input.outgoingInspection ?? null;
      if (!isLossReplacement && !outgoingPayload) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "outgoingInspection is required for this swap reason.",
        });
      }
      if (isLossReplacement && outgoingPayload) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "LOSS_REPLACEMENT waives the outgoing inspection — the vehicle is lost and cannot be inspected.",
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
      if (draft.reason === "ACCIDENT_DAMAGE" && !input.incidentSeverity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "incidentSeverity is required for ACCIDENT_DAMAGE swaps.",
        });
      }

      // Re-quote pricing at commit time, vehicle-aware: baseRateOverride /
      // model rates / vehicle-scoped tiers can price two same-category
      // vehicles differently, so UPGRADE/DOWNGRADE keep the computed delta
      // even without a category change. LATERAL and the no-delta reasons
      // stay forced to zero. Override is allowed for managers only, within 5¢.
      const zeroDelta = (NO_DELTA_REASONS as readonly string[]).includes(draft.reason);
      const specChange = draft.reason === "UPGRADE" || draft.reason === "DOWNGRADE";
      const quote = await quoteSwapDelta(ctx.prisma, {
        oldCategoryId: booking.categoryId,
        newCategoryId: incomingVehicle.categoryId,
        oldVehicleId: booking.vehicleId,
        newVehicleId: incomingVehicle.id,
        swapAt: new Date(),
        returnDateTime: booking.returnDateTime,
      });
      const useQuoted = !zeroDelta && (categoryChanged || specChange);
      let deltaAmount = useQuoted ? quote.deltaAmount : 0;
      let gstAmount = useQuoted ? quote.gstAmount : 0;
      if (specChange && !categoryChanged && Math.abs(deltaAmount) < 0.005) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${draft.reason} within the same category needs a vehicle priced differently; use LATERAL for a no-charge same-category swap.`,
        });
      }

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
          gstAmount = toNumber(gstFromInclusive(Math.abs(deltaAmount)));
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

      // Odometer rollback guards before we open the transaction. The
      // outgoing guard is skipped for LOSS_REPLACEMENT — there is no
      // outgoing reading to validate.
      if (outgoingPayload) {
        await assertNoOdometerRollback(
          ctx.prisma,
          booking.vehicleId,
          outgoingPayload.odometerKm,
        );
      }
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
      const outgoingMarkers = outgoingPayload
        ? toStoredMarkers(outgoingPayload.damageMarkers as DamageMarkerInput[])
        : [];
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
      //
      // A downgrade delta offsets the customer's outstanding balance before
      // any cash moves: the unpaid base is balanceDue minus PENDING raises
      // (those already belong to the capture sweep — same exclusion as
      // pickup-remainder). Only the surplus over that debt is refunded via
      // Stripe. A fully-offset delta is a pure balance write-down — no
      // Stripe call and no Payment row; the DECREASE adjustment note below
      // still documents the full delta.
      let refundPaymentData:
        | {
            stripeChargeId: string | null;
            status: "SUCCEEDED" | "FAILED" | "PENDING";
          }
        | null = null;
      let fallbackToCredit = false;
      let refundOffset = 0;
      let refundCash = 0;
      if (direction === "REFUND") {
        const pendingRaised = await ctx.prisma.payment.aggregate({
          where: { bookingId: booking.id, status: "PENDING" },
          _sum: { amount: true },
        });
        const unpaidBase = Math.max(
          0,
          toNumber(
            roundCents(
              aud(booking.balanceDue).minus(aud(Number(pendingRaised._sum.amount ?? 0))),
            ),
          ),
        );
        refundOffset = Math.min(absDelta, unpaidBase);
        refundCash = toNumber(roundCents(aud(absDelta).minus(refundOffset)));
        if (refundCash > 0.005) {
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
          } else if (Number(sourcePayment.amount) < refundCash - 0.01) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Refund A$${refundCash.toFixed(2)} exceeds original charge A$${Number(sourcePayment.amount).toFixed(2)}.`,
            });
          } else {
            try {
              const res = await refundCharge({
                paymentIntentId: sourcePayment.stripePaymentIntentId,
                chargeId: sourcePayment.stripeChargeId,
                amountCents: Math.round(refundCash * 100),
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

        // 1. Outgoing POST_HIRE inspection (purpose=SWAP_OUT). Waived for
        // LOSS_REPLACEMENT — the vehicle is lost, there is nothing to inspect.
        let outgoingInspection: Inspection | null = null;
        if (outgoingPayload) {
          outgoingInspection = await tx.inspection.create({
            data: {
              vehicleId: outgoingVehicleId,
              bookingId: booking.id,
              type: "POST_HIRE",
              purpose: "SWAP_OUT",
              depotId: incomingVehicle.depotId,
              inspectorId: ctx.user.id,
              odometerKm: outgoingPayload.odometerKm,
              fuelLevel: outgoingPayload.fuelLevel,
              overallCondition: outgoingPayload.overallCondition,
              tyreFrontDepth: outgoingPayload.tyreFrontDepth,
              tyreRearDepth: outgoingPayload.tyreRearDepth,
              lightsWorking: outgoingPayload.lightsWorking,
              hornWorking: outgoingPayload.hornWorking,
              indicatorsWorking: outgoingPayload.indicatorsWorking,
              engineRunning: outgoingPayload.engineRunning,
              lockProvided: outgoingPayload.lockProvided,
              notes: outgoingPayload.notes,
              customerSignatureUrl: input.customerSignatureUrl,
              staffSignatureUrl: input.staffSignatureUrl,
              bodyDamageMap: { markers: outgoingMarkers } as unknown as Prisma.InputJsonValue,
              status: "COMPLETED",
            },
          });
          // Outgoing markers are end-of-leg damage on THIS hire — mirrored as
          // labelled issues so the check-in assess page can raise a
          // DamageCharge from them (isPreExisting=false → chargeable).
          if (outgoingMarkers.length > 0) {
            await tx.inspectionIssue.createMany({
              data: markersToIssueRows(outgoingInspection.id, outgoingMarkers, false),
            });
          }
        }

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
        // Incoming markers record the replacement vehicle's condition at
        // hand-over — pre-existing by definition, so they baseline the
        // eventual return diff and can never be charged to the customer.
        if (incomingMarkers.length > 0) {
          await tx.inspectionIssue.createMany({
            data: markersToIssueRows(incomingInspection.id, incomingMarkers, true),
          });
        }

        // 3. Vehicle odometer hand-off: outgoing POST_HIRE km becomes
        // the outgoing vehicle's current, incoming PRE_HIRE km becomes
        // the incoming vehicle's current (may be a correction from a
        // prior drift). LOSS_REPLACEMENT has no outgoing reading — the
        // lost vehicle's odometer stays at its last known value.
        if (outgoingPayload) {
          await tx.vehicle.update({
            where: { id: outgoingVehicleId },
            data: { currentOdometerKm: outgoingPayload.odometerKm },
          });
        }
        await tx.vehicle.update({
          where: { id: incomingVehicle.id },
          data: { currentOdometerKm: input.incomingInspection.odometerKm },
        });

        // 4. Vehicle status transitions + logs. LOSS_REPLACEMENT leaves the
        // outgoing vehicle completely untouched — it keeps its disposition
        // status (STOLEN / WRITTEN_OFF / END_OF_LIFE) and never re-enters
        // the available pool, so no turnaround buffer either.
        const outgoingNextStatus = isLossReplacement
          ? null
          : (REQUIRES_WORK_ORDER as readonly string[]).includes(draft.reason)
            ? "IN_MAINTENANCE"
            : "AVAILABLE";
        if (outgoingNextStatus) {
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
        }
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

        // 4b. Cleaning buffer (rule #6): a swapped-out vehicle going straight
        // back to AVAILABLE would otherwise be bookable immediately — the
        // usual 2h buffer keys off booking windows, and this hire's window is
        // still open on the *incoming* vehicle. A scheduled turnaround work
        // order over `bufferHoursBetweenBookings` blocks it in availability
        // (`vehiclesBlockedByScheduledWorkOrders`); the nightly
        // swap-draft-cleanup job auto-completes it once the window lapses.
        // Fault/accident swaps skip this — the vehicle goes to maintenance.
        if (outgoingNextStatus === "AVAILABLE") {
          const turnaroundStart = new Date();
          const turnaroundEnd = new Date(
            turnaroundStart.getTime() +
              BOOKING_RULES.bufferHoursBetweenBookings * 60 * 60 * 1000,
          );
          await withUniqueRetry(
            () =>
              tx.maintenanceWorkOrder.create({
                data: {
                  workOrderNumber: generateWorkOrderNumber(),
                  vehicleId: outgoingVehicleId,
                  depotId: incomingVehicle.depotId,
                  type: "CUSTOM",
                  priority: "LOW",
                  status: "OPEN",
                  title: `${TURNAROUND_WO_TITLE_PREFIX} swap ${booking.bookingReference}`,
                  description: `Post-swap cleaning/turnaround buffer (${BOOKING_RULES.bufferHoursBetweenBookings}h) after mid-rental swap off ${booking.bookingReference}. Auto-completes once the scheduled window lapses; complete early if the vehicle is turned around sooner.`,
                  scheduledStartAt: turnaroundStart,
                  scheduledEndAt: turnaroundEnd,
                  reportedById: ctx.user.id,
                  relatedInspectionId: outgoingInspection?.id,
                },
              }),
            { constraintFields: ["workOrderNumber"] },
          );
        }

        // 5. Booking vehicle reassignment + booking log + note. categoryId
        // follows the incoming vehicle so later consumers (late fees,
        // extensions, a second swap's quote) price off the category the
        // customer is actually riding; history stays on the BookingSwap
        // chain + audit rows.
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            vehicleId: incomingVehicle.id,
            categoryId: incomingVehicle.categoryId,
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
                  relatedInspectionId: outgoingInspection?.id,
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
          // Raise→add half of the balance-due contract (balance-due.ts):
          // SWAP_ADJUSTMENT is balance-affecting, so its capture decrements
          // balanceDue — without this increment the capture would eat into
          // UNRELATED debt on the booking and silently stop it being dunned.
          // Totals move with the raise (extend's arithmetic) so a later
          // re-quote or swap-back prices off the upgraded consideration.
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              balanceDue: { increment: absDelta },
              totalAmount: { increment: absDelta },
              gstAmount: { increment: gstAmount },
            },
          });
        } else if (direction === "REFUND") {
          // Payment rows only cover the cash slice; the offset slice is a
          // debt reduction with no ledger row of its own.
          const cashGst = toNumber(gstFromInclusive(refundCash));
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
                amount: refundCash,
                gstAmount: cashGst,
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
                amount: refundCash,
                gstAmount: cashGst,
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
                  refundCash >= Number(source.amount) - 0.01
                    ? "REFUNDED"
                    : "PARTIALLY_REFUNDED";
                await tx.payment.update({
                  where: { id: source.id },
                  data: { status: newStatus },
                });
              }
            }
          }
          // Ledger write-down: totals drop by the full delta (the reduced
          // consideration), balanceDue by the offset slice, amountPaid only
          // by cash that actually left via Stripe — the MANUAL_CREDIT slice
          // decrements amountPaid at reconcileCreditTransfer instead. A
          // FAILED Stripe refund leaves the ledger untouched; the manager
          // notification after the transaction owns the follow-up.
          if (refundPaymentData?.status !== "FAILED") {
            await tx.booking.update({
              where: { id: booking.id },
              data: {
                totalAmount: { decrement: absDelta },
                gstAmount: { decrement: gstAmount },
                ...(refundOffset > 0.005
                  ? { balanceDue: { decrement: refundOffset } }
                  : {}),
                ...(refundPaymentData?.status === "SUCCEEDED"
                  ? { amountPaid: { decrement: refundCash } }
                  : {}),
              },
            });
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
            outgoingInspectionId: outgoingInspection?.id ?? null,
            incomingInspectionId: incomingInspection.id,
            workOrderId,
            // Preserve a loss incident linked at draft time (LOSS_REPLACEMENT);
            // ACCIDENT_DAMAGE swaps set the freshly created incident instead.
            incidentId: incidentId ?? draft.incidentId,
            customerSignatureUrl: input.customerSignatureUrl,
            staffSignatureUrl: input.staffSignatureUrl,
            bondVarianceAmount: Math.abs(bondVariance) > 0.005 ? bondVariance : null,
            status: "COMMITTED",
          },
        });

        return { committed, outgoingInspection, incomingInspection, paymentId, direction, absDelta, gstAmount };
      }).catch((err: unknown) => {
        // The Booking_no_overlap exclusion constraint can still fire inside
        // the transaction after the pre-flight isVehicleFree checks — e.g.
        // the replacement vehicle holds a CONFIRMED booking that starts
        // before this hire ends. Surface it as an actionable CONFLICT
        // instead of a raw 23P01 500 (same classification as checkOut).
        if (isBookingOverlapViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The replacement vehicle has a booking earlier in this hire's window — choose another vehicle.",
          });
        }
        throw err;
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
            // Null inspection fields = waived outgoing inspection
            // (LOSS_REPLACEMENT); the PDF renders an honest waiver line.
            odometerKm: outgoingPayload?.odometerKm ?? null,
            fuelLevel: outgoingPayload?.fuelLevel ?? null,
            overallCondition: outgoingPayload?.overallCondition ?? null,
            notes: outgoingPayload?.notes ?? null,
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
      // LOSS_REPLACEMENT is excluded: its incident link (if any) is the
      // pre-existing loss incident, already broadcast when it was reported —
      // this swap lodges nothing new.
      if (
        !isLossReplacement &&
        (result.committed.workOrderId || result.committed.incidentId)
      ) {
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

      // A FAILED Stripe refund committed the swap but moved no money and
      // wrote no ledger decrements — page depot managers so the downgrade
      // refund is chased manually instead of silently going stale.
      if (direction === "REFUND" && refundPaymentData?.status === "FAILED") {
        const managers = await ctx.prisma.user.findMany({
          where: {
            role: { in: ["MANAGER", "ADMIN"] },
            deletedAt: null,
            OR: [{ depotId: incomingVehicle.depotId }, { depotId: null }],
          },
          select: { id: true },
        });
        const subject = `Swap refund FAILED on booking ${booking.bookingReference}`;
        for (const m of managers) {
          await sendNotification({
            userId: m.id,
            type: "BOOKING_MODIFIED",
            category: "OPERATIONAL",
            channels: ["IN_APP", "EMAIL"],
            subject,
            title: subject,
            body: `The Stripe refund of A$${refundCash.toFixed(2)} for the ${draft.reason} swap on ${booking.bookingReference} failed. The swap is committed but the customer has NOT been refunded and the booking ledger was not written down — refund manually and reconcile.`,
            data: {
              swapId: result.committed.id,
              bookingId: booking.id,
              paymentId: result.paymentId,
              refundCash,
              reason: draft.reason,
            },
            sentById: ctx.user.id,
            dedupKey: `swap-refund-failed:${result.committed.id}:${m.id}`,
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
      await assertBookingDepotAccess(ctx, draft.bookingId);
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
          // Release the 1:1 incident slot (only LOSS_REPLACEMENT drafts link
          // one pre-commit) so a retry draft can re-link the loss incident.
          incidentId: null,
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
      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.payment.update({
          where: { id: p.id },
          data: {
            status: "SUCCEEDED",
            processedAt: new Date(),
            processedById: ctx.user.id,
            notes: `${p.notes ?? ""}\nReconciled via bank transfer ref ${input.reference} by ${ctx.user.id}.`,
          },
        });
        // The credited cash has now actually left via bank transfer — the
        // booking's paid-to-date drops by it here, not at swap commit
        // (totals/balance were already written down in confirmSwap).
        if (p.bookingId) {
          await tx.booking.update({
            where: { id: p.bookingId },
            data: { amountPaid: { decrement: p.amount } },
          });
        }
        return updated;
      });
    }),

  /** Swap history for a booking, for the booking-detail Activity tab. */
  listForBooking: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertBookingDepotAccess(ctx, input.bookingId);
      return ctx.prisma.bookingSwap.findMany({
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
      });
    }),

  /** Fetch a single swap for review / PDF rendering. */
  byId: staffProcedure
    .input(z.object({ swapId: z.string() }))
    .query(async ({ ctx, input }) => {
      const swap = await ctx.prisma.bookingSwap.findUnique({
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
      });
      if (swap?.booking) assertDepotAccess(ctx.user, swap.booking.depotId);
      return swap;
    }),
});
