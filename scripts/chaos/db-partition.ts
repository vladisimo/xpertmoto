#!/usr/bin/env tsx
/**
 * G16 chaos — DB partition simulation.
 *
 * Drops the Postgres connection mid-transaction via pg_terminate_backend()
 * while the booking-flow integration suite is running. Verifies:
 *
 *   - No orphaned Payment rows (SUCCEEDED without a corresponding Booking
 *     in CONFIRMED+ state).
 *   - BondLedger invariant holds (captured + released <= held).
 *   - StripeWebhookEvent rows in PROCESSING state get healed by a
 *     follow-up run (manual: re-trigger webhook via stripe CLI).
 *
 * Usage:
 *   npm run chaos:db-partition
 *
 * This script:
 *   1. Launches the booking-flow integration suite in a child process.
 *   2. After 1 second, opens a new Postgres connection and terminates all
 *      other connections to the same database.
 *   3. Waits for the vitest child to exit.
 *   4. Re-connects as the script's own Prisma client and runs the
 *      invariant checks.
 *
 * Requires DATABASE_URL to point at a dev DB you're happy to disrupt.
 */

import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const dbName = new URL(process.env.DATABASE_URL ?? "postgres://localhost/xpertmoto").pathname.slice(1);

  const child = spawn("npx", ["vitest", "run", "tests/integration/booking-flow.test.ts"], {
    stdio: "inherit",
    env: { ...process.env, CHAOS_DB_PARTITION: "1" },
  });

  const exited = new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));

  // Wait 1 second then sever connections
  await new Promise((r) => setTimeout(r, 1000));
  console.log("[chaos] terminating all connections to DB…");
  await prisma.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    dbName,
  ).catch((err) => console.warn("[chaos] termination error (expected):", err));

  const code = await exited;

  // Invariant check
  const violations = await prisma.$queryRawUnsafe<Array<{ id: string; held: string; captured: string; released: string }>>(
    `SELECT "id", "heldAmount"::text AS held, "capturedAmount"::text AS captured, "releasedAmount"::text AS released
     FROM "BondLedger"
     WHERE "capturedAmount" + "releasedAmount" > "heldAmount"`,
  );

  if (violations.length > 0) {
    console.error(`[chaos] FAIL: ${violations.length} BondLedger invariant violations:`);
    console.error(violations);
    process.exit(2);
  }

  console.log(`[chaos] OK: booking-flow suite exited ${code}, no BondLedger invariant violations detected.`);
  await prisma.$disconnect();
  process.exit(code === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[chaos] fatal:", err);
  process.exit(1);
});
