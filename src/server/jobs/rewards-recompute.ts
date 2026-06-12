import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { recomputeAllCustomerRewards } from "@/server/services/customer-rewards";
import { getQueue, registerWorker } from "./queue";
import { withJobLock } from "./run-lock";

const QUEUE = "rewards-recompute" as const;
const log = logger.child({ component: "rewards-recompute" });

/**
 * Nightly source-of-truth recompute for the loyalty leaderboard / tier.
 *
 * Rebuilds every customer's denormalised rewards counters (net-collected
 * spend, completed+current booking count, lifetime/spendable points, tier)
 * from the payment + booking + loyalty ledgers. Idempotent — recompute
 * writes absolute values. Keeps the leaderboard accurate as new payments
 * land without touching payment-capture/webhook code paths.
 */
export async function runRewardsRecompute(): Promise<number> {
  const count = await recomputeAllCustomerRewards(prisma);
  log.info({ recomputed: count }, "rewards recompute done");
  return count;
}

export function startRewardsRecomputeScheduler() {
  // Full-table scan: lock so a hung/restarted run can't overlap the next
  // tick. 30 min TTL — the scan is minutes even at 100k customers.
  registerWorker(QUEUE, async () => withJobLock(QUEUE, 30 * 60, () => runRewardsRecompute()));
  const q = getQueue(QUEUE);
  if (q) {
    // 02:40 Brisbane — after revenue-reconcile (02:15), off-peak.
    q.add(
      "nightly",
      {},
      { repeat: { pattern: "40 2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
    );
  }
}
