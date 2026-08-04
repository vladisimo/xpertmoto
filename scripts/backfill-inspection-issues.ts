/**
 * One-shot backfill: promote legacy `Inspection.bodyDamageMap` markers into
 * first-class `InspectionIssue` rows.
 *
 * Why: damage used to be stored as loose JSON coordinate markers in
 * `Inspection.bodyDamageMap` (`{ markers: [...] }`). That column is now
 * `@deprecated` — labelled issues live in the `InspectionIssue` table. This
 * copies every historical marker into an equivalent issue so all damage,
 * old and new, is uniformly readable as issues. The legacy JSON is left in
 * place (read-only for already-signed PDFs); we only add rows.
 *
 * Per marker → one InspectionIssue:
 *   label         = marker.note.trim() || "Marking"
 *   severity      = marker.severity (MINOR|MODERATE|MAJOR), else MINOR
 *   side          = marker.view if FRONT|REAR|LEFT|RIGHT, else null
 *   note          = null (the legacy note became the label)
 *   source        = marker.source === "customer" ? "customer" : "staff"
 *   isPreExisting = inspection.type === "PRE_HIRE"
 *   posX / posY / inspectionPhotoId / damageTariffId = null
 *     (silhouette coords don't map to a photo; legacy markers had no photo link)
 *
 * Idempotent: an inspection is skipped if it already has ANY InspectionIssue
 * row, so re-running never double-creates. Malformed markers (non-objects, or
 * a non-array `markers`) are skipped and counted.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 * Usage:
 *   npx tsx scripts/backfill-inspection-issues.ts            # dry-run
 *   npx tsx scripts/backfill-inspection-issues.ts --apply    # write
 */
import { PrismaClient, Prisma } from "@prisma/client";
import type { DamageSeverity, InspectionType, VehicleSide } from "@prisma/client";

/** How many inspections to pull per page so we never load the table at once. */
const PAGE_SIZE = 200;

/** A single legacy marker, once we've confirmed it's a plain object. */
export type LegacyMarker = Record<string, unknown>;

/** The slice of an Inspection the mapping needs. */
export type InspectionForBackfill = { id: string; type: InspectionType };

/** Legacy `view` values that map straight onto a VehicleSide. TOP/OTHER never
 * appeared in legacy markers, so anything else → null. */
const VIEW_TO_SIDE = ["FRONT", "REAR", "LEFT", "RIGHT"] as const;
const SEVERITIES = ["MINOR", "MODERATE", "MAJOR"] as const;

function coerceSeverity(value: unknown): DamageSeverity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)
    ? (value as DamageSeverity)
    : "MINOR";
}

function coerceSide(value: unknown): VehicleSide | null {
  return typeof value === "string" && (VIEW_TO_SIDE as readonly string[]).includes(value)
    ? (value as VehicleSide)
    : null;
}

/**
 * Pure marker → InspectionIssue mapping. No IO — unit-tested directly.
 * Assumes `marker` is already known to be a plain object (the caller guards
 * that and counts malformed markers separately).
 */
export function markerToIssueData(
  marker: LegacyMarker,
  inspection: InspectionForBackfill,
): Prisma.InspectionIssueCreateManyInput {
  const trimmedNote = typeof marker.note === "string" ? marker.note.trim() : "";

  return {
    inspectionId: inspection.id,
    inspectionPhotoId: null,
    side: coerceSide(marker.view),
    damageTariffId: null,
    label: trimmedNote.length > 0 ? trimmedNote : "Marking",
    severity: coerceSeverity(marker.severity),
    note: null,
    posX: null,
    posY: null,
    source: marker.source === "customer" ? "customer" : "staff",
    isPreExisting: inspection.type === "PRE_HIRE",
  };
}

/** True for a non-null, non-array object we can safely map. */
export function isMarkerObject(value: unknown): value is LegacyMarker {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defensively pull the marker array out of a `bodyDamageMap` JSON value.
 * Returns [] unless it's `{ markers: [...] }`.
 */
export function extractMarkers(bodyDamageMap: unknown): unknown[] {
  if (bodyDamageMap === null || typeof bodyDamageMap !== "object") return [];
  const markers = (bodyDamageMap as { markers?: unknown }).markers;
  return Array.isArray(markers) ? markers : [];
}

function parseArgs(argv: string[]): { apply: boolean } {
  const args = { apply: false };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const p = new PrismaClient();

  let scanned = 0;
  let backfilled = 0;
  let issuesCreated = 0;
  let skippedExisting = 0;
  let markersSkipped = 0;

  try {
    console.log(
      `${args.apply ? "APPLY" : "DRY-RUN"}: scanning inspections for legacy bodyDamageMap markers`,
    );

    let cursor: string | undefined;
    for (;;) {
      const batch = await p.inspection.findMany({
        select: { id: true, type: true, bodyDamageMap: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      const last = batch[batch.length - 1];
      if (!last) break; // empty page — nothing left to scan
      cursor = last.id;

      for (const inspection of batch) {
        scanned++;

        const rawMarkers = extractMarkers(inspection.bodyDamageMap);
        if (rawMarkers.length === 0) continue; // nothing to backfill

        // Idempotency: never touch an inspection that already has issues.
        const existing = await p.inspectionIssue.count({
          where: { inspectionId: inspection.id },
        });
        if (existing > 0) {
          skippedExisting++;
          continue;
        }

        const data: Prisma.InspectionIssueCreateManyInput[] = [];
        for (const raw of rawMarkers) {
          if (!isMarkerObject(raw)) {
            markersSkipped++;
            continue;
          }
          data.push(markerToIssueData(raw, inspection));
        }
        if (data.length === 0) continue; // every marker was malformed

        if (args.apply) {
          await p.inspectionIssue.createMany({ data });
        }
        backfilled++;
        issuesCreated += data.length;
        console.log(
          `  ${inspection.id} (${inspection.type}): ${args.apply ? "created" : "would create"} ${data.length} issue(s)`,
        );
      }

      if (batch.length < PAGE_SIZE) break;
    }

    console.log("");
    console.log("Summary");
    console.log(`  inspections scanned            : ${scanned}`);
    console.log(`  inspections backfilled         : ${backfilled}`);
    console.log(`  issues ${args.apply ? "created " : "to create"}               : ${issuesCreated}`);
    console.log(`  inspections skipped (had issues): ${skippedExisting}`);
    console.log(`  markers skipped (malformed)    : ${markersSkipped}`);
    if (!args.apply) {
      console.log("");
      console.log(`Dry run — re-run with --apply to create ${issuesCreated} issue(s).`);
    }
  } finally {
    await p.$disconnect();
  }
}

// Guard so unit tests can import the pure helpers without running the backfill.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
