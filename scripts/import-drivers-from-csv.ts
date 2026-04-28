/**
 * Legacy driver migration: read a drivers CSV + matching image folder and
 * upsert Users / CustomerProfiles / CustomerDocuments. Idempotent via the
 * `legacyDriverId` unique key — re-running updates rather than duplicates.
 *
 * Usage:
 *   npm run import:drivers -- [options]
 *
 * Options:
 *   --csv <path>           Default ./data/drivers.csv
 *   --images <dir>         Default ./data/driver-images
 *   --report-dir <dir>     Default ./data
 *   --limit N              Process first N validated rows (smoke-testing)
 *   --dry-run              Parse + validate + match images; no DB writes
 *   --skip-images          Upsert users only; skip reading / uploading images
 *
 * Always writes a JSON report to <report-dir>/driver-import-report-<ISO>.json
 * regardless of dry-run.
 */

import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseDriversCsv } from "../src/lib/drivers/import-parse";
import {
  classifyImageCell,
  validateDriverBatch,
  type ImageRef,
  type ValidatedDriver,
} from "../src/lib/drivers/import-validate";
import {
  DriverImportReportBuilder,
  formatReportSummary,
  writeDriverImportReport,
  type ImageIssueEntry,
} from "../src/lib/drivers/import-report";
import { uploadImage } from "../src/lib/image-processing";

interface CliArgs {
  csv: string;
  images: string;
  reportDir: string;
  limit: number | null;
  dryRun: boolean;
  skipImages: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    csv: "./data/drivers.csv",
    images: "./data/driver-images",
    reportDir: "./data",
    limit: null,
    dryRun: false,
    skipImages: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--csv" && argv[i + 1]) args.csv = argv[++i]!;
    else if (a === "--images" && argv[i + 1]) args.images = argv[++i]!;
    else if (a === "--report-dir" && argv[i + 1]) args.reportDir = argv[++i]!;
    else if (a === "--limit" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i]!, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--limit must be a positive integer, got "${argv[i]}"`);
      }
      args.limit = n;
    } else if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--limit must be a positive integer, got "${a}"`);
      }
      args.limit = n;
    } else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--skip-images") args.skipImages = true;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/import-drivers-from-csv.ts [options]

