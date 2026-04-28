import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { syncInvoice, xeroEnabled } from "@/lib/xero";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "xero-sync" as const;

/**
 * Push invoices that haven't yet been synced to Xero. "Synced" is tracked
 * via SystemSetting rows keyed `xero:invoice:<id>` so the schema is
 * untouched. Fires hourly when Xero is configured.
 */
export async function runXeroSync(): Promise<{ pushed: number; skipped: number }> {
  if (!(await xeroEnabled())) return { pushed: 0, skipped: 0 };

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["SENT", "PAID"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true },
  });

  let pushed = 0;
  let skipped = 0;
  for (const i of invoices) {
    const key = `xero:invoice:${i.id}`;
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (existing) {
      skipped++;
      continue;
    }
    const result = await syncInvoice(i.id);
    if (result === "pushed") {
      await prisma.systemSetting.create({
        data: {
          key,
          value: { pushedAt: new Date().toISOString() },
          group: "xero",
          description: "Xero sync marker",
        },
      });
      pushed++;
    } else {
      skipped++;
    }
  }

  logger.info({ pushed, skipped }, "xero-sync finished");
  return { pushed, skipped };
}

export function startXeroSyncScheduler() {
  registerWorker(QUEUE, async () => runXeroSync());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "hourly",
    {},
    { repeat: { pattern: "0 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-hourly" },
  );
}
