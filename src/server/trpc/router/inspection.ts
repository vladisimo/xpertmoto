import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, staffProcedure } from "../trpc";
import { assertBookingDepotAccess, assertDepotAccess } from "./_depot-scope";
import { autoCloseByTarget } from "@/server/services/staff-tasks";
import {
  captureBookingId,
  captureCustomerId,
  readCapturedBookingId,
  readCapturedCustomerId,
} from "@/server/services/audit";

/** Marker shape accepted from clients. */
export type DamageMarkerInput = {
  id?: string;
  x: number;
  y: number;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  note?: string;
  source: "staff" | "customer";
  view?: "LEFT" | "RIGHT" | "FRONT" | "REAR";
  addedAt?: string;
};

/** Marker shape persisted to Inspection.bodyDamageMap. Pure — no IO, safe to unit-test. */
export type StoredDamageMarker = {
  id?: string;
  x: number;
  y: number;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  note?: string;
  source: "staff" | "customer";
  view: "LEFT" | "RIGHT" | "FRONT" | "REAR";
  addedAt: string;
};

/**
 * Transform caller-supplied markers into the stored JSON shape.
 * Every persisted marker carries a `view` (default LEFT for legacy safety)
 * and an `addedAt` timestamp (preserved if supplied, stamped otherwise).
 */
export function toStoredMarkers(markers: DamageMarkerInput[], now: Date = new Date()): StoredDamageMarker[] {
  return markers.map((m) => ({
    id: m.id,
    x: m.x,
    y: m.y,
    severity: m.severity,
    note: m.note,
    source: m.source,
    view: m.view ?? "LEFT",
    addedAt: m.addedAt ?? now.toISOString(),
  }));
}