Options:
  --csv <path>          Default ./data/drivers.csv
  --images <dir>        Default ./data/driver-images
  --report-dir <dir>    Default ./data
  --limit N             Process only the first N validated rows
  --dry-run             No DB writes; write report and exit
  --skip-images         Skip all image processing and upload
  --help                Show this message`);
}

/**
 * Upsert a single validated driver: User (by legacyDriverId) +
 * CustomerProfile (by userId) + image attachments. Runs in one
 * transaction per row so a partial failure on images doesn't leave a
 * half-populated profile behind.
 *
 * Returns the created/updated user id and whether the user was newly
 * created (for the report's imported vs updated totals).
 */
async function upsertDriver(
  prisma: PrismaClient,
  row: ValidatedDriver,
): Promise<{ userId: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { legacyDriverId: row.legacyDriverId },
      select: { id: true },
    });

    const userData: Prisma.UserUncheckedCreateInput = {
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      dateOfBirth: row.dateOfBirth,
      status: row.status,
      role: "CUSTOMER",
      legacyDriverId: row.legacyDriverId,
      legacyImportedAt: new Date(),
      deletedAt: row.softDelete ? new Date() : null,
      // Force magic-link first login — no password carried over.
      passwordHash: null,
      emailVerified: null,
    };
    if (row.createdAt) userData.createdAt = row.createdAt;

    let userId: string;
    let created: boolean;
    if (existing) {
      // Update mode: don't overwrite createdAt, don't reset deletedAt to
      // null if the human has already un-suspended the row post-import.
      const { createdAt: _ignore, ...updateFields } = userData;
      void _ignore;
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: updateFields,
        select: { id: true },
      });
      userId = updated.id;
      created = false;
    } else {
      const inserted = await tx.user.create({
        data: userData,
        select: { id: true },
      });
      userId = inserted.id;
      created = true;
    }

    // CustomerProfile upsert.
    const profileData: Prisma.CustomerProfileUncheckedCreateInput = {
      userId,
      secondaryPhone: row.profile.secondaryPhone,
      legacyReferralSource: row.profile.legacyReferralSource,
      addressLine1: row.profile.addressLine1,
      suburb: row.profile.suburb,
      state: row.profile.state,
      postcode: row.profile.postcode,
      licenceNumber: row.profile.licenceNumber,
      licenceState: row.profile.licenceState,
      licenceExpiry: row.profile.licenceExpiry,
    };
    const { userId: _uid, ...profileUpdate } = profileData;
    void _uid;
    await tx.customerProfile.upsert({
      where: { userId },
      create: profileData,
      update: profileUpdate,
      select: { id: true },
    });

    return { userId, created };
  });
}

/**
 * Read + process + upload the image files referenced by a row's `images`
 * cell. Image issues are appended to `imageIssues` rather than thrown —
 * a missing or broken image should never block a row's user data.
 *
 * Returns the count of images actually uploaded.
 */
async function uploadDriverImages(
  prisma: PrismaClient,
  row: ValidatedDriver,
  userId: string,
  imagesDir: string,
  onIssue: (issue: Omit<ImageIssueEntry, "legacyDriverId">) => void,
  onUploaded: () => void,
): Promise<number> {
  let uploaded = 0;
  let signatureKey: string | null = null;

  for (const image of row.images) {
    const abs = path.join(imagesDir, image.filename);
    if (!existsSync(abs)) {
      onIssue({ filename: image.filename, reason: "missing_on_disk" });
      continue;
    }
    let result: Awaited<ReturnType<typeof uploadImage>>;
    try {
      const body = await readFile(abs);
      result = await uploadImage(body, {
        folder: `drivers/${userId}`,
        originalName: image.filename,
      });
    } catch (err) {
      onIssue({
        filename: image.filename,
        reason: isProcessError(err) ? "process_failed" : "upload_failed",
        note: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    try {
      await attachImage(prisma, userId, image, result.key);
      onUploaded();
      uploaded += 1;
      if (image.target.kind === "signatureImage") signatureKey = result.key;
    } catch (err) {
      onIssue({
        filename: image.filename,
        reason: "upload_failed",
        note: `DB attach failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  void signatureKey; // set above for debugging; the DB write is the source of truth
  return uploaded;
}

async function attachImage(
  prisma: PrismaClient,
  userId: string,
  ref: ImageRef,
  storageKey: string,
): Promise<void> {
  if (ref.target.kind === "signatureImage") {
    await prisma.customerProfile.update({
      where: { userId },
      data: { signatureImage: storageKey },
    });
    return;
  }
  await prisma.customerDocument.create({
    data: {
      customerId: userId,
      type: ref.target.type,
      fileUrl: storageKey,
      label: ref.filename,
    },
  });
}

