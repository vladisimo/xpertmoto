/**
 * One-shot backfill: populate `VehicleImage.checksum` (sha256 of the file
 * bytes) for rows created before the column existed.
 *
 * Why: the public model page collapses the same stock photo uploaded once per
 * unit (distinct URLs, identical content) by content checksum. Legacy rows have
 * a null checksum and fall back to URL dedupe (a no-op), so the gallery shows
 * duplicates until they're hashed. See src/components/fleet/model-images.ts.
 *
 * Reads each image's bytes via the storage layer (urlToKey -> downloadFile),
 * hashes them, and writes the digest. Missing/unreadable files are logged and
 * skipped — they don't abort the run.
 *
 * Dry-run by default. Pass --apply to commit.
 */
import { readFile } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { checksumOf, downloadFile, urlToKey } from "../src/lib/storage";

const p = new PrismaClient();

/**
 * Fetch an image's bytes from wherever it actually lives. The byte source is
 * decided by the URL form, not the ambient storage config: a `/uploads/...`
 * URL was written by the local-disk fallback (read it from public/uploads),
 * while an absolute URL lives in S3/MinIO (read it via the storage layer).
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const rows = await p.vehicleImage.findMany({
    where: { checksum: null },
    select: { id: true, url: true },
  });
  console.log(`Found ${rows.length} image(s) without a checksum.`);

  let updated = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const key = urlToKey(row.url);
    if (!key) {
      skipped++;
      failures.push(`${row.id}: url did not match storage base (${row.url})`);
      continue;
    }
    try {
      const bytes = await readBytes(row.url, key);
      const checksum = checksumOf(bytes);
      if (args.apply) {
        await p.vehicleImage.update({ where: { id: row.id }, data: { checksum } });
      }
      updated++;
    } catch (err) {
      skipped++;
      failures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length) {
    console.log("");
    console.log(`Skipped ${failures.length}:`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  console.log("");
  console.log(
    `Summary: ${updated} image(s) hashed, ${skipped} skipped.${
      args.apply ? "" : " Re-run with --apply to commit."
    }`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
