import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, managerProcedure, protectedProcedure, staffProcedure } from "../trpc";
import { uploadFile } from "@/lib/storage";
import { renderReturnAssessmentPdf, type ReturnAssessmentData } from "@/lib/agreement/pdf/return-assessment-pdf";
import { requestTimestamp, sha256Buffer } from "@/lib/agreement/timestamp";
import { writeAudit, writeCustomerAuditAsync } from "@/server/services/audit";
import { autoCloseByTarget } from "@/server/services/staff-tasks";
import { logger } from "@/lib/logger";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { getBranding } from "@/lib/branding";
import { gstFromInclusive } from "@/lib/money";

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
        severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
        resolution: z.enum(["STANDARD", "QUOTE_PENDING", "WAIVED", "WARRANTY"]),
        damageTariffId: z.string().optional(),
        amount: z.number().min(0).optional(),
        quoteCapAmount: z.number().min(0).optional(),
        photoUrls: z.array(z.string()).optional(),
        staffNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assessment = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
        include: { booking: true, inspection: true },
      });
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

      const base = {
        description: input.description,
        markerRef: input.markerRef,
        severity: input.severity,
        resolution: input.resolution,
        damageTariffId: input.damageTariffId ?? null,
        amount: input.resolution === "STANDARD" ? (input.amount ?? 0) : 0,
        quoteCapAmount: input.resolution === "QUOTE_PENDING" ? input.quoteCapAmount : null,
        photoUrls: input.photoUrls ?? [],
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
    .mutation(async ({ ctx, input }) => {
      const charge = await ctx.prisma.damageCharge.findUniqueOrThrow({
        where: { id: input.chargeId },
        include: { returnAssessment: true },
      });
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
    .mutation(async ({ ctx, input }) => {
      const assessment = await ctx.prisma.returnAssessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
      });
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
          inspection: { include: { photos: true } },
          staff: true,
          damageCharges: { include: { damageTariff: true } },
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
        select: { fuelLevel: true, bodyDamageMap: true },
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

      const standardTotal = assessment.damageCharges
        .filter((c) => c.resolution === "STANDARD")
        .reduce((acc, c) => acc + Number(c.amount), 0);
      const pendingCapTotal = assessment.damageCharges
        .filter((c) => c.resolution === "QUOTE_PENDING")
        .reduce((acc, c) => acc + Number(c.quoteCapAmount ?? 0), 0);
      const cleaningFee = Math.round((input.cleaningFee ?? 0) * 100) / 100;
      const totalDueNow =
        Math.round(
          (fees.lateFee + fees.fuelCharge + standardTotal + cleaningFee) * 100,
        ) / 100;

      const preHireMarkers =
        ((preHire?.bodyDamageMap as unknown as { markers?: { x: number; y: number; severity: string; view?: "LEFT" | "RIGHT" | "FRONT" | "REAR" }[] })?.markers ?? []).map(
          (m) => ({ x: m.x, y: m.y, severity: m.severity, view: m.view ?? ("LEFT" as const) }),
        );
      const postHireMarkers =
        ((assessment.inspection.bodyDamageMap as unknown as {
          markers?: { x: number; y: number; severity: string; source?: string; view?: "LEFT" | "RIGHT" | "FRONT" | "REAR" }[];
        })?.markers ?? [])
          .filter((m) => m.source !== "pre-hire") // safety
          .map((m) => ({ x: m.x, y: m.y, severity: m.severity, view: m.view ?? ("LEFT" as const) }));

      const bondHeld = Number(assessment.booking.bondAmount);
      const bondApplied = Math.min(bondHeld, totalDueNow);
      const bondReleased = Math.max(0, bondHeld - bondApplied);

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
        preHireMarkers,
        newMarkers: postHireMarkers,
        photos: assessment.inspection.photos.map((p) => ({ url: p.url, caption: p.caption })),
        charges: assessment.damageCharges.map((c) => ({
          description: c.description,
          severity: c.severity,
          resolution: c.resolution,
          amount: Number(c.amount),
          quoteCapAmount: c.quoteCapAmount ? Number(c.quoteCapAmount) : null,
          tariffName: c.damageTariff?.name ?? null,
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
        await tx.damageCharge.updateMany({
          where: { returnAssessmentId: assessment.id, resolution: "STANDARD" },
          data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedById: ctx.user.id },
        });
        await tx.damageCharge.updateMany({
          where: { returnAssessmentId: assessment.id, resolution: { in: ["WAIVED", "WARRANTY"] } },
          data: { status: "WAIVED", resolvedAt: new Date(), resolvedById: ctx.user.id },
        });
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
          await tx.booking.update({
            where: { id: assessment.bookingId },
            data: {
              cleaningFee,
              bookingNotes: {
                create: {
                  userId: ctx.user.id,
                  note: `Cleaning fee A$${cleaningFee.toFixed(2)}${input.cleaningReason ? ` — ${input.cleaningReason}` : ""}`,
                  isInternal: false,
                },
              },
              payments: {
                create: {
                  reference: `CLEAN-${assessment.bookingId}-${Date.now()}`,
                  customerId: assessment.booking.customerId,
                  type: "CLEANING_FEE",
                  method: "STRIPE",
                  amount: cleaningFee,
                  gstAmount: gstFromInclusive(cleaningFee),
                  status: "PENDING",
                  notes: input.cleaningReason ?? "Post-hire cleaning fee",
                },
              },
            },
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
      writeCustomerAuditAsync(ctx.prisma, assessment.booking?.customerId, {
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
      });

      return { pdfUrl: pdfUpload.url, assessmentId: assessment.id, totalDueNow, pendingQuoteCap: pendingCapTotal };
    }),

  /** Fetch assessment by booking id — staff. */
  byBooking: staffProcedure.input(z.object({ bookingId: z.string() })).query(({ ctx, input }) =>
    ctx.prisma.returnAssessment.findUnique({
      where: { bookingId: input.bookingId },
      include: { damageCharges: { include: { damageTariff: true } }, staff: { select: { firstName: true, lastName: true } } },
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
      writeCustomerAuditAsync(ctx.prisma, customerId, {
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
      });
      return { damageCharge, paymentId: payment.id };
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
      return { ok: true as const };
    }),
});
