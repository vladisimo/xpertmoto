import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { uploadFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { domainOf, isAllowedDocumentSource } from "./allowlist";
import { hondaRecipe } from "./sources/honda";
import { yamahaRecipe } from "./sources/yamaha";
import { piaggioRecipe } from "./sources/piaggio";
import { kymcoRecipe } from "./sources/kymco";
import { symRecipe } from "./sources/sym";
import type { DocumentCandidate, SourceRecipe } from "./types";

const log = logger.child({ component: "vehicle-enrichment" });

const RECIPES: Record<string, SourceRecipe> = {
  honda: hondaRecipe,
  yamaha: yamahaRecipe,
  vespa: piaggioRecipe, // Vespa is a Piaggio-group brand; shares portal
  piaggio: piaggioRecipe,
  kymco: kymcoRecipe,
  sym: symRecipe,
};

function recipeFor(make: string): SourceRecipe | null {
  return RECIPES[make.toLowerCase()] ?? null;
}

export type EnrichmentSummary = {
  modelId: string;
  specsUpdated: boolean;
  documentsAdded: number;
  documentsSkipped: number;
  error?: string;
};

/**
 * Populate a VehicleModel with specs + PDFs from its manufacturer's source
 * recipe. Failures are captured on the row (lastEnrichmentError) rather
 * than thrown — one bad model shouldn't fail a batch.
 */
export async function runEnrichment(
  prisma: PrismaClient,
  modelId: string,
  deps: { uploadFileFn?: typeof uploadFile; fetchFn?: typeof fetch } = {},
): Promise<EnrichmentSummary> {
  const model = await prisma.vehicleModel.findUnique({ where: { id: modelId } });
  if (!model) throw new Error(`VehicleModel ${modelId} not found`);

  const recipe = recipeFor(model.make);
  if (!recipe) {
    await prisma.vehicleModel.update({
      where: { id: modelId },
      data: { lastEnrichmentError: `No recipe for make "${model.make}"` },
    });
    return { modelId, specsUpdated: false, documentsAdded: 0, documentsSkipped: 0, error: "no-recipe" };
  }

  const summary: EnrichmentSummary = {
    modelId,
    specsUpdated: false,
    documentsAdded: 0,
    documentsSkipped: 0,
  };

  const seed = { make: model.make, model: model.model, year: model.year };

  try {
    const specs = await recipe.fetchSpecs(seed);
    if (specs) {
      await prisma.vehicleModel.update({
        where: { id: modelId },
        data: {
          ...toDecimalFields(specs.fields),
          specsSourceUrl: specs.sourceUrl,
          specsSourceName: specs.sourceName,
          specsFetchedAt: new Date(),
          specsConfidence: specs.confidence,
          lastEnrichmentError: null,
        },
      });
      summary.specsUpdated = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ modelId, err: msg }, "specs fetch failed");
    await prisma.vehicleModel.update({
      where: { id: modelId },
      data: { lastEnrichmentError: `specs: ${msg}` },
    });
    summary.error = `specs: ${msg}`;
  }

  let candidates: DocumentCandidate[] = [];
  try {
    candidates = await recipe.listDocuments(seed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ modelId, err: msg }, "document listing failed");
    summary.error = summary.error ? `${summary.error}; docs: ${msg}` : `docs: ${msg}`;
  }

  const uploader = deps.uploadFileFn ?? uploadFile;
  const fetchFn = deps.fetchFn ?? fetch;

  const seenPerType = new Set<string>();
  for (const candidate of candidates) {
    if (seenPerType.has(candidate.type)) continue;
    if (!isAllowedDocumentSource(candidate.sourceUrl)) {
      log.info({ modelId, url: candidate.sourceUrl }, "doc rejected: source not in allowlist");
      summary.documentsSkipped++;
      continue;
    }

    try {
      const res = await fetchFn(candidate.sourceUrl);
      if (!res.ok) {
        summary.documentsSkipped++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const sha256 = createHash("sha256").update(buf).digest("hex");

      const existing = await prisma.vehicleModelDocument.findUnique({
        where: {
          modelId_type_sha256: { modelId, type: candidate.type, sha256 },
        },
      });
      if (existing) {
        seenPerType.add(candidate.type);
        continue;
      }

      const uploaded = await uploader({
        folder: "vehicle-model-documents",
        filename: `${model.slug}-${candidate.type.toLowerCase()}.pdf`,
        contentType: "application/pdf",
        body: buf,
      });

      await prisma.vehicleModelDocument.create({
        data: {
          modelId,
          type: candidate.type,
          title: candidate.title,
          fileUrl: uploaded.url,
          storageKey: uploaded.key,
          sourceUrl: candidate.sourceUrl,
          sourceDomain: domainOf(candidate.sourceUrl),
          sizeBytes: buf.byteLength,
          language: candidate.language ?? "en-AU",
          sha256,
        },
      });

      summary.documentsAdded++;
      seenPerType.add(candidate.type);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ modelId, url: candidate.sourceUrl, err: msg }, "doc fetch failed");
      summary.documentsSkipped++;
    }
  }

  return summary;
}

function toDecimalFields(fields: Record<string, number | string | undefined>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (
      k === "enginePowerKw" ||
      k === "engineTorqueNm" ||
      k === "dryWeightKg" ||
      k === "fuelTankLitres"
    ) {
      out[k] = new Prisma.Decimal(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
