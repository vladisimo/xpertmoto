/**
 * Ad-hoc: manually run the daily Sentry stats pull and print what it wrote.
 *
 *   tsx scripts/poll-sentry-stats.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { runPlatformSentryStats } from "../src/server/jobs/platform-sentry-stats";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("env present:", {
    SENTRY_AUTH_TOKEN: Boolean(process.env.SENTRY_AUTH_TOKEN),
    SENTRY_ORG_SLUG: process.env.SENTRY_ORG_SLUG ?? null,
    SENTRY_API_BASE_URL: process.env.SENTRY_API_BASE_URL ?? "(default https://sentry.io)",
  });

  const result = await runPlatformSentryStats();
  console.log("\nrunPlatformSentryStats result:", result);

  const rows = await prisma.observabilityUsageSnapshot.findMany({
    where: { provider: "sentry" },
    orderBy: [{ date: "desc" }, { metric: "asc" }],
    take: 20,
  });
  console.log(`\nsnapshot rows (${rows.length}):`);
  for (const r of rows) {
    console.log(`  ${r.date.toISOString().slice(0, 10)}  ${r.metric.padEnd(12)} qty=${r.quantity}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