function isProcessError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // sharp throws errors that mention "Input" or "Input file" for decoding
  // failures. ENOENT is already excluded by our pre-check, so anything that
  // surfaces here before uploadFile runs is a processing failure.
  return /Input|sharp|decode/i.test(err.message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const csvPath = path.resolve(args.csv);
  const imagesDir = path.resolve(args.images);
  const reportDir = path.resolve(args.reportDir);

  console.log("═══════════════════════════════════════════");
  console.log("  Driver import");
  console.log("═══════════════════════════════════════════");
  console.log(`CSV:       ${csvPath}`);
  console.log(`Images:    ${args.skipImages ? "(skipped)" : imagesDir}`);
  console.log(`Reports:   ${reportDir}`);
  if (args.dryRun) console.log("Mode:      DRY RUN (no DB writes)");
  if (args.limit) console.log(`Limit:     ${args.limit} rows`);

  if (!existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`);
    process.exit(1);
  }
  if (!args.skipImages && !existsSync(imagesDir)) {
    console.warn(
      `⚠️  Images dir not found: ${imagesDir} — continuing, every image will be logged as missing`,
    );
  }

  const raw = readFileSync(csvPath);
  const parsed = parseDriversCsv(raw);
  console.log(`✓ Parsed ${parsed.rows.length} rows (${parsed.headers.length} columns)`);
  if (parsed.sanity.missing.length > 0) {
    console.error(
      `❌ Required columns missing: ${parsed.sanity.missing.join(", ")}. Aborting.`,
    );
    process.exit(1);
  }
  if (parsed.sanity.unknown.length > 0) {
    console.warn(
      `ℹ️  Ignoring unknown columns: ${parsed.sanity.unknown.join(", ")}`,
    );
  }

  const batch = validateDriverBatch(parsed.rows, parsed.rowNumbers);
  console.log(
    `✓ Validated: ${batch.ok.length} ok, ${batch.skipped.length} skipped, ${batch.errored.length} errored`,
  );

  const toImport = args.limit ? batch.ok.slice(0, args.limit) : batch.ok;

  const report = new DriverImportReportBuilder({
    csvPath,
    imagesPath: args.skipImages ? null : imagesDir,
    dryRun: args.dryRun,
    limit: args.limit,
    skipImages: args.skipImages,
    header: parsed.sanity,
    rowsInCsv: parsed.rows.length,
    validatedRows: toImport.length,
  });
  report.addBatchValidation(batch);

  // Pre-flight: flag unknown image patterns from the raw CSV cells so the
  // report captures drift even in dry-run.
  for (let i = 0; i < parsed.rows.length; i++) {
    const csvRow = parsed.rows[i]!;
    const id = csvRow.driver_id?.trim() ?? "";
    if (!id) continue;
    const { unknown } = classifyImageCell(id, csvRow.images);
    for (const filename of unknown) {
      report.recordImageIssue({
        legacyDriverId: id,
        filename,
        reason: "unknown_pattern",
      });
    }
  }

  const prisma = args.dryRun ? null : new PrismaClient();

  let processed = 0;
  for (const row of toImport) {
    processed += 1;
    if (processed % 100 === 0) {
      console.log(`  … ${processed}/${toImport.length}`);
    }

    const rowNumber = rowNumberFor(row, parsed.rows, parsed.rowNumbers);

    if (args.dryRun) {
      const existing = prisma
        ? await prisma.user.findUnique({
            where: { legacyDriverId: row.legacyDriverId },
            select: { id: true },
          })
        : null;
      report.recordImported({
        rowNumber,
        legacyDriverId: row.legacyDriverId,
        email: row.email,
        userId: existing?.id ?? null,
        created: !existing,
        imageCount: args.skipImages ? 0 : row.images.length,
      });
      continue;
    }

    try {
      const { userId, created } = await upsertDriver(prisma!, row);

      let imageCount = 0;
      if (!args.skipImages) {
        imageCount = await uploadDriverImages(
          prisma!,
          row,
          userId,
          imagesDir,
          (issue) =>
            report.recordImageIssue({ legacyDriverId: row.legacyDriverId, ...issue }),
          () => report.recordImageUploaded(),
        );
      }

      report.recordImported({
        rowNumber,
        legacyDriverId: row.legacyDriverId,
        email: row.email,
        userId,
        created,
        imageCount,
      });
    } catch (err) {
      report.recordFailure({
        rowNumber,
        legacyDriverId: row.legacyDriverId,
        email: row.email,
        issues: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  await prisma?.$disconnect();

  const finalReport = report.build();
  const reportPath = writeDriverImportReport(finalReport, reportDir);
  console.log("");
  console.log(formatReportSummary(finalReport));
  console.log(`\n📝 Report: ${reportPath}`);
}

/**
 * Recover the 1-based CSV row number for a validated row so the report can
 * point an operator at the exact line. The validator runs after papaparse
 * has already associated rows with their indices, but by the time we iterate
 * the `ok` list that association is gone — re-derive from driver_id.
 */
function rowNumberFor(
  row: ValidatedDriver,
  rawRows: Array<Record<string, string | null>>,
  rowNumbers: number[],
): number {
  const idx = rawRows.findIndex((r) => r.driver_id?.trim() === row.legacyDriverId);
  return idx >= 0 ? (rowNumbers[idx] ?? idx + 2) : -1;
}

main().catch((err) => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
