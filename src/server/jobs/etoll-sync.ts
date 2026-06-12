import { prisma } from "@/lib/prisma";
import { runEtollSync } from "@/server/services/etoll";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";

const log = logger.child({ queue: "etoll-sync" });

const QUEUE = "etoll-sync" as const;

let started = false;

/**
 * Start the worker + register a repeating job for every active e-toll
 * account. Safe to call multiple times. Idempotent — only starts once per
 * process. No-op if REDIS_URL isn't set.
 *
 * Registered through the central queue registry (not a bespoke Queue/
 * Worker pair) so etoll-sync participates in graceful shutdown, the
 * retention + retry defaults, Sentry failure capture, and — critically —
 * the registry's `etoll-sync.start` / `etoll-sync.complete` audit entries
 * that the etoll-health job reads to decide whether sync is alive.
 */
export async function startEtollScheduler(): Promise<void> {
  if (started) return;
  const q = getQueue(QUEUE);
  if (!q) {
    log.info("REDIS_URL not set — scheduler disabled");
    return;
  }
  started = true;

  registerWorker(QUEUE, async (job) => {
    const { accountId } = job.data as { accountId: string };
    return runEtollSync(prisma, accountId);
  });

  // Default cadence: every 6 hours. Can be overridden by SystemSetting
  // key=etoll.syncIntervalMinutes (admin-editable).
  let intervalMin = 360;
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "etoll.syncIntervalMinutes" },
    });
    if (setting && typeof setting.value === "number") intervalMin = setting.value;
  } catch {
    // Setting may not exist yet; that's fine.
  }

  const accounts = await prisma.etollAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  for (const a of accounts) {
    await q.add(
      "sync",
      { accountId: a.id },
      {
        repeat: { every: intervalMin * 60_000 },
        jobId: `repeat-${a.id}`,
      },
    );
  }
  log.info({ accounts: accounts.length, intervalMin }, "scheduler started");
}
