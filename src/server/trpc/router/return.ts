import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, managerProcedure, protectedProcedure, staffProcedure } from "../trpc";
import { uploadFile } from "@/lib/storage";
import { renderReturnAssessmentPdf, type ReturnAssessmentData } from "@/lib/agreement/pdf/return-assessment-pdf";
import { requestTimestamp, sha256Buffer } from "@/lib/agreement/timestamp";
import {
  captureBookingId,
  readCapturedBookingId,
  writeAudit,
  writeBookingAuditAsync,
  writeCustomerAuditAsync,
} from "@/server/services/audit";
import { autoCloseByTarget } from "@/server/services/staff-tasks";
import {
  applyExcessCap,
  getBookingExcess,
  getDamageLiabilityUsed,
} from "@/server/services/excess";
import { logger } from "@/lib/logger";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { getBranding } from "@/lib/branding";
import { gstFromInclusive } from "@/lib/money";
import { cancelPaymentIntent, capturePaymentIntent } from "@/lib/stripe";

const RETURN_PAGE_IDS = ["cover", "condition", "charges", "fees", "quote-ack", "settlement"] as const;

type PageInitialsEntry = { pageId: string; initialsUrl: string; signedAt: string };

type FeeCalc = { lateFee: number; fuelCharge: number; missingLitres: number; lateHours: number };

const DEFAULT_TANK_CAPACITY_L = 8;

function calculateFees(args: {
  scheduledReturn: Date;
  actualReturn: Date;
  pickupFuelPct: number;
  returnFuelPct: number;
  fuelPerLitre: number;
  tankCapacityL: number;
  baseDailyRate: number;
  graceHours: number;
}): FeeCalc {
  const lateHoursRaw = (args.actualReturn.getTime() - args.scheduledReturn.getTime()) / (1000 * 60 * 60);
  const lateHours = Math.max(0, lateHoursRaw - args.graceHours);
  const hourlyRate = args.baseDailyRate / 8;
  const lateFee = Math.min(
    Math.floor(lateHours) * hourlyRate,
    Math.ceil(lateHours / 24) * args.baseDailyRate,
  );
  const missingLitres = Math.max(0, ((args.pickupFuelPct - args.returnFuelPct) / 100) * args.tankCapacityL);
  const fuelCharge = Math.round(missingLitres * args.fuelPerLitre * 100) / 100;
  return {
    lateFee: Math.round(lateFee * 100) / 100,
    fuelCharge,
    missingLitres,
    lateHours,
  };
}

