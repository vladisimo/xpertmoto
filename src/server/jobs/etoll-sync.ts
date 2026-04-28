import { Queue, Worker } from "bullmq";
import * as Sentry from "@sentry/nextjs";
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { runEtollSync } from "@/server/services/etoll";
import { logger } from "@/lib/logger";

const log = logger.child({ queue: "etoll-sync" });

const QUEUE_NAME = "etoll-sync";

let queue: Queue | null = null;
let worker: Worker | null = null;
let started = false;

export function getEtollQueue(): Queue | null {
  if (queue) return queue;
  const redis = getRedis();
  if (!redis) return null;
  queue = new Queue(QUEUE_NAME, { connection: redis });
  return queue;
}

/**
 * Start the BullMQ worker + register a repeating job for every active e-toll
 * account. Safe to call multiple times. Idempotent — only starts once per
 * process. No-op if REDIS_URL isn't set.
 */
export async function startEtollScheduler(): Promise<void> {
  if (started) return;
  const redis = getRedis();
  if (!redis) {
    log.info("REDIS_URL not set — scheduler disabled");
    return;
  }
  started = true;

  const q = getEtollQueue()!;
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { accountId } = job.data as { accountId: string };
      return runEtollSync(prisma, accountId);
    },
    { connection: redis, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "job failed");
    Sentry.captureException(err, { tags: { queue: QUEUE_NAME, jobId: job?.id } });
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