export const inspectionRouter = createTRPCRouter({
  create: staffProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        bookingId: z.string().optional(),
        type: z.enum(["PRE_HIRE", "POST_HIRE", "ROUTINE", "INCIDENT"]),
        depotId: z.string(),
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
        damageMarkers: z
          .array(
            z.object({
              id: z.string().optional(),
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
              note: z.string().optional(),
              source: z.enum(["staff", "customer"]).default("staff"),
              view: z.enum(["LEFT", "RIGHT", "FRONT", "REAR"]).default("LEFT"),
            }),
          )
          .default([]),
        /** Leave DRAFT when the inspection is part of a multi-step wizard. */
        status: z.enum(["DRAFT", "COMPLETED"]).default("COMPLETED"),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      // Depot trust boundary: STAFF record inspections at their own depot.
      assertDepotAccess(ctx.user, input.depotId);
      if (input.bookingId) {
        const booking = await ctx.prisma.booking.findUnique({
          where: { id: input.bookingId },
          select: { customerId: true },
        });
        captureCustomerId(ctx, booking?.customerId);
      }

      // Odometer rollback guard. The new reading must not be below the
      // most recent recorded km on this vehicle. Protects against typos
      // and flags potential odometer tamper fraud. Exact equality is
      // fine — matches a bike that didn't move between inspections.
      const latestForVehicle = await ctx.prisma.inspection.findFirst({
        where: { vehicleId: input.vehicleId, status: { not: "DRAFT" } },
        orderBy: { dateTime: "desc" },
        select: { odometerKm: true, id: true, dateTime: true },
      });
      if (latestForVehicle && input.odometerKm < latestForVehicle.odometerKm) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Odometer rollback detected: entered ${input.odometerKm} km, previous inspection recorded ${latestForVehicle.odometerKm} km on ${latestForVehicle.dateTime.toISOString().slice(0, 10)}. Re-check the odometer or flag to a manager if you believe it's correct.`,
        });
      }

      const markers = toStoredMarkers(input.damageMarkers);
      const inspection = await ctx.prisma.inspection.create({
        data: {
          vehicleId: input.vehicleId,
          bookingId: input.bookingId,
          type: input.type,
          depotId: input.depotId,
          inspectorId: ctx.user.id,
          odometerKm: input.odometerKm,
          fuelLevel: input.fuelLevel,
          overallCondition: input.overallCondition,
          tyreFrontDepth: input.tyreFrontDepth,
          tyreRearDepth: input.tyreRearDepth,
          lightsWorking: input.lightsWorking,
          hornWorking: input.hornWorking,
          indicatorsWorking: input.indicatorsWorking,
          engineRunning: input.engineRunning,
          lockProvided: input.lockProvided,
          notes: input.notes,
          bodyDamageMap: { markers } as unknown as Prisma.InputJsonValue,
          status: input.status,
        },
      });
      return inspection;
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.string(),
        odometerKm: z.number().int().min(0).optional(),
        fuelLevel: z.number().int().min(0).max(100).optional(),
        overallCondition: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]).optional(),
        notes: z.string().optional(),
        damageMarkers: z
          .array(
            z.object({
              id: z.string().optional(),
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
              note: z.string().optional(),
              source: z.enum(["staff", "customer"]),
              view: z.enum(["LEFT", "RIGHT", "FRONT", "REAR"]).default("LEFT"),
              addedAt: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: input.id },
        include: { booking: { select: { customerId: true } } },
      });
      assertDepotAccess(ctx.user, inspection.depotId);
      captureCustomerId(ctx, inspection.booking?.customerId);
      captureBookingId(ctx, inspection.bookingId);
      if (inspection.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only DRAFT inspections can be edited" });
      }
      const data: Prisma.InspectionUpdateInput = {};
      if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
      if (input.fuelLevel !== undefined) data.fuelLevel = input.fuelLevel;
      if (input.overallCondition !== undefined) data.overallCondition = input.overallCondition;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.damageMarkers !== undefined) {
        const markers = toStoredMarkers(input.damageMarkers);
        data.bodyDamageMap = { markers } as unknown as Prisma.InputJsonValue;
      }
      return ctx.prisma.inspection.update({ where: { id: input.id }, data });
    }),

  /** Mark a DRAFT inspection COMPLETED (used when agreement step does not auto-complete it). */
  complete: staffProcedure
    .input(z.object({ id: z.string() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const inspection = await ctx.prisma.inspection.findUniqueOrThrow({ where: { id: input.id } });
      assertDepotAccess(ctx.user, inspection.depotId);
      captureBookingId(ctx, inspection.bookingId);
      if (inspection.status === "COMPLETED") return inspection;
      if (inspection.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot complete from ${inspection.status}` });
      }
      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.inspection.update({
          where: { id: input.id },
          data: { status: "COMPLETED" },
        });
        await autoCloseByTarget(tx, "Inspection", input.id, {
          types: ["INSPECTION_PRE_HIRE", "INSPECTION_POST_HIRE"],
          reason: "completed",
          closingUserId: ctx.user.id,
        });
        return updated;
      });
    }),

  /** Return markers on the most recent POST_HIRE inspection that are not present on the PRE_HIRE. */
  diffAgainstPreHire: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertBookingDepotAccess(ctx, input.bookingId);
      const [pre, post] = await Promise.all([
        ctx.prisma.inspection.findFirst({
          where: { bookingId: input.bookingId, type: "PRE_HIRE" },
          orderBy: { dateTime: "desc" },
        }),
        ctx.prisma.inspection.findFirst({
          where: { bookingId: input.bookingId, type: "POST_HIRE" },
          orderBy: { dateTime: "desc" },
        }),
      ]);
      const preMarkers =
        ((pre?.bodyDamageMap as unknown as { markers?: { id?: string }[] })?.markers ?? []) as Array<{
          id?: string;
          x: number;
          y: number;
          severity: string;
          note?: string;
          source?: string;
          view?: string;
        }>;
      const postMarkers =
        ((post?.bodyDamageMap as unknown as { markers?: { id?: string }[] })?.markers ?? []) as Array<{
          id?: string;
          x: number;
          y: number;
          severity: string;
          note?: string;
          source?: string;
          view?: string;
        }>;
      const preIds = new Set(preMarkers.map((m) => m.id).filter(Boolean));
      const newMarkers = postMarkers.filter((m) => !m.id || !preIds.has(m.id));
      return { preHire: pre, postHire: post, preMarkers, postMarkers, newMarkers };
    }),

  byBooking: staffProcedure.input(z.object({ bookingId: z.string() })).query(async ({ ctx, input }) => {
    await assertBookingDepotAccess(ctx, input.bookingId);
    return ctx.prisma.inspection.findMany({
      where: { bookingId: input.bookingId },
      orderBy: { dateTime: "desc" },
      include: {
        photos: true,
        issues: { include: { inspectionPhoto: true, damageTariff: true }, orderBy: { createdAt: "asc" } },
      },
    });
  }),

  byId: staffProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        photos: true,
        issues: { include: { inspectionPhoto: true, damageTariff: true }, orderBy: { createdAt: "asc" } },
      },
    });
    assertDepotAccess(ctx.user, inspection.depotId);
    return inspection;
  }),

  addPhoto: staffProcedure
    .input(z.object({ inspectionId: z.string(), url: z.string().url(), caption: z.string().optional(), damageZone: z.string().optional() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: input.inspectionId },
        select: { bookingId: true, depotId: true },
      });
      assertDepotAccess(ctx.user, inspection.depotId);
      captureBookingId(ctx, inspection.bookingId);
      return ctx.prisma.inspectionPhoto.create({
        data: {
          inspectionId: input.inspectionId,
          url: input.url,
          caption: input.caption,
          damageZone: input.damageZone,
        },
      });
    }),

  removePhoto: staffProcedure
    .input(z.object({ id: z.string() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const photo = await ctx.prisma.inspectionPhoto.findUniqueOrThrow({
        where: { id: input.id },
        select: { inspection: { select: { bookingId: true, depotId: true } } },
      });
      if (photo.inspection) assertDepotAccess(ctx.user, photo.inspection.depotId);
      captureBookingId(ctx, photo.inspection?.bookingId);
      return ctx.prisma.inspectionPhoto.delete({ where: { id: input.id } });
    }),

  // ---- Labelled issues (photo-anchored damage) -----------------------------
  // Supersedes the bodyDamageMap coordinate markers: an issue is anchored to a
  // photo (`inspectionPhotoId`), pinned on it (`posX`/`posY`), and labelled
  // (free text or a DamageTariff). A return-time issue can later become a
  // DamageCharge via return.upsertDamageCharge({ inspectionIssueId }).

  addIssue: staffProcedure
    .input(
      z.object({
        inspectionId: z.string(),
        inspectionPhotoId: z.string().optional(),
        side: z.enum(["FRONT", "REAR", "LEFT", "RIGHT", "TOP", "OTHER"]).optional(),
        damageTariffId: z.string().optional(),
        label: z.string().min(1),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).default("MINOR"),
        note: z.string().optional(),
        posX: z.number().min(0).max(1).optional(),
        posY: z.number().min(0).max(1).optional(),
        source: z.enum(["staff", "customer"]).default("staff"),
        isPreExisting: z.boolean().optional(),
      }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: input.inspectionId },
        select: { depotId: true, bookingId: true, status: true, type: true },
      });
      assertDepotAccess(ctx.user, inspection.depotId);
      captureBookingId(ctx, inspection.bookingId);
      if (inspection.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only DRAFT inspections can be edited" });
      }
      return ctx.prisma.inspectionIssue.create({
        data: {
          inspectionId: input.inspectionId,
          inspectionPhotoId: input.inspectionPhotoId ?? null,
          side: input.side ?? null,
          damageTariffId: input.damageTariffId ?? null,
          label: input.label,
          severity: input.severity,
          note: input.note ?? null,
          posX: input.posX ?? null,
          posY: input.posY ?? null,
          source: input.source,
          isPreExisting: input.isPreExisting ?? inspection.type === "PRE_HIRE",
        },
        include: { inspectionPhoto: true, damageTariff: true },
      });
    }),

  updateIssue: staffProcedure
    .input(
      z.object({
        id: z.string(),
        inspectionPhotoId: z.string().nullable().optional(),
        side: z.enum(["FRONT", "REAR", "LEFT", "RIGHT", "TOP", "OTHER"]).nullable().optional(),
        damageTariffId: z.string().nullable().optional(),
        label: z.string().min(1).optional(),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).optional(),
        note: z.string().nullable().optional(),
        posX: z.number().min(0).max(1).nullable().optional(),
        posY: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const issue = await ctx.prisma.inspectionIssue.findUniqueOrThrow({
        where: { id: input.id },
        select: { inspection: { select: { depotId: true, bookingId: true, status: true } } },
      });
      assertDepotAccess(ctx.user, issue.inspection.depotId);
      captureBookingId(ctx, issue.inspection.bookingId);
      if (issue.inspection.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only DRAFT inspections can be edited" });
      }
      const data: Prisma.InspectionIssueUncheckedUpdateInput = {};
      if (input.inspectionPhotoId !== undefined) data.inspectionPhotoId = input.inspectionPhotoId;
      if (input.side !== undefined) data.side = input.side;
      if (input.damageTariffId !== undefined) data.damageTariffId = input.damageTariffId;
      if (input.label !== undefined) data.label = input.label;
      if (input.severity !== undefined) data.severity = input.severity;
      if (input.note !== undefined) data.note = input.note;
      if (input.posX !== undefined) data.posX = input.posX;
      if (input.posY !== undefined) data.posY = input.posY;
      return ctx.prisma.inspectionIssue.update({
        where: { id: input.id },
        data,
        include: { inspectionPhoto: true, damageTariff: true },
      });
    }),

  removeIssue: staffProcedure
    .input(z.object({ id: z.string() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const issue = await ctx.prisma.inspectionIssue.findUniqueOrThrow({
        where: { id: input.id },
        select: { inspection: { select: { depotId: true, bookingId: true, status: true } } },
      });
      assertDepotAccess(ctx.user, issue.inspection.depotId);
      captureBookingId(ctx, issue.inspection.bookingId);
      if (issue.inspection.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only DRAFT inspections can be edited" });
      }
      return ctx.prisma.inspectionIssue.delete({ where: { id: input.id } });
    }),
});