export const returnRouter = createTRPCRouter({
  /** Start or resume a DRAFT return assessment for a booking. */
  startDraft: staffProcedure
    .input(z.object({ bookingId: z.string(), inspectionId: z.string() }))
    .meta({ audit: { bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: { category: true },
      });
      if (!["ACTIVE", "OVERDUE", "CHECKED_OUT"].includes(booking.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot start return from status ${booking.status}`,
        });
      }
      const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: input.inspectionId },
      });
      if (inspection.bookingId !== booking.id || inspection.type !== "POST_HIRE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Inspection does not belong to this return" });
      }

      const existing = await ctx.prisma.returnAssessment.findUnique({
        where: { bookingId: booking.id },
      });
      if (existing && existing.status === "DRAFT") return existing;
      if (existing && existing.status === "SIGNED") return existing;

      const assessmentNumber = `RTN-${booking.bookingReference}-v1`;
      const number = (await ctx.prisma.returnAssessment.findUnique({ where: { assessmentNumber } }))
        ? `${assessmentNumber}-${randomBytes(2).toString("hex")}`
        : assessmentNumber;
      return ctx.prisma.returnAssessment.create({
        data: {
          bookingId: booking.id,
          inspectionId: inspection.id,
          assessmentNumber: number,
          status: "DRAFT",
          staffId: ctx.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }),

  /** Create or update a single DamageCharge line on a draft assessment. */
  upsertDamageCharge: staffProcedure
    .input(
      z.object({
        chargeId: z.string().optional(),
        assessmentId: z.string(),
        description: z.string().min(1),
        markerRef: z.string().optional(),
        inspectionIssueId: z.string().optional(),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
        resolution: z.enum(["STANDARD", "QUOTE_PENDING", "WAIVED", "WARRANTY"]),
        damageTariffId: z.string().optional(),
        amount: z.number().min(0).optional(),
        quoteCapAmount: z.number().min(0).optional(),
        photoUrls: z.array(z.string()).optional(),
        staffNote: z.string().optional(),
      }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const assessment = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
        include: { booking: true, inspection: true },
      });
      captureBookingId(ctx, assessment.bookingId);
      if (assessment.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Assessment is sealed" });
      }

      if (input.resolution === "STANDARD" && (input.amount ?? 0) <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Standard tariff charges need an amount",
        });
      }
      if (input.resolution === "QUOTE_PENDING" && (input.quoteCapAmount ?? 0) <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A quote-pending charge needs an acknowledged cap",
        });
      }

      // Link the charge to the labelled inspection issue it came from (if any),
      // and default the evidence photos to that issue's photo so the charge
      // points at the picture the damage was identified against. The issue
      // may belong to this return's inspection, or to a COMPLETED SWAP_OUT
      // inspection on the same booking — damage pinned when a vehicle was
      // swapped off mid-hire is still this hire's damage and is chargeable
      // at check-in. Issues from other bookings stay rejected.
      let derivedPhotoUrls = input.photoUrls ?? [];
      if (input.inspectionIssueId) {
        const issue = await ctx.prisma.inspectionIssue.findUnique({
          where: { id: input.inspectionIssueId },
          select: {
            inspectionId: true,
            inspectionPhoto: { select: { url: true } },
            inspection: { select: { bookingId: true, purpose: true, status: true } },
          },
        });
        const sameBookingSwapOut =
          !!issue &&
          issue.inspection.purpose === "SWAP_OUT" &&
          issue.inspection.status === "COMPLETED" &&
          issue.inspection.bookingId === assessment.bookingId;
        if (
          !issue ||
          (issue.inspectionId !== assessment.inspectionId && !sameBookingSwapOut)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Issue does not belong to this return inspection",
          });
        }
        if (derivedPhotoUrls.length === 0 && issue.inspectionPhoto?.url) {
          derivedPhotoUrls = [issue.inspectionPhoto.url];
        }
      }

      const base = {
        description: input.description,
        markerRef: input.markerRef,
        inspectionIssueId: input.inspectionIssueId ?? null,
        severity: input.severity,
        resolution: input.resolution,
        damageTariffId: input.damageTariffId ?? null,
        amount: input.resolution === "STANDARD" ? (input.amount ?? 0) : 0,
        quoteCapAmount: input.resolution === "QUOTE_PENDING" ? input.quoteCapAmount : null,
        photoUrls: derivedPhotoUrls,
        staffNote: input.staffNote,
        status: "PROVISIONAL" as const,
      };

      if (input.chargeId) {
        return ctx.prisma.damageCharge.update({
          where: { id: input.chargeId },
          data: base,
        });
      }

      const created = await ctx.prisma.damageCharge.create({
        data: {
          ...base,
          returnAssessmentId: assessment.id,
          inspectionId: assessment.inspectionId,
          createdById: ctx.user.id,
        },
      });

      // Auto-create a maintenance work order for QUOTE_PENDING.
      if (input.resolution === "QUOTE_PENDING" && assessment.booking.vehicleId) {
        const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({
          where: { id: assessment.booking.vehicleId },
          select: { internalCode: true, depotId: true, rego: true },
        });
        const workOrderNumber = `WO-${Date.now()}-${randomBytes(2).toString("hex")}`;
        const workOrder = await ctx.prisma.maintenanceWorkOrder.create({
          data: {
            workOrderNumber,
            vehicleId: assessment.booking.vehicleId,
            depotId: vehicle.depotId,
            type: "CUSTOM",
            priority: "HIGH",
            status: "OPEN",
            title: `Repair quote — ${vehicle.internalCode} (${vehicle.rego})`,
            description: `${input.description}\n\nCustomer liability cap: $${input.quoteCapAmount ?? 0}. Severity: ${input.severity}.`,
            reportedById: ctx.user.id,
            relatedInspectionId: assessment.inspectionId,
            relatedDamageChargeId: created.id,
          },
        });
        await ctx.prisma.damageCharge.update({
          where: { id: created.id },
          data: { workOrderId: workOrder.id },
        });
        return { ...created, workOrderId: workOrder.id };
      }

      return created;
    }),

  /** Remove a provisional DamageCharge line. */
  removeDamageCharge: staffProcedure
    .input(z.object({ chargeId: z.string() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const charge = await ctx.prisma.damageCharge.findUniqueOrThrow({
        where: { id: input.chargeId },
        include: { returnAssessment: true },
      });
      captureBookingId(ctx, charge.returnAssessment.bookingId);
      if (charge.returnAssessment.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Assessment sealed" });
      }
      if (charge.status !== "PROVISIONAL") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only provisional charges can be removed" });
      }
      // If linked to a work order that is still OPEN, cancel it as well.
      if (charge.workOrderId) {
        await ctx.prisma.maintenanceWorkOrder.updateMany({
          where: { id: charge.workOrderId, status: "OPEN" },
          data: { status: "CANCELLED" },
        });
      }
      await ctx.prisma.damageCharge.delete({ where: { id: input.chargeId } });
      return { ok: true as const };
    }),

  /** Compute late + fuel fees for the UI summary. Pure read. */
  computeFees: staffProcedure
    .input(
      z.object({
        assessmentId: z.string(),
        fuelPerLitre: z.number().optional(),
        tankCapacityL: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const assessment = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
        include: {
          booking: { include: { category: true } },
          inspection: true,
        },
      });
      const preHire = await ctx.prisma.inspection.findFirst({
        where: { bookingId: assessment.bookingId, type: "PRE_HIRE" },
        orderBy: { dateTime: "desc" },
        select: { fuelLevel: true },
      });
      const pickupFuel = preHire?.fuelLevel ?? 100;
      const now = assessment.signedAt ?? new Date();
      const cfg = await getSettings([
        "booking.fuelChargePerLitre",
        "booking.lateReturnGraceHours",
      ] as const);
      const fees = calculateFees({
        scheduledReturn: assessment.booking.returnDateTime,
        actualReturn: now,
        pickupFuelPct: pickupFuel,
        returnFuelPct: assessment.inspection.fuelLevel,
        fuelPerLitre:
          input.fuelPerLitre ??
          cfg["booking.fuelChargePerLitre"] ??
          SETTING_DEFAULTS["booking.fuelChargePerLitre"],
        tankCapacityL: input.tankCapacityL ?? DEFAULT_TANK_CAPACITY_L,
        baseDailyRate: Number(assessment.booking.category.baseDailyRate),
        graceHours:
          cfg["booking.lateReturnGraceHours"] ?? SETTING_DEFAULTS["booking.lateReturnGraceHours"],
      });
      return { pickupFuel, returnFuel: assessment.inspection.fuelLevel, ...fees };
    }),

  /** Save a signature / initials PNG onto the assessment. */
  saveSignature: staffProcedure
    .input(
      z
        .object({
          assessmentId: z.string(),
          kind: z.enum(["initials", "full-customer", "full-staff"]),
          pageId: z.enum(RETURN_PAGE_IDS).optional(),
          dataUrl: z.string().min(16).optional(),
          reuseUrl: z.string().min(1).optional(),
        })
        .refine((v) => !!v.dataUrl !== !!v.reuseUrl, {
          message: "Provide exactly one of dataUrl or reuseUrl",
        })
        .refine((v) => !v.reuseUrl || v.kind === "initials", {
          message: "reuseUrl is only supported for initials",
        }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const assessment = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
      });
      captureBookingId(ctx, assessment.bookingId);
      if (assessment.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Assessment sealed" });
      }

      let url: string;
      if (input.reuseUrl) {
        url = input.reuseUrl;
      } else {
        const match = /^data:([^;]+);base64,(.+)$/.exec(input.dataUrl!);
        if (!match || !match[1] || !match[2]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid signature data URL" });
        }
        const contentType = match[1];
        const body = Buffer.from(match[2], "base64");
        if (body.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty signature" });

        const folder = `returns/${assessment.bookingId}/${assessment.id}`;
        const filename =
          input.kind === "full-customer"
            ? "signature-customer.png"
            : input.kind === "full-staff"
              ? "signature-staff.png"
              : `initials-${input.pageId ?? "first"}.png`;
        const uploaded = await uploadFile({ folder, filename, contentType, body });
        url = uploaded.url;
      }

      const updates: Prisma.ReturnAssessmentUpdateInput = {};
      if (input.kind === "full-customer") updates.customerSignatureUrl = url;
      if (input.kind === "full-staff") updates.staffSignatureUrl = url;
      if (input.kind === "initials") {
        if (!input.pageId) throw new TRPCError({ code: "BAD_REQUEST", message: "pageId required" });
        const pagesNow = (assessment.pagesInitialled as unknown as PageInitialsEntry[]) ?? [];
        const nextPages = pagesNow.filter((p) => p.pageId !== input.pageId);
        nextPages.push({
          pageId: input.pageId,
          initialsUrl: url,
          signedAt: new Date().toISOString(),
        });
        updates.pagesInitialled = nextPages as unknown as Prisma.InputJsonValue;
        if (!assessment.customerInitialsUrl) updates.customerInitialsUrl = url;
      }
      const updated = await ctx.prisma.returnAssessment.update({
        where: { id: assessment.id },
        data: updates,
      });
      return { url, assessment: updated };
    }),

  /** Seal the assessment: validate, render PDF, upload, timestamp, mark SIGNED. */
  finalise: staffProcedure
    .input(
      z.object({
        assessmentId: z.string(),
        fuelPerLitre: z.number().optional(),
        tankCapacityL: z.number().optional(),
        // Honourable lever: cleaning / detailing / odour fee when the
        // post-hire inspection flags excessive cleaning required. Staff
        // tick a reason on the inspection and pass the charge here.
        cleaningFee: z
          .number()
          .min(0)
          .max(500)
          .optional(),
        cleaningReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assessment = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
        include: {
          booking: {
            include: {
              customer: true,
              vehicle: true,
              category: true,
              pickupDepot: true,
              returnDepot: true,
            },
          },
          inspection: { include: { photos: true, issues: { include: { inspectionPhoto: true, damageTariff: true } } } },
          staff: true,
          // Creation order matters: the excess cap consumes headroom line by
          // line, so the clamp must be deterministic (and match the UI).
          damageCharges: { include: { damageTariff: true }, orderBy: { createdAt: "asc" } },
        },
      });
      if (assessment.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${assessment.status.toLowerCase()}` });
      }
      if (!assessment.customerSignatureUrl || !assessment.staffSignatureUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both customer and staff signatures are required before finalising.",
        });
      }
      const hasQuotePending = assessment.damageCharges.some((c) => c.resolution === "QUOTE_PENDING");
      const requiredPages = RETURN_PAGE_IDS.filter((id) => (id === "quote-ack" ? hasQuotePending : true));
      const pagesNow = (assessment.pagesInitialled as unknown as PageInitialsEntry[]) ?? [];
      const missing = requiredPages.filter((id) => !pagesNow.some((p) => p.pageId === id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Missing initials on pages: ${missing.join(", ")}`,
        });
      }

      const preHire = await ctx.prisma.inspection.findFirst({
        where: { bookingId: assessment.bookingId, type: "PRE_HIRE" },
        orderBy: { dateTime: "desc" },
        select: { fuelLevel: true },
      });

      const now = new Date();
      const cfg = await getSettings([
        "booking.fuelChargePerLitre",
        "booking.lateReturnGraceHours",
      ] as const);
      const fees = calculateFees({
        scheduledReturn: assessment.booking.returnDateTime,
        actualReturn: now,
        pickupFuelPct: preHire?.fuelLevel ?? 100,
        returnFuelPct: assessment.inspection.fuelLevel,
        fuelPerLitre:
          input.fuelPerLitre ??
          cfg["booking.fuelChargePerLitre"] ??
          SETTING_DEFAULTS["booking.fuelChargePerLitre"],
        tankCapacityL: input.tankCapacityL ?? DEFAULT_TANK_CAPACITY_L,
        baseDailyRate: Number(assessment.booking.category.baseDailyRate),
        graceHours:
          cfg["booking.lateReturnGraceHours"] ?? SETTING_DEFAULTS["booking.lateReturnGraceHours"],
      });

      // The overdue job accrues one daily-rate LATE_FEE per completed late
      // day (`LATE-<bookingId>-D<n>`); what's left to bill at return is only
      // the residual (the partial final day). Without this subtraction every
      // completed late day would be charged twice.
      const priorLateRaised = await ctx.prisma.payment.aggregate({
        where: {
          bookingId: assessment.bookingId,
          type: "LATE_FEE",
          reference: { startsWith: `LATE-${assessment.bookingId}-D` },
          status: { in: ["PENDING", "SUCCEEDED"] },
        },
        _sum: { amount: true },
      });
      fees.lateFee = Math.max(
        0,
        Math.round((fees.lateFee - Number(priorLateRaised._sum.amount ?? 0)) * 100) / 100,
      );

      const r2 = (x: number) => Math.round(x * 100) / 100;

      // ---- Excess cap (Area 1). The customer's insurance excess is a
      // PER-HIRE AGGREGATE ceiling on damage recovery: incident charges,
      // standard damage lines and quote close-outs all draw on the same cap.
      // Late / fuel / cleaning fees sit OUTSIDE it. Clamp STANDARD lines in
      // creation order (later lines reduce to the remaining headroom, then
      // zero), then clamp QUOTE_PENDING acknowledgements to what's left.
      const bookingExcess = await getBookingExcess(ctx.prisma, assessment.bookingId);
      const liabilityUsedBefore = await getDamageLiabilityUsed(ctx.prisma, assessment.bookingId);
      const initialCapRemaining = Math.max(0, r2(bookingExcess.excess - liabilityUsedBefore));
      let liabilityUsed = liabilityUsedBefore;
      const chargedAmountById = new Map<string, number>();
      const cappedStandardLines: Array<{ id: string; description: string; preCap: number; charged: number }> = [];
      for (const c of assessment.damageCharges.filter((x) => x.resolution === "STANDARD")) {
        const preCap = Number(c.amount);
        const { chargeable, cappedBy } = applyExcessCap({
          proposed: preCap,
          used: liabilityUsed,
          excess: bookingExcess.excess,
        });
        chargedAmountById.set(c.id, chargeable);
        liabilityUsed = r2(liabilityUsed + chargeable);
        if (cappedBy > 0) {
          cappedStandardLines.push({ id: c.id, description: c.description, preCap, charged: chargeable });
        }
      }
      let quoteHeadroom = Math.max(0, r2(bookingExcess.excess - liabilityUsed));
      const quoteCapById = new Map<string, number>();
      const cappedQuoteLines: Array<{ id: string; description: string; preCap: number; cap: number }> = [];
      for (const c of assessment.damageCharges.filter((x) => x.resolution === "QUOTE_PENDING")) {
        const preCap = Number(c.quoteCapAmount ?? 0);
        const clamped = r2(Math.min(preCap, quoteHeadroom));
        quoteCapById.set(c.id, clamped);
        quoteHeadroom = r2(quoteHeadroom - clamped);
        if (clamped < preCap) {
          cappedQuoteLines.push({ id: c.id, description: c.description, preCap, cap: clamped });
        }
      }

      const standardTotal = assessment.damageCharges
        .filter((c) => c.resolution === "STANDARD")
        .reduce((acc, c) => acc + (chargedAmountById.get(c.id) ?? Number(c.amount)), 0);
      const pendingCapTotal = assessment.damageCharges
        .filter((c) => c.resolution === "QUOTE_PENDING")
        .reduce((acc, c) => acc + (quoteCapById.get(c.id) ?? Number(c.quoteCapAmount ?? 0)), 0);
      const cleaningFee = Math.round((input.cleaningFee ?? 0) * 100) / 100;
      const totalDueNow =
        Math.round(
          (fees.lateFee + fees.fuelCharge + standardTotal + cleaningFee) * 100,
        ) / 100;

      // Each return-inspection photo with the new damage pinned + labelled on it.
      const conditionPhotos = assessment.inspection.photos.map((p) => ({
        url: p.url,
        caption: p.caption,
        side: null as string | null,
        issues: assessment.inspection.issues
          .filter((iss) => iss.inspectionPhotoId === p.id)
          .map((iss, idx) => ({
            n: idx + 1,
            label: iss.label,
            severity: iss.severity as string,
            note: iss.note,
            posX: iss.posX,
            posY: iss.posY,
          })),
      }));
      // The evidence photo for each charge = the photo of the issue it came from.
      const issuePhotoById = new Map(
        assessment.inspection.issues.map((iss) => [iss.id, iss.inspectionPhoto?.url ?? null]),
      );

      // ---- Bond settlement (the signed PDF must state what ACTUALLY
      // happened, and the bond is the primary recovery instrument: the money
      // is already authorised, so unlike a fresh card charge it can't
      // decline). Read the LEDGER, not booking.bondAmount — part-captured or
      // released holds must not be re-counted.
      const ledger = await ctx.prisma.bondLedger.findUnique({
        where: { bookingId: assessment.bookingId },
      });
      const capturable =
        ledger && ledger.status === "HELD"
          ? Math.max(
              0,
              r2(
                Number(ledger.heldAmount) -
                  Number(ledger.capturedAmount) -
                  Number(ledger.releasedAmount),
              ),
            )
          : 0;
      // A pending repair quote keeps the bond HELD as the backstop (the
      // rolling re-hold job keeps it alive on RETURNED bookings) — capture
      // nothing yet, everything assessed today goes to the card.
      let fromBond = pendingCapTotal > 0 ? 0 : r2(Math.min(totalDueNow, capturable));
      let bondCaptureChargeId: string | null = null;
      let bondCaptured = false;
      if (fromBond > 0 && ledger) {
        try {
          // Single combined partial capture (manual-capture PIs are
          // single-capture; Stripe auto-releases the remainder).
          const capture = await capturePaymentIntent(ledger.stripePaymentIntentId, {
            amountToCaptureCents: Math.round(fromBond * 100),
            idempotencyKey: `bond-capture-${ledger.id}`,
          });
          bondCaptureChargeId = capture.latestChargeId;
          bondCaptured = true;
        } catch (err) {
          // Degrade gracefully: everything goes to the card as PENDING rows
          // and the ledger stays HELD (auto-release gating + the re-hold job
          // then manage it). The PDF shows applied 0 — truthful.
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              assessmentId: assessment.id,
              bondLedgerId: ledger.id,
            },
            "return.finalise: bond capture failed at Stripe — falling back to card charges",
          );
          fromBond = 0;
        }
      }
      const overflow = r2(totalDueNow - fromBond);

      // Nothing owed at all → release the hold now (with a real Stripe
      // cancel), but ONLY when the booking has no other outstanding balance;
      // otherwise keep it as the backstop and let the gated auto-release
      // handle it once the balance clears.
      let bondReleasedNow = 0;
      if (
        ledger &&
        ledger.status === "HELD" &&
        capturable > 0 &&
        !bondCaptured &&
        totalDueNow === 0 &&
        pendingCapTotal === 0 &&
        Number(assessment.booking.balanceDue) <= 0.009
      ) {
        try {
          await cancelPaymentIntent(ledger.stripePaymentIntentId);
          bondReleasedNow = capturable;
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), bondLedgerId: ledger.id },
            "return.finalise: bond release failed at Stripe — auto-release will retry",
          );
        }
      }

      const bondHeld = capturable > 0 ? capturable : Number(assessment.booking.bondAmount);
      const bondApplied = bondCaptured ? fromBond : 0;
      const bondReleased = bondCaptured ? r2(capturable - fromBond) : bondReleasedNow;

      const branding = await getBranding();

      const pdfData: ReturnAssessmentData = {
        assessmentNumber: assessment.assessmentNumber,
        version: assessment.version,
        signedAt: now,
        booking: {
          bookingReference: assessment.booking.bookingReference,
          pickupDateTime: assessment.booking.pickupDateTime,
          returnDateTime: assessment.booking.returnDateTime,
          actualReturnDateTime: assessment.booking.actualReturnDateTime,
          pickupOdometerKm: assessment.booking.pickupOdometerKm,
          bondAmount: bondHeld,
        },
        customer: {
          firstName: assessment.booking.customer.firstName,
          lastName: assessment.booking.customer.lastName,
          email: assessment.booking.customer.email,
        },
        vehicle: assessment.booking.vehicle ?? {
          internalCode: "—",
          rego: "—",
          make: "—",
          model: "—",
        },
        category: { name: assessment.booking.category.name },
        returnDepot: { name: assessment.booking.returnDepot.name },
        staffName: assessment.staff ? `${assessment.staff.firstName} ${assessment.staff.lastName}` : undefined,
        odometerKm: assessment.inspection.odometerKm,
        fuelLevel: assessment.inspection.fuelLevel,
        photos: conditionPhotos,
        charges: assessment.damageCharges.map((c) => ({
          description: c.description,
          severity: c.severity,
          resolution: c.resolution,
          // The signed PDF states what is ACTUALLY charged / acknowledged —
          // post-excess-cap figures, not the raw tariff amounts.
          amount: chargedAmountById.get(c.id) ?? Number(c.amount),
          quoteCapAmount:
            c.resolution === "QUOTE_PENDING"
              ? (quoteCapById.get(c.id) ?? (c.quoteCapAmount ? Number(c.quoteCapAmount) : null))
              : c.quoteCapAmount
                ? Number(c.quoteCapAmount)
                : null,
          tariffName: c.damageTariff?.name ?? null,
          photoUrl: (c.inspectionIssueId ? issuePhotoById.get(c.inspectionIssueId) : null) ?? c.photoUrls[0] ?? null,
        })),
        fees: { lateFee: fees.lateFee, fuelCharge: fees.fuelCharge },
        totalDueNow,
        pendingQuoteCap: pendingCapTotal,
        bond: {
          heldAmount: bondHeld,
          appliedAmount: bondApplied,
          releasedAmount: bondReleased,
        },
        signatures: {
          customerFullUrl: assessment.customerSignatureUrl,
          staffFullUrl: assessment.staffSignatureUrl,
          initialsUrl: assessment.customerInitialsUrl,
        },
        abn: branding.abn,
        siteName: branding.siteName,
        legalName: branding.legalName,
        supportEmail: branding.supportEmail,
      };

      const pdfBuffer = await renderReturnAssessmentPdf(pdfData);
      const pdfUpload = await uploadFile({
        folder: `returns/${assessment.bookingId}/${assessment.id}`,
        filename: "return-assessment.pdf",
        contentType: "application/pdf",
        body: pdfBuffer,
      });

      const hash = sha256Buffer(pdfBuffer);
      const ts = await requestTimestamp(hash);
      let timestampTokenKey: string | null = null;
      let timestampStatus: "OK" | "PENDING" | "FAILED" = "PENDING";
      let timestampTsaUrl: string | null = null;
      let timestampedAt: Date | null = null;
      if (ts.ok) {
        const tokenUpload = await uploadFile({
          folder: `returns/${assessment.bookingId}/${assessment.id}`,
          filename: "timestamp.tsr",
          contentType: "application/timestamp-reply",
          body: ts.token,
        });
        timestampTokenKey = tokenUpload.key;
        timestampStatus = "OK";
        timestampTsaUrl = ts.tsaUrl;
        timestampedAt = ts.receivedAt;
      } else {
        timestampStatus = "FAILED";
        timestampTsaUrl = ts.tsaUrl;
        logger.warn({ err: ts.error, assessmentId: assessment.id }, "return assessment timestamp failed");
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.inspection.update({
          where: { id: assessment.inspectionId },
          data: { status: "COMPLETED" },
        });

        // Bond ledger + BOND_CAPTURE / BOND_RELEASE bookkeeping for the
        // Stripe operation performed above. Terminal-consistent with the DB
        // CHECK (captured + released == held) — a partial capture finalises
        // the hold.
        let bondCapturePaymentId: string | null = null;
        const bondDeductions: Array<{ reason: string; amount: number }> = [];
        if (ledger && bondCaptured) {
          const capturePayment = await tx.payment.create({
            data: {
              reference: `BOND-CAP-RET-${assessment.id}`,
              customerId: assessment.booking.customerId,
              bookingId: assessment.bookingId,
              type: "BOND_CAPTURE",
              method: "STRIPE",
              amount: fromBond,
              // Bond-funded recovery of taxable fees (damage/late/fuel/cleaning)
              // — GST-inclusive like the card-residual slices raised below.
              gstAmount: gstFromInclusive(fromBond),
              status: "SUCCEEDED",
              stripePaymentIntentId: ledger.stripePaymentIntentId,
              stripeChargeId: bondCaptureChargeId,
              processedAt: new Date(),
              processedById: ctx.user.id,
              notes: `Bond applied at return — assessment ${assessment.assessmentNumber}`,
            },
          });
          bondCapturePaymentId = capturePayment.id;
          if (bondReleased > 0) {
            await tx.payment.create({
              data: {
                reference: `RET-RELEASE-${assessment.id}`,
                customerId: assessment.booking.customerId,
                bookingId: assessment.bookingId,
                type: "BOND_RELEASE",
                method: "STRIPE",
                amount: bondReleased,
                status: "SUCCEEDED",
                processedAt: new Date(),
                notes: "Bond remainder released at return",
              },
            });
          }
        } else if (ledger && bondReleasedNow > 0) {
          await tx.payment.create({
            data: {
              reference: `RET-RELEASE-${assessment.id}`,
              customerId: assessment.booking.customerId,
              bookingId: assessment.bookingId,
              type: "BOND_RELEASE",
              method: "STRIPE",
              amount: bondReleasedNow,
              status: "SUCCEEDED",
              processedAt: new Date(),
              notes: "Bond released at return — nothing owed",
            },
          });
          await tx.bondLedger.update({
            where: { id: ledger.id },
            data: {
              status: "RELEASED",
              releasedAmount: r2(Number(ledger.heldAmount) - Number(ledger.capturedAmount)),
            },
          });
        }

        // Allocate bond funds across the assessed lines (damage first, then
        // late, fuel, cleaning); only the RESIDUAL beyond the bond becomes a
        // PENDING card charge for the capture sweep. `remainingBond` is what
        // the single combined capture above actually collected.
        let remainingBond = bondCaptured ? fromBond : 0;
        const takeFromBond = (amount: number, reason: string): { bondShare: number; residual: number } => {
          const bondShare = r2(Math.min(remainingBond, amount));
          remainingBond = r2(remainingBond - bondShare);
          if (bondShare > 0) bondDeductions.push({ reason, amount: bondShare });
          return { bondShare, residual: r2(amount - bondShare) };
        };

        for (const c of assessment.damageCharges.filter((x) => x.resolution === "STANDARD")) {
          // Post-excess-cap figure — the DamageCharge row records what was
          // actually charged (getDamageLiabilityUsed sums these), while the
          // EXCESS_CAP_APPLIED audit keeps the pre-cap trail.
          const amountNumber = chargedAmountById.get(c.id) ?? Number(c.amount);
          if (amountNumber > 0) {
            const { bondShare, residual } = takeFromBond(
              amountNumber,
              `Damage: ${c.description.slice(0, 80)}`,
            );
            if (residual > 0) {
              const payment = await tx.payment.create({
                data: {
                  reference: `DMG-${c.id}`,
                  customerId: assessment.booking.customerId,
                  bookingId: assessment.bookingId,
                  type: "DAMAGE_CHARGE",
                  method: "STRIPE",
                  amount: residual,
                  gstAmount: gstFromInclusive(residual),
                  status: "PENDING",
                  notes:
                    `DamageCharge ${c.id} on booking ${assessment.booking.bookingReference}: ${c.description.slice(0, 140)}` +
                    (bondShare > 0 ? ` (residual beyond A$${bondShare.toFixed(2)} bond)` : ""),
                  processedById: ctx.user.id,
                },
              });
              await tx.damageCharge.update({
                where: { id: c.id },
                data: {
                  amount: amountNumber,
                  status: "CONFIRMED",
                  capturedPaymentId: payment.id,
                  bondDeductionCents: bondShare > 0 ? Math.round(bondShare * 100) : null,
                  resolvedAt: new Date(),
                  resolvedById: ctx.user.id,
                },
              });
            } else {
              // Fully bond-funded — settled by the capture above.
              await tx.damageCharge.update({
                where: { id: c.id },
                data: {
                  amount: amountNumber,
                  status: "CAPTURED",
                  capturedPaymentId: bondCapturePaymentId,
                  bondDeductionCents: Math.round(bondShare * 100),
                  resolvedAt: new Date(),
                  resolvedById: ctx.user.id,
                },
              });
            }
          } else {
            await tx.damageCharge.update({
              where: { id: c.id },
              data: {
                amount: amountNumber,
                status: "CONFIRMED",
                resolvedAt: new Date(),
                resolvedById: ctx.user.id,
              },
            });
          }
        }
        // Excess-capped QUOTE_PENDING acknowledgements: persist the clamped
        // cap so close-out (which bills min(final, quoteCapAmount, headroom))
        // can never exceed what the excess allows.
        for (const q of cappedQuoteLines) {
          await tx.damageCharge.update({
            where: { id: q.id },
            data: { quoteCapAmount: q.cap },
          });
        }
        if (cappedStandardLines.length > 0 || cappedQuoteLines.length > 0) {
          const parts = [
            ...cappedStandardLines.map(
              (l) => `${l.description.slice(0, 60)}: A$${l.preCap.toFixed(2)} → A$${l.charged.toFixed(2)}`,
            ),
            ...cappedQuoteLines.map(
              (l) => `${l.description.slice(0, 60)} (quote cap): A$${l.preCap.toFixed(2)} → A$${l.cap.toFixed(2)}`,
            ),
          ];
          await tx.bookingNote.create({
            data: {
              bookingId: assessment.bookingId,
              userId: ctx.user.id,
              note:
                `Insurance excess cap applied at return (excess A$${bookingExcess.excess.toFixed(2)}${
                  bookingExcess.tierName ? ` — ${bookingExcess.tierName}` : ""
                }, A$${liabilityUsedBefore.toFixed(2)} already used): ${parts.join("; ")}`,
              isInternal: true,
            },
          });
        }
        await tx.damageCharge.updateMany({
          where: { returnAssessmentId: assessment.id, resolution: { in: ["WAIVED", "WARRANTY"] } },
          data: { status: "WAIVED", resolvedAt: new Date(), resolvedById: ctx.user.id },
        });
        if (fees.lateFee > 0) {
          const { bondShare, residual } = takeFromBond(fees.lateFee, "Late return fee");
          if (residual > 0) {
            await tx.payment.create({
              data: {
                reference: `LATE-${assessment.id}`,
                customerId: assessment.booking.customerId,
                bookingId: assessment.bookingId,
                type: "LATE_FEE",
                method: "STRIPE",
                amount: residual,
                gstAmount: gstFromInclusive(residual),
                status: "PENDING",
                notes:
                  `Late return fee — ${fees.lateHours.toFixed(2)}h beyond grace on ${assessment.booking.bookingReference}` +
                  (bondShare > 0 ? ` (residual beyond bond)` : ""),
                processedById: ctx.user.id,
              },
            });
          }
        }
        if (fees.fuelCharge > 0) {
          const { bondShare, residual } = takeFromBond(fees.fuelCharge, "Refuel charge");
          if (residual > 0) {
            await tx.payment.create({
              data: {
                reference: `FUEL-${assessment.id}`,
                customerId: assessment.booking.customerId,
                bookingId: assessment.bookingId,
                type: "FUEL_CHARGE",
                method: "STRIPE",
                amount: residual,
                gstAmount: gstFromInclusive(residual),
                status: "PENDING",
                notes:
                  `Refuel charge — ${fees.missingLitres.toFixed(2)}L on ${assessment.booking.bookingReference}` +
                  (bondShare > 0 ? ` (residual beyond bond)` : ""),
                processedById: ctx.user.id,
              },
            });
          }
        }

        // Land the terminal ledger state for a capture, including the
        // per-line deduction trail composed above.
        if (ledger && bondCaptured) {
          const existingDeductions = Array.isArray(ledger.deductions)
            ? [...(ledger.deductions as Array<{ reason: string; amount: number }>)]
            : [];
          const newCaptured = r2(Number(ledger.capturedAmount) + fromBond);
          await tx.bondLedger.update({
            where: { id: ledger.id },
            data: {
              status: "FULLY_CAPTURED",
              capturedAmount: newCaptured,
              releasedAmount: r2(Number(ledger.heldAmount) - newCaptured),
              deductions: [...existingDeductions, ...bondDeductions] as unknown as Prisma.InputJsonValue,
            },
          });
        }
        await tx.returnAssessment.update({
          where: { id: assessment.id },
          data: {
            status: "SIGNED",
            signedAt: now,
            lateFeeAmount: fees.lateFee,
            fuelChargeAmount: fees.fuelCharge,
            damageChargesTotal: standardTotal,
            pendingQuoteCap: pendingCapTotal,
            customerTotalDueNow: totalDueNow,
            pdfUrl: pdfUpload.url,
            pdfKey: pdfUpload.key,
            timestampTokenKey: timestampTokenKey ?? undefined,
            timestampStatus,
            timestampTsaUrl: timestampTsaUrl ?? undefined,
            timestampedAt: timestampedAt ?? undefined,
          },
        });
        if (cleaningFee > 0) {
          const { bondShare, residual } = takeFromBond(cleaningFee, "Cleaning fee");
          await tx.booking.update({
            where: { id: assessment.bookingId },
            data: {
              cleaningFee,
              bookingNotes: {
                create: {
                  userId: ctx.user.id,
                  note: `Cleaning fee A$${cleaningFee.toFixed(2)}${input.cleaningReason ? ` — ${input.cleaningReason}` : ""}${bondShare > 0 ? ` (A$${bondShare.toFixed(2)} from bond)` : ""}`,
                  isInternal: false,
                },
              },
              ...(residual > 0
                ? {
                    payments: {
                      create: {
                        reference: `CLEAN-${assessment.bookingId}-${Date.now()}`,
                        customerId: assessment.booking.customerId,
                        type: "CLEANING_FEE",
                        method: "STRIPE",
                        amount: residual,
                        gstAmount: gstFromInclusive(residual),
                        status: "PENDING",
                        notes: input.cleaningReason ?? "Post-hire cleaning fee",
                      },
                    },
                  }
                : {}),
            },
          });
        }
        // Only the residual beyond the bond capture is owed on the card:
        // those PENDING rows enter balanceDue here so applyCaptureToBalanceDue
        // can net them out on capture — keeping the "raised → added,
        // collected → removed" invariant (see balance-due.ts). Bond-funded
        // amounts were collected in the capture above and never touch
        // balanceDue.
        if (overflow > 0) {
          await tx.booking.update({
            where: { id: assessment.bookingId },
            data: { balanceDue: { increment: overflow } },
          });
        }
        await autoCloseByTarget(tx, "ReturnAssessment", assessment.id, {
          types: ["RETURN_ASSESSMENT_FINALISE"],
          reason: "completed",
          closingUserId: ctx.user.id,
        });
        await autoCloseByTarget(tx, "Inspection", assessment.inspectionId, {
          types: ["INSPECTION_POST_HIRE"],
          reason: "completed",
          closingUserId: ctx.user.id,
        });
      });

      if (cappedStandardLines.length > 0 || cappedQuoteLines.length > 0) {
        await writeAudit(ctx.prisma, {
          userId: ctx.user.id,
          action: "EXCESS_CAP_APPLIED",
          entity: "ReturnAssessment",
          entityId: assessment.id,
          newData: {
            bookingId: assessment.bookingId,
            excess: bookingExcess.excess,
            excessSource: bookingExcess.source,
            tierName: bookingExcess.tierName,
            usedBefore: liabilityUsedBefore,
            capRemainingBefore: initialCapRemaining,
            cappedStandardLines,
            cappedQuoteLines,
          },
        });
      }
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "RETURN_ASSESSMENT_SIGNED",
        entity: "ReturnAssessment",
        entityId: assessment.id,
        newData: {
          bookingId: assessment.bookingId,
          totalDueNow,
          pendingQuoteCap: pendingCapTotal,
          timestampStatus,
        },
      });
      const signedAudit = {
        userId: ctx.user.id,
        action: "RETURN_ASSESSMENT_SIGNED",
        reqId: ctx.reqId,
        newData: {
          assessmentId: assessment.id,
          bookingId: assessment.bookingId,
          totalDueNow,
          pendingQuoteCap: pendingCapTotal,
          timestampStatus,
        },
      };
      writeCustomerAuditAsync(ctx.prisma, assessment.booking?.customerId, signedAudit);
      writeBookingAuditAsync(ctx.prisma, assessment.bookingId, signedAudit);

      return { pdfUrl: pdfUpload.url, assessmentId: assessment.id, totalDueNow, pendingQuoteCap: pendingCapTotal };
    }),

  /** Fetch assessment by booking id — staff. */
  byBooking: staffProcedure.input(z.object({ bookingId: z.string() })).query(({ ctx, input }) =>
    ctx.prisma.returnAssessment.findUnique({
      where: { bookingId: input.bookingId },
      include: {
        // Creation order — the excess cap consumes headroom line by line at
        // finalise, so the assess page must project the clamp the same way.
        damageCharges: { include: { damageTariff: true }, orderBy: { createdAt: "asc" } },
        staff: { select: { firstName: true, lastName: true } },
      },
    }),
  ),

  /** Customer portal — fetch their return assessments. */
  forCustomer: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "CUSTOMER") return [];
    return ctx.prisma.returnAssessment.findMany({
      where: { booking: { customerId: ctx.user.id }, status: { in: ["SIGNED", "FINALISED"] } },
      orderBy: { signedAt: "desc" },
      include: { booking: { select: { bookingReference: true, pickupDateTime: true } } },
    });
  }),

  /**
   * G4 — Transition a DamageCharge from PROVISIONAL to CONFIRMED and create
   * the corresponding Payment row (PENDING). The capture-pending-payments
   * job (G5) picks it up on the next tick and attempts off-session capture
   * against the customer's stored default PM (G6).
   *
   * Guard rails:
   *   - Parent ReturnAssessment must be SIGNED (the charge isn't final
   *     otherwise — staff could still be editing).
   *   - DamageCharge.resolution must be STANDARD. QUOTE_PENDING flows go
   *     through the MaintenanceWorkOrder close-out (separate endpoint, not
   *     in P0). WAIVED / WARRANTY never produce a Payment.
   *   - DamageCharge.status must be PROVISIONAL. A second call is a no-op
   *     that re-returns the existing capturedPayment.
   *   - `amount` must be > 0. Zero-amount charges are recorded but not
   *     captured.
   *
   * The transition writes a fresh Payment row only when capturedPaymentId
   * is null — if a PROVISIONAL → CONFIRMED → FAILED → PROVISIONAL reset
   * ever happens (not in P0), the existing Payment is reused.
   */
  confirmCharge: staffProcedure
    .input(z.object({ damageChargeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const charge = await ctx.prisma.damageCharge.findUniqueOrThrow({
        where: { id: input.damageChargeId },
        include: {
          returnAssessment: {
            select: {
              id: true,
              status: true,
              bookingId: true,
              booking: { select: { customerId: true, bookingReference: true } },
            },
          },
          inspection: { select: { id: true } },
        },
      });

      if (charge.returnAssessment.status !== "SIGNED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm a charge on a ${charge.returnAssessment.status} assessment`,
        });
      }
      if (charge.resolution !== "STANDARD") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm charge with resolution ${charge.resolution} via this endpoint`,
        });
      }
      if (charge.status === "CAPTURED" || charge.status === "CONFIRMED") {
        // Idempotent: return current state. If there's already a Payment
        // linked, the capture-pending-payments job owns progress from here.
        return { damageCharge: charge, paymentId: charge.capturedPaymentId ?? null };
      }
      if (charge.status === "WAIVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Charge is WAIVED" });
      }
      const amountNumber = Number(charge.amount);
      if (!(amountNumber > 0)) {
        // Zero-amount charges can still transition to CONFIRMED without a
        // Payment — useful for book-keeping when the actual cost was
        // absorbed by warranty but the record is needed for history.
        const updated = await ctx.prisma.damageCharge.update({
          where: { id: charge.id },
          data: {
            status: "CONFIRMED",
            resolvedById: ctx.user.id,
            resolvedAt: new Date(),
          },
        });
        await writeAudit(ctx.prisma, {
          userId: ctx.user.id,
          action: "DAMAGE_CHARGE_CONFIRMED_ZERO",
          entity: "DamageCharge",
          entityId: charge.id,
          previousData: { status: charge.status },
          newData: { status: "CONFIRMED", amount: 0 },
        });
        writeBookingAuditAsync(ctx.prisma, charge.returnAssessment.bookingId, {
          userId: ctx.user.id,
          action: "DAMAGE_CHARGE_CONFIRMED_ZERO",
          reqId: ctx.reqId,
          newData: { damageChargeId: charge.id, amount: 0 },
        });
        return { damageCharge: updated, paymentId: null };
      }

      const customerId = charge.returnAssessment.booking?.customerId ?? null;
      if (!customerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking has no customer — cannot create a Payment",
        });
      }
      const bookingId = charge.returnAssessment.bookingId;
      const bookingReference = charge.returnAssessment.booking?.bookingReference ?? charge.id;
      // Reference is unique — a single DamageCharge can only spawn one
      // Payment by construction (second confirm hits the idempotent branch
      // above before we get here).
      const reference = `DMG-${charge.id}`;

      const { payment, damageCharge } = await ctx.prisma.$transaction(async (tx) => {
        const existing = charge.capturedPaymentId
          ? await tx.payment.findUnique({ where: { id: charge.capturedPaymentId } })
          : null;
        const payment =
          existing ??
          (await tx.payment.create({
            data: {
              reference,
              customerId,
              bookingId,
              type: "DAMAGE_CHARGE",
              method: "STRIPE",
              amount: charge.amount,
              status: "PENDING",
              notes: `DamageCharge ${charge.id} on booking ${bookingReference}: ${charge.description.slice(0, 140)}`,
              processedById: ctx.user.id,
            },
          }));
        // Newly-raised PENDING charge → add to balanceDue so the eventual
        // capture nets it out (see balance-due.ts). Skipped when re-confirming
        // an already-raised charge (idempotent path above), which would
        // otherwise double-count.
        if (!existing && bookingId) {
          await tx.booking.update({
            where: { id: bookingId },
            data: { balanceDue: { increment: amountNumber } },
          });
        }
        const damageCharge = await tx.damageCharge.update({
          where: { id: charge.id },
          data: {
            status: "CONFIRMED",
            capturedPaymentId: payment.id,
            resolvedById: ctx.user.id,
            resolvedAt: new Date(),
          },
        });
        return { payment, damageCharge };
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "DAMAGE_CHARGE_CONFIRMED",
        entity: "DamageCharge",
        entityId: damageCharge.id,
        previousData: { status: charge.status, capturedPaymentId: charge.capturedPaymentId },
        newData: {
          status: "CONFIRMED",
          capturedPaymentId: payment.id,
          paymentReference: payment.reference,
          amount: amountNumber,
        },
      });
      const confirmedAudit = {
        userId: ctx.user.id,
        action: "DAMAGE_CHARGE_CONFIRMED",
        reqId: ctx.reqId,
        newData: {
          damageChargeId: damageCharge.id,
          bookingId,
          bookingReference,
          paymentId: payment.id,
          paymentReference: payment.reference,
          amount: amountNumber,
        },
      };
      writeCustomerAuditAsync(ctx.prisma, customerId, confirmedAudit);
      writeBookingAuditAsync(ctx.prisma, bookingId, confirmedAudit);
      return { damageCharge, paymentId: payment.id };
    }),

  /**
   * Close out a QUOTE_PENDING damage charge once the repair quote / work
   * order lands: bill the FINAL amount (hard-capped at the quoteCapAmount
   * the customer initialled at return) as a PENDING card charge collected
   * off-session. Previously the expensive quote-required repairs had no
   * Payment path at all — collection depended on staff remembering to raise
   * a fresh ad-hoc charge.
   */
  closeOutQuote: staffProcedure
    .input(
      z.object({
        damageChargeId: z.string(),
        /** Final repair cost from the quote / completed work order (AUD). */
        finalAmount: z.number().min(0),
      }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const charge = await ctx.prisma.damageCharge.findUniqueOrThrow({
        where: { id: input.damageChargeId },
        include: {
          returnAssessment: {
            select: {
              id: true,
              status: true,
              bookingId: true,
              booking: { select: { customerId: true, bookingReference: true } },
            },
          },
        },
      });
      captureBookingId(ctx, charge.returnAssessment.bookingId);
      if (charge.resolution !== "QUOTE_PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only QUOTE_PENDING charges can be closed out (this one is ${charge.resolution}).`,
        });
      }
      if (charge.returnAssessment.status !== "SIGNED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot close out a charge on a ${charge.returnAssessment.status} assessment`,
        });
      }
      if (charge.status === "CAPTURED" || charge.capturedPaymentId) {
        return { damageCharge: charge, paymentId: charge.capturedPaymentId ?? null };
      }
      if (charge.status === "WAIVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Charge is WAIVED" });
      }
      const customerId = charge.returnAssessment.booking?.customerId ?? null;
      if (!customerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking has no customer — cannot create a Payment",
        });
      }
      const cap = Number(charge.quoteCapAmount ?? 0);
      const bookingId = charge.returnAssessment.bookingId;
      const bookingReference = charge.returnAssessment.booking?.bookingReference ?? charge.id;
      // Two ceilings apply: the signed acknowledgement (quoteCapAmount) and
      // the hire's remaining insurance-excess headroom (per-hire aggregate —
      // standard lines and incident charges already drew on it).
      const ackCapped = Math.round(Math.min(input.finalAmount, cap > 0 ? cap : input.finalAmount) * 100) / 100;
      const bookingExcess = await getBookingExcess(ctx.prisma, bookingId);
      const liabilityUsed = await getDamageLiabilityUsed(ctx.prisma, bookingId);
      const {
        chargeable: billAmount,
        cappedBy: excessCappedBy,
        capRemaining,
      } = applyExcessCap({
        proposed: ackCapped,
        used: liabilityUsed,
        excess: bookingExcess.excess,
      });

      const { payment, damageCharge } = await ctx.prisma.$transaction(async (tx) => {
        let payment: { id: string; reference: string } | null = null;
        if (billAmount > 0) {
          payment = await tx.payment.create({
            data: {
              reference: `DMG-${charge.id}`,
              customerId,
              bookingId,
              type: "DAMAGE_CHARGE",
              method: "STRIPE",
              amount: billAmount,
              gstAmount: gstFromInclusive(billAmount),
              status: "PENDING",
              notes: `Quote close-out — DamageCharge ${charge.id} on ${bookingReference} (final ${input.finalAmount.toFixed(2)}, cap ${cap.toFixed(2)})`,
              processedById: ctx.user.id,
            },
          });
          // Raised PENDING → enters balanceDue; the capture sweep collects it
          // off-session and nets it back out (balance-due.ts contract).
          await tx.booking.update({
            where: { id: bookingId },
            data: { balanceDue: { increment: billAmount } },
          });
        }
        const damageCharge = await tx.damageCharge.update({
          where: { id: charge.id },
          data: {
            amount: billAmount,
            status: "CONFIRMED",
            capturedPaymentId: payment?.id ?? null,
            resolvedById: ctx.user.id,
            resolvedAt: new Date(),
          },
        });
        return { payment, damageCharge };
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "DAMAGE_QUOTE_CLOSED_OUT",
        entity: "DamageCharge",
        entityId: damageCharge.id,
        previousData: { status: charge.status, quoteCapAmount: cap },
        newData: {
          billedAmount: billAmount,
          finalQuoteAmount: input.finalAmount,
          paymentId: payment?.id ?? null,
          excess: bookingExcess.excess,
          excessUsedBefore: liabilityUsed,
          excessCapRemaining: capRemaining,
          excessCappedBy,
        },
      });
      writeBookingAuditAsync(ctx.prisma, bookingId, {
        userId: ctx.user.id,
        action: "DAMAGE_QUOTE_CLOSED_OUT",
        reqId: ctx.reqId,
        newData: {
          damageChargeId: damageCharge.id,
          billedAmount: billAmount,
          paymentId: payment?.id ?? null,
        },
      });
      return { damageCharge, paymentId: payment?.id ?? null };
    }),

  /** Admin/Manager-only: void an assessment (rare). */
  void: managerProcedure
    .input(z.object({ assessmentId: z.string(), reason: z.string().min(3) }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
      });
      if (a.status === "SUPERSEDED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already superseded" });
      }
      await ctx.prisma.returnAssessment.update({
        where: { id: a.id },
        data: { status: "SUPERSEDED" },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "RETURN_ASSESSMENT_VOIDED",
        entity: "ReturnAssessment",
        entityId: a.id,
        newData: { reason: input.reason },
      });
      writeBookingAuditAsync(ctx.prisma, a.bookingId, {
        userId: ctx.user.id,
        action: "RETURN_ASSESSMENT_VOIDED",
        reqId: ctx.reqId,
        newData: { assessmentId: a.id, reason: input.reason },
      });
      return { ok: true as const };
    }),
});
