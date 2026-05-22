/**
 * Rewrite a stale storage-URL prefix across the DB.
 *
 * Symptom this fixes: image/signature URLs were persisted with the dev/internal
 * MinIO base (e.g. `http://localhost:9000/scootering`) and rendering them from
 * a public HTTPS deployment fails CSP + `next/image`'s private-IP guard.
 *
 * Usage (dry-run by default — prints counts without writing):
 *   OLD_PREFIX="http://localhost:9000/scootering" \
 *   NEW_PREFIX="https://cdn.example.com" \
 *   npx tsx scripts/rewrite-storage-urls.ts
 *
 * Apply for real:
 *   OLD_PREFIX=... NEW_PREFIX=... APPLY=true npx tsx scripts/rewrite-storage-urls.ts
 *
 * Tables/columns covered (extend as needed):
 *   - InspectionPhoto.url       (String)
 *   - IncidentPhoto.url         (String)
 *   - VehicleImage.url          (String)
 *   - Booking.signatureUrl      (String?)
 *   - DamageCharge.photoUrls    (String[])
 *
 * The script trims a trailing slash from OLD_PREFIX / NEW_PREFIX so callers
 * don't have to remember whether to include it.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function trim(s: string): string {
  return s.replace(/\/+$/, "");
}

async function main() {
  const oldPrefixRaw = process.env.OLD_PREFIX;
  const newPrefixRaw = process.env.NEW_PREFIX;
  const apply = process.env.APPLY === "true";

  if (!oldPrefixRaw || !newPrefixRaw) {
    console.error("OLD_PREFIX and NEW_PREFIX env vars are required.");
    process.exit(1);
  }
  const oldPrefix = trim(oldPrefixRaw);
  const newPrefix = trim(newPrefixRaw);
  if (oldPrefix === newPrefix) {
    console.error("OLD_PREFIX and NEW_PREFIX are identical after trim — nothing to do.");
    process.exit(1);
  }

  const likePattern = `${oldPrefix}/%`;
  console.log(`Mode:          ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`OLD_PREFIX:    ${oldPrefix}`);
  console.log(`NEW_PREFIX:    ${newPrefix}`);
  console.log("");

  // --- Scalar String columns -------------------------------------------------
  type StringTarget = { table: string; column: string };
  const stringTargets: StringTarget[] = [
    { table: "InspectionPhoto", column: "url" },
    { table: "IncidentPhoto", column: "url" },
    { table: "VehicleImage", column: "url" },
    { table: "Booking", column: "signatureUrl" },
  ];

  for (const t of stringTargets) {
    const matched = (
      await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "${t.table}" WHERE "${t.column}" LIKE $1`,
        likePattern,
      )
    )[0];
    const n = Number(matched?.n ?? 0n);
    if (n === 0) {
      console.log(`  ${t.table}.${t.column}: 0 rows`);
      continue;
    }
    if (!apply) {
      console.log(`  ${t.table}.${t.column}: ${n} row(s) would update`);
      continue;
    }
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "${t.table}"
         SET "${t.column}" = $1 || SUBSTRING("${t.column}" FROM ${oldPrefix.length + 1})
       WHERE "${t.column}" LIKE $2`,
      newPrefix,
      likePattern,
    );
    console.log(`  ${t.table}.${t.column}: ${updated} row(s) updated`);
  }

  // --- String[] columns ------------------------------------------------------
  // Postgres-native: unnest, REPLACE the prefix on matching elements, re-aggregate.
  type ArrayTarget = { table: string; column: string };
  const arrayTargets: ArrayTarget[] = [
    { table: "DamageCharge", column: "photoUrls" },
  ];

  for (const t of arrayTargets) {
    const matched = (
      await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n
           FROM "${t.table}"
          WHERE EXISTS (
            SELECT 1 FROM unnest("${t.column}") AS u WHERE u LIKE $1
          )`,
        likePattern,
      )
    )[0];
    const n = Number(matched?.n ?? 0n);
    if (n === 0) {
      console.log(`  ${t.table}.${t.column}: 0 rows`);
      continue;
    }
    if (!apply) {
      console.log(`  ${t.table}.${t.column}: ${n} row(s) would update`);
      continue;
    }
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "${t.table}"
         SET "${t.column}" = (
           SELECT array_agg(
             CASE WHEN u LIKE $2 THEN $1 || SUBSTRING(u FROM ${oldPrefix.length + 1}) ELSE u END
             ORDER BY ord
           )
           FROM unnest("${t.column}") WITH ORDINALITY AS arr(u, ord)
         )
       WHERE EXISTS (
         SELECT 1 FROM unnest("${t.column}") AS u2 WHERE u2 LIKE $2
       )`,
      newPrefix,
      likePattern,
    );
    console.log(`  ${t.table}.${t.column}: ${updated} row(s) updated`);
  }

  console.log("");
  console.log(apply ? "Done." : "Dry run complete. Re-run with APPLY=true to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
