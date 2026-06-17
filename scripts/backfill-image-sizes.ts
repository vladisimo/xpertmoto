/**
 * One-shot backfill: resize + recompress oversized `VehicleImage` files that
 * were stored before uploads were processed at ingestion.
 *
 * Why: the vehicle-image upload route now routes through `processImage`
 * (resize to 1920px, mozjpeg q80, EXIF stripped), so new uploads are a few
 * hundred KB. Legacy rows predate that and can be multi-MB originals that the
 * public model page and booking wizard ship for next/image to downscale on
 * every cold request. This re-encodes them in place.
 *
 * For each image: read the bytes, run the same processing the route uses, and
 * — only if the result is meaningfully smaller — upload the processed buffer
 * under a fresh key, repoint the row's `url` AND `checksum` (the model-page
 * dedupe in src/components/fleet/model-images.ts keys on checksum, so they
 * must move together), then delete the old object. Already-small images are
 * left untouched. Missing/unreadable files are logged and skipped.
 *
 * Dry-run by default. Pass --apply to commit.
 */
import { readFile } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { deleteFile, downloadFile, uploadFile, urlToKey } from "../src/lib/storage";
import { processImage } from "../src/lib/image-processing";

/** Minimum fractional size reduction before we bother rewriting a file. */
const MIN_SAVING_RATIO = 0.1;

// Mirror the vehicle-image upload route exactly so backfilled files match
// what new uploads produce.
const PROCESS_OPTS = { maxWidth: 1920, maxHeight: 1920, quality: 80, format: "jpeg" } as const;

/**
 * True if re-encoding saved at least `minSavingRatio` of the original bytes.
 * Guards against rewriting (and even bloating) images that are already
 * appropriately sized. Pure — unit-tested separately from the I/O.
 */
export function shouldRewrite(
  beforeBytes: number,
  afterBytes: number,
  minSavingRatio = MIN_SAVING_RATIO,
): boolean {
  if (beforeBytes <= 0) return false;
  return (beforeBytes - afterBytes) / beforeBytes >= minSavingRatio;
}

/** Logical folder of an object key, e.g. "vehicles/uuid.jpg" -> "vehicles". */
function folderOf(key: string): string {
  const i = key.lastIndexOf("/");
  return i < 0 ? "" : key.slice(0, i);
}

/**
 * Fetch an image's bytes from wherever it actually lives. A `/uploads/...`
 * URL was written by the local-disk fallback; an absolute URL lives in
 * S3/MinIO. Mirrors backfill-vehicle-image-checksums.ts.
 */
async function readBytes(url: string, key: string): Promise<Buffer> {
  if (url.startsWith("/uploads/")) {
    return readFile(path.join(process.cwd(), "public", "uploads", key));
  }
  return downloadFile(key);
}

function parseArgs(argv: string[]): { apply: boolean } {
  const args = { apply: false };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function fmtKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const p = new PrismaClient();

  try {
    const rows = await p.vehicleImage.findMany({ select: { id: true, url: true } });
    console.log(`Scanning ${rows.length} vehicle image(s).`);

    let rewritten = 0;
    let skippedSmall = 0;
    let beforeTotal = 0;
    let afterTotal = 0;
    const failures: string[] = [];

    for (const row of rows) {
      const oldKey = urlToKey(row.url);
      if (!oldKey) {
        failures.push(`${row.id}: url did not match storage base (${row.url})`);
        continue;
      }
      try {
        const original = await readBytes(row.url, oldKey);
        const processed = await processImage(original, PROCESS_OPTS);

        if (!shouldRewrite(original.length, processed.buffer.length)) {
          skippedSmall++;
          continue;
        }

        beforeTotal += original.length;
        afterTotal += processed.buffer.length;
        console.log(
          `  ${row.id}: ${fmtKb(original.length)} -> ${fmtKb(processed.buffer.length)}`,
        );

        if (args.apply) {
          const uploaded = await uploadFile({
            folder: folderOf(oldKey),
            contentType: processed.contentType,
            body: processed.buffer,
          });
          await p.vehicleImage.update({
            where: { id: row.id },
            data: { url: uploaded.url, checksum: uploaded.checksum },
          });
          await deleteFile(oldKey);
        }
        rewritten++;
      } catch (err) {
        failures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (failures.length) {
      console.log("");
      console.log(`Skipped ${failures.length} (errors):`);
      for (const f of failures) console.log(`  - ${f}`);
    }

    const savedKb = (beforeTotal - afterTotal) / 1024;
    console.log("");
    console.log(
      `Summary: ${rewritten} rewritten, ${skippedSmall} already small, ` +
        `${failures.length} failed. Saved ~${savedKb.toFixed(0)}KB.` +
        (args.apply ? "" : " Dry run — re-run with --apply to commit."),
    );
  } finally {
    await p.$disconnect();
  }
}

// Guard so unit tests can import `shouldRewrite` without running the backfill.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
