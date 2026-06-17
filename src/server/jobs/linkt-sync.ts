import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { runLinktSync } from "@/server/services/linkt";
import { runLinktScrape } from "@/server/services/linkt-scrape";
import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "linkt-sync" as const;

export async function runAllLinktSyncs() {
  const accounts = await prisma.linktAccount.findMany({
    where: { isActive: true },
    select: { id: true, scrapeEnabled: true, reauthNeededAt: true },
    orderBy: { createdAt: "asc" },
  });
  const results: Array<{ syncId: string; status: string }> = [];
  for (const a of accounts) {
    try {
      if (a.scrapeEnabled && a.reauthNeededAt == null) {
        // Auto-scrape the portal for fresh trips. runLinktScrape feeds the
        // download into runLinktSync; on a block/auth failure it records the
        // FAILED sync, flags re-auth, and notifies staff before re-throwing.
        results.push(await runLinktScrape(prisma, a.id));
      } else {
        // Manual-upload accounts (and any flagged for re-auth) get the no-buffer
        // rematch pass — re-feed still-pending unmatched rows through the matcher.
        results.push(await runLinktSync(prisma, a.id));
      }
    } catch (e) {
      // Per-account isolation: one account's scrape failure (e.g. Incapsula
      // block) must not abort syncs for the rest.
      logger.warn(
        { accountId: a.id, err: e instanceof Error ? e.message : String(e) },
        "Linkt sync failed for account",
      );
      results.push({ syncId: "", status: "FAILED" });
    }
  }
  return results;
}

export async function startLinktSyncScheduler() {
  registerWorker(QUEUE, async () => runAllLinktSyncs());
  // Register the Sentry cron monitor under the correct slug. The legacy
  // `etoll-sync` monitor (commit 0e9423d) was orphaned when the NSW e-toll
  // job was replaced by Linkt — delete it in the Sentry dashboard.
  monitorCron(QUEUE, "0 3 * * *", "Australia/Brisbane");
  const q = getQueue(QUEUE);
  if (!q) return;
  await q.add(
    "daily",
    {},
    { repeat: { pattern: "0 3 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
