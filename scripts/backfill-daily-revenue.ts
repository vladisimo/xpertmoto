import { backfillDailyRevenue } from "@/server/jobs/revenue-reconcile";

async function main() {
  const written = await backfillDailyRevenue();
  process.stdout.write(`backfill complete — ${written} DailyRevenue rows upserted\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
