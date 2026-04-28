import { prisma } from "@/lib/prisma";
import { runLinktSync } from "@/server/services/linkt";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "linkt-sync" as const;

export async function runAllLinktSyncs() {
  const accounts = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "linkt:account:" } },
    select: { key: true },
  });
  const results = [];
  for (const a of accounts) {
    const id = a.key.replace("linkt:account:", "");
    results.push(await runLinktSync(id));
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
