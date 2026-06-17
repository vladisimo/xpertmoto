/**
 * Reset (wipe) ALL stored GPS telemetry so the daily full-track sync can rebuild
 * a single clean, full-fidelity history baseline.
 *
 *   tsx scripts/gps51-telemetry-reset.ts                    # DRY RUN (reports counts)
 *   tsx scripts/gps51-telemetry-reset.ts --apply --yes-truncate
 *   tsx scripts/gps51-telemetry-reset.ts --apply --yes-truncate --force-remote
 *
 * This TRUNCATEs the entire `VehicleTelemetry` table (compression-safe on the
 * TimescaleDB hypertable — a selective DELETE on compressed chunks would fail).
 * It is IRREVERSIBLE and clears every source (gps51-track + any third-party
 * webhook rows), so it requires both --apply and an explicit --yes-truncate.
 *
 * VehicleLivePosition is left untouched — the 1-min poll repopulates the live
 * map within a minute.
 *
 * SAFETY: refuses to run against a non-localhost DATABASE_URL unless
 * --force-remote is also passed.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";

function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const args = process.argv.slice(2);
    const apply = args.includes("--apply");
    const confirmed = args.includes("--yes-truncate");
    const forceRemote = args.includes("--force-remote");

    const total = await prisma.vehicleTelemetry.count();
    const bySource = await prisma.vehicleTelemetry.groupBy({
      by: ["source"],
      _count: { _all: true },
    });

    console.log("Will TRUNCATE VehicleTelemetry (all sources):");
    console.log(`  Total rows: ${total}`);
    for (const s of bySource) {
      console.log(`    ${s.source ?? "(null)"}: ${s._count._all}`);
    }
    console.log("  (VehicleLivePosition is left intact — the poll repopulates it.)\n");

    if (!apply || !confirmed) {
      console.log("DRY RUN — re-run with --apply --yes-truncate to wipe.");
      return;
    }

    if (!isLocalDatabase(process.env.DATABASE_URL) && !forceRemote) {
      console.error(
        "ABORT: DATABASE_URL is not localhost. This TRUNCATEs the whole telemetry\n" +
          "table. Re-run with --force-remote if you really mean to wipe a remote DB.",
      );
      process.exit(1);
    }

    // TRUNCATE drops all hypertable chunks (incl. compressed) in one shot.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "VehicleTelemetry"');
    const after = await prisma.vehicleTelemetry.count();
    console.log(`✓ Truncated VehicleTelemetry — ${total} rows removed, ${after} remaining.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
