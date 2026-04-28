import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "staff-task-auto-abandon" as const;

// Activities without any heartbeat for this long (default 4h) are considered
// abandoned — the staff member's browser is almost certainly closed.
// Recent activity is protected: we only abandon rows whose lastHeartbeatAt
// (or startedAt when heartbeat never fired) is older than the cutoff.
const STALE_HEARTBEAT_MINUTES = 240;

/**
 * Every 5 minutes. Flips IN_PROGRESS activities whose heartbeat has gone
 * cold to ABANDONED so the partial unique index releases and another staff
 * member can pick up the task.
 */
export async function runStaffTaskAutoAbandon(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MINUTES * 60_000);
  const stale = await prisma.staffTaskActivity.findMany({
    where: {
      status: "IN_PROGRESS",
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { AND: [{ lastHeartbeatAt: null }, { startedAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const now = new Date();
  const result = await prisma.staffTaskActivity.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, status: "IN_PROGRESS" },
    data: {
      status: "ABANDONED",
      completedAt: now,
      outcome: "auto_abandoned_heartbeat",
      outcomeNote: `No heartbeat for ${STALE_HEARTBEAT_MINUTES} minutes`,
    },
  });
  if (result.count > 0) {
    logger.info({ count: result.count }, "staff-task-auto-abandon: abandoned stale activities");
  }
  return result.count;
}

export function startStaffTaskAutoAbandonScheduler() {
  registerWorker(QUEUE, async () => runStaffTaskAutoAbandon());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "every-5min",
    {},
    { repeat: { pattern: "*/5 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-every-5min" },
  );
}
