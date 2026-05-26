import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { BikeType, FleetUseCase, RiderLevel } from "@prisma/client";
import { createTRPCRouter, staffProcedure } from "../trpc";
import { enqueueEnrichVehicleModel } from "@/server/jobs/enrich-vehicle-model";
import { runEnrichment } from "@/server/services/vehicle-enrichment";
import { deleteFile, getSignedUrl } from "@/lib/storage";
import { domainOf, isAllowedDocumentSource } from "@/server/services/vehicle-enrichment/allowlist";

const DOCUMENT_TYPES = [
  "OWNERS_MANUAL",
  "SERVICE_SCHEDULE",
  "PARTS_CATALOGUE",
  "WIRING_DIAGRAM",
  "BROCHURE",
] as const;

/**
 * Patchable spec fields. All nullable — admins can explicitly clear a
 * value by setting it to null (e.g. to retry enrichment), or leave it
 * `undefined` to skip the field.
 */
const updateSpecInput = z.object({
  id: z.string(),
  categoryId: z.string().nullable().optional(),
  engineCapacityCc: z.number().int().positive().nullable().optional(),
  enginePowerKw: z.number().nonnegative().nullable().optional(),
  engineTorqueNm: z.number().nonnegative().nullable().optional(),
  dryWeightKg: z.number().nonnegative().nullable().optional(),
  fuelTankLitres: z.number().nonnegative().nullable().optional(),
  fuelType: z.string().max(40).nullable().optional(),
  topSpeedKmh: z.number().int().nonnegative().nullable().optional(),
  seatHeightMm: z.number().int().nonnegative().nullable().optional(),
  tyreFront: z.string().max(40).nullable().optional(),
  tyreRear: z.string().max(40).nullable().optional(),
  serviceIntervalKm: z.number().int().positive().nullable().optional(),
  serviceIntervalMonths: z.number().int().positive().nullable().optional(),
  // Provenance — set to MANUAL when an admin hand-enters values so the
  // next enrichment run doesn't silently overwrite their work.
  specsSourceName: z.string().max(80).nullable().optional(),
  specsConfidence: z
    .enum(["OFFICIAL_MANUFACTURER", "REPUTABLE_SECONDARY", "UNVERIFIED"])
    .optional(),
});

/**
 * Per-model classification (browse/filter taxonomy). Each axis is sent in
 * full (the client owns the complete set of toggles), so arrays replace —
 * Prisma treats `{ bikeTypes: [...] }` as `set`.
 */
export const updateClassificationInput = z.object({
  id: z.string(),
  bikeTypes: z.array(z.nativeEnum(BikeType)),
  riderLevels: z.array(z.nativeEnum(RiderLevel)),
  useCases: z.array(z.nativeEnum(FleetUseCase)),
});
export type UpdateClassificationInput = z.infer<typeof updateClassificationInput>;

