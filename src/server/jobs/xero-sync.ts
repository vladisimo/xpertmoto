import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { syncInvoice, xeroEnabled } from "@/lib/xero";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "xero-sync" as const;

/**
 * Push invoices that haven't yet been synced to Xero — AND re-push invoices
 * amended since their last push (credit notes, cancellation write-downs,
 * voids used to go stale in Xero forever). "Synced" is tracked via
 * SystemSetting rows keyed `xero:invoice:<id>` holding the pushedAt stamp;
 * Xero's POST /Invoices upserts by InvoiceNumber, so a re-push updates the
 * existing Xero invoice rather than duplicating it. Fires hourly when Xero
 * is configured.
 */
export async function runXeroSync(): Promise<{ pushed: number; skipped: number }> {
  if (!(await xeroEnabled())) return { pushed: 0, skipped: 0 };

  const invoices = await prisma.invoice.findMany({
    // CREDITED / VOID included so amendments propagate.
    where: { status: { in: ["SENT", "PAID", "CREDITED", "VOID"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      updatedAt: true,
      // A PARTIAL credit or adjustment note doesn't touch the invoice row
      // (only a fully-credited invoice flips status) — the note's own
      // timestamp is the amendment signal for those.
      creditNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      adjustmentNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  let pushed = 0;
  let skipped = 0;
  for (const i of invoices) {
    const key = `xero:invoice:${i.id}`;
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    const pushedAt =
      existing && typeof existing.value === "object" && existing.value !== null
        ? new Date(String((existing.value as { pushedAt?: string }).pushedAt ?? 0))
        : null;
    const lastChangedAt = Math.max(
      i.updatedAt.getTime(),
      i.creditNotes[0]?.createdAt.getTime() ?? 0,
      i.adjustmentNotes[0]?.createdAt.getTime() ?? 0,
    );
    const amendedSincePush = !!pushedAt && lastChangedAt > pushedAt.getTime();
    if (existing && !amendedSincePush) {
      skipped++;
      continue;
    }
    const result = await syncInvoice(i.id);
    if (result === "pushed") {
      const value = { pushedAt: new Date().toISOString() };
      if (existing) {
        await prisma.systemSetting.update({ where: { key }, data: { value } });
      } else {
        await prisma.systemSetting.create({
          data: {
            key,
            value,
            group: "xero",
            description: "Xero sync marker",
          },
        });
      }
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
