import { prisma } from "@/lib/prisma";
import { runLinktSync } from "@/server/services/linkt";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "linkt-sync" as const;

export async function runAllLinktSyncs() {
  const accounts = await prisma.linktAccount.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const results = [];
  for (const a of accounts) {
    results.push(await runLinktSync(prisma, a.id));
  }
  return results;
}

export async function startLinktSyncScheduler() {
  registerWorker(QUEUE, async () => runAllLinktSyncs());
  const q = getQueue(QUEUE);
  if (!q) return;
  await q.add(
    "daily",
    {},
    { repeat: { pattern: "0 3 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