export const vehicleModelRouter = createTRPCRouter({
  list: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.vehicleModel.findMany({
      orderBy: [{ make: "asc" }, { model: "asc" }, { year: "desc" }],
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { documents: true, vehicles: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      make: r.make,
      model: r.model,
      year: r.year,
      slug: r.slug,
      category: r.category,
      engineCapacityCc: r.engineCapacityCc,
      useCases: r.useCases,
      bikeTypes: r.bikeTypes,
      riderLevels: r.riderLevels,
      specsConfidence: r.specsConfidence,
      specsFetchedAt: r.specsFetchedAt,
      specsSourceName: r.specsSourceName,
      documentCount: r._count.documents,
      vehicleCount: r._count.vehicles,
      lastEnrichmentError: r.lastEnrichmentError,
    }));
  }),

  get: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.vehicleModel.findUnique({
        where: { id: input.id },
        include: {
          category: { select: { id: true, name: true } },
          documents: { orderBy: { fetchedAt: "desc" } },
          vehicles: {
            select: { id: true, internalCode: true, rego: true, regoState: true },
          },
        },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const documents = await Promise.all(
        row.documents.map(async (d) => ({
          ...d,
          downloadUrl: d.storageKey ? await getSignedUrl(d.storageKey) : d.fileUrl,
        })),
      );

      return { ...row, documents };
    }),

  update: staffProcedure.input(updateSpecInput).mutation(async ({ ctx, input }) => {
    const { id, ...patch } = input;
    const existing = await ctx.prisma.vehicleModel.findUnique({ where: { id } });
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

    // Any manual edit flips `specsConfidence` to MANUFACTURER-equivalent
    // trust unless the admin specifically chose a tier — we treat a
    // staff-curated catalogue entry as at least as trustworthy as a
    // secondary source.
    const confidenceAfter =
      patch.specsConfidence ??
      (existing.specsConfidence === "UNVERIFIED" ? "REPUTABLE_SECONDARY" : existing.specsConfidence);

    await ctx.prisma.vehicleModel.update({
      where: { id },
      data: {
        ...patch,
        specsConfidence: confidenceAfter,
        specsFetchedAt: new Date(),
        lastEnrichmentError: null,
      },
    });
    return { ok: true };
  }),

  // Classification (bike types / rider levels / use cases) is a separate
  // browse-and-filter taxonomy, NOT spec data — so it deliberately does NOT
  // touch `specsFetchedAt` / `specsConfidence`. Toggling a tag must never make
  // the catalogue claim the manufacturer specs were re-verified.
  updateClassification: staffProcedure
    .input(updateClassificationInput)
    .mutation(async ({ ctx, input }) => {
      const { id, bikeTypes, riderLevels, useCases } = input;
      const existing = await ctx.prisma.vehicleModel.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.prisma.vehicleModel.update({
        where: { id },
        data: { bikeTypes, riderLevels, useCases },
      });
      return { ok: true };
    }),

  enqueueEnrichment: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const model = await ctx.prisma.vehicleModel.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!model) throw new TRPCError({ code: "NOT_FOUND" });

      const jobId = await enqueueEnrichVehicleModel(input.id);
      if (jobId) return { mode: "queued" as const, jobId };

      const summary = await runEnrichment(ctx.prisma, input.id);
      return { mode: "inline" as const, summary };
    }),

  attachDocument: staffProcedure
    .input(
      z.object({
        modelId: z.string(),
        type: z.enum(DOCUMENT_TYPES),
        title: z.string().min(1).max(200),
        fileUrl: z.string().url(),
        storageKey: z.string().optional(),
        sourceUrl: z.string().url().optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        language: z.string().max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = await ctx.prisma.vehicleModel.findUnique({
        where: { id: input.modelId },
        select: { id: true },
      });
      if (!model) throw new TRPCError({ code: "NOT_FOUND" });

      // If the admin is attaching a URL they pasted (rather than one
      // we uploaded), enforce the same allowlist as the scraper —
      // "manuals from manualslib.com" is exactly what we're trying to
      // prevent. The file-upload path sets sourceUrl to our own storage
      // URL, which is trusted by construction.
      const sourceUrl = input.sourceUrl ?? input.fileUrl;
      const isOurStorage = input.storageKey !== undefined;
      if (!isOurStorage && !isAllowedDocumentSource(sourceUrl)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Source URL must be an allowlisted manufacturer domain. Upload the file instead if you have it locally.",
        });
      }

      await ctx.prisma.vehicleModelDocument.create({
        data: {
          modelId: input.modelId,
          type: input.type,
          title: input.title,
          fileUrl: input.fileUrl,
          storageKey: input.storageKey,
          sourceUrl,
          sourceDomain: isOurStorage ? "uploaded" : domainOf(sourceUrl),
          sizeBytes: input.sizeBytes,
          language: input.language ?? "en-AU",
        },
      });

      return { ok: true };
    }),

  deleteDocument: staffProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.prisma.vehicleModelDocument.findUnique({
        where: { id: input.documentId },
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      if (doc.storageKey) {
        // Best-effort — if the file is already gone, continue and drop
        // the DB row so the UI doesn't display a broken entry.
        await deleteFile(doc.storageKey).catch(() => undefined);
      }
      await ctx.prisma.vehicleModelDocument.delete({ where: { id: doc.id } });
      return { ok: true };
    }),
});
