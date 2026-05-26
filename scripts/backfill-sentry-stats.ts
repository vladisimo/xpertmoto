/**
 * Ad-hoc: seed historical Sentry usage so the Observability tab has a real
 * trend instead of a single day. Idempotent — safe to re-run.
 *
 *   tsx scripts/backfill-sentry-stats.ts            # last 30 days
 *   tsx scripts/backfill-sentry-stats.ts --days=90  # last 90 days
 *
 * Needs SENTRY_AUTH_TOKEN + SENTRY_ORG_SLUG in .env (org:read scope).
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { backfillSentryStats } from "../src/server/jobs/platform-sentry-stats";
import { prisma } from "../src/lib/prisma";

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  const days = Math.min(90, Math.max(1, arg ? Number(arg.split("=")[1]) : 30));

  console.log(`Backfilling ${days} days of Sentry usage…`);
  const result = await backfillSentryStats(days);
  console.log("result:", result);

  const rows = await prisma.observabilityUsageSnapshot.groupBy({
    by: ["metric"],
    where: { provider: "sentry" },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  console.log("\ntotals by metric:");
  for (const r of rows) {
    console.log(`  ${r.metric.padEnd(12)} days=${r._count._all}  sum=${r._sum.quantity}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
