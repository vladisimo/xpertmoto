/**
 * One-off backfill: correct historic VehicleTelemetry.speedKph values that were
 * stored in GPS51's native unit (metres/hour) instead of km/h.
 *
 * GPS51's `speed` field is metres/hour (the same metres convention as
 * `totaldistance`, which we already divide by 1000). The ingestion path stored
 * `speed` raw — so e.g. 44400 was recorded as "44400 km/h" instead of 44.4 km/h.
 * `speedKphFromRaw()` now divides by 1000 going forward; this fixes existing rows.
 *
 * Idempotent: it re-derives speedKph from the preserved `raw.speed` payload, so
 * running it twice changes nothing (the WHERE skips rows already equal). Rows
 * without a numeric `raw.speed` (e.g. non-GPS51 sources) are left untouched.
 *
 * Run: `npm run db:gps51-speed-units-backfill`
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pending = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT count(*)::bigint AS count
    FROM "VehicleTelemetry"
    WHERE raw ? 'speed'
      AND raw->>'speed' ~ '^[0-9]+(\\.[0-9]+)?$'
      AND ("speedKph" IS DISTINCT FROM (raw->>'speed')::double precision / 1000)
  `);
  const toFix = Number(pending[0]?.count ?? 0n);
  console.log(`rows needing speed-unit correction: ${toFix}`);
  if (toFix === 0) {
    console.log("✅ nothing to backfill (already in km/h).");
    return;
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "VehicleTelemetry"
    SET "speedKph" = (raw->>'speed')::double precision / 1000
    WHERE raw ? 'speed'
      AND raw->>'speed' ~ '^[0-9]+(\\.[0-9]+)?$'
      AND ("speedKph" IS DISTINCT FROM (raw->>'speed')::double precision / 1000)
  `);
  console.log(`✅ corrected ${updated} VehicleTelemetry rows (metres/hour → km/h).`);
}

main()
  .catch((e) => {
    console.error("❌ backfill-telemetry-speed-units failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
