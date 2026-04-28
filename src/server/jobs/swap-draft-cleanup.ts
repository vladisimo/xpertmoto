import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "swap-draft-cleanup" as const;
const STALE_HOURS = 24;

/**
 * Nightly at 03:15 (AEST). Voids `BookingSwap` rows that have been in
 * DRAFT for more than 24 hours — the wizard creates these on entry and
 * normally voids them on abandonment, but a crashed tab leaves one dangling
 * and blocks any new swap on the same booking until cleared.
 *
 * Idempotent: a second run over the same cutoff is a no-op because the
 * WHERE filter already excludes VOIDED/COMMITTED rows.
 */
export async function runSwapDraftCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  const stale = await prisma.bookingSwap.findMany({
    where: { status: "DRAFT", createdAt: { lt: cutoff } },
    select: { id: true, bookingId: true, swappedById: true, createdAt: true },
  });
  if (stale.length === 0) return 0;

  for (const row of stale) {
    await prisma.bookingSwap.update({
      where: { id: row.id },
      data: {
        status: "VOIDED",
        reasonNotes: `[AUTO-VOIDED by nightly cleanup: draft abandoned for >${STALE_HOURS}h]`,
      },
    });
  }
  logger.info(
    { voidedCount: stale.length, staleHours: STALE_HOURS },
    "swap-draft-cleanup voided stale BookingSwap drafts",
  );
  return stale.length;
}

export function startSwapDraftCleanupScheduler() {
  registerWorker(QUEUE, async () => runSwapDraftCleanup());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "15 3 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
  );
}
