import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "swap-draft-cleanup" as const;
const STALE_HOURS = 24;

/**
 * Title prefix of the post-swap cleaning-buffer work orders that
 * `bookingSwap.confirmSwap` auto-creates when the outgoing vehicle goes
 * straight back to AVAILABLE. This job matches on the prefix (plus type
 * CUSTOM) to auto-complete them once their scheduled window has lapsed —
 * keep the creator and this matcher in sync.
 */
export const TURNAROUND_WO_TITLE_PREFIX = "Post-hire turnaround —";

/**
 * Nightly at 03:15 (AEST). Two sweeps:
 *
 * 1. Voids `BookingSwap` rows that have been in DRAFT for more than 24
 *    hours — the wizard creates these on entry and normally voids them on
 *    abandonment, but a crashed tab leaves one dangling and blocks any new
 *    swap on the same booking until cleared.
 * 2. Completes expired post-swap turnaround work orders. `confirmSwap`
 *    schedules one over the cleaning buffer so availability blocks the
 *    swapped-out vehicle; once `scheduledEndAt` has passed the WO no longer
 *    blocks anything, so untouched OPEN ones are closed to keep the
 *    maintenance queue clean. ASSIGNED/IN_PROGRESS ones were picked up by
 *    staff — those are left for staff to complete.
 *
 * Idempotent: a second run over the same cutoff is a no-op because the
 * WHERE filters already exclude VOIDED/COMMITTED rows and COMPLETED WOs.
 */
export async function runSwapDraftCleanup(): Promise<{
  voidedDrafts: number;
  completedTurnarounds: number;
}> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  const stale = await prisma.bookingSwap.findMany({
    where: { status: "DRAFT", createdAt: { lt: cutoff } },
    select: {
      id: true,
      bookingId: true,
      swappedById: true,
      createdAt: true,
      reasonNotes: true,
    },
  });

  for (const row of stale) {
    await prisma.bookingSwap.update({
      where: { id: row.id },
      data: {
        status: "VOIDED",
        // Release the 1:1 BookingSwap.incidentId slot, mirroring the manual
        // `voidSwapDraft` path: `startLossReplacementDraft` reads the
        // relation without a status filter, so a voided draft that kept its
        // incident link would block every retry on the same loss incident.
        incidentId: null,
        // APPEND the auto-void marker — the manager's original reasonNotes
        // are the audit trail for why the swap was started and must survive.
        reasonNotes:
          (row.reasonNotes ? `${row.reasonNotes}\n\n` : "") +
          `[AUTO-VOIDED by nightly cleanup: draft abandoned for >${STALE_HOURS}h]`,
      },
    });
  }
  if (stale.length > 0) {
    logger.info(
      { voidedCount: stale.length, staleHours: STALE_HOURS },
      "swap-draft-cleanup voided stale BookingSwap drafts",
    );
  }

  const expiredTurnarounds = await prisma.maintenanceWorkOrder.findMany({
    where: {
      type: "CUSTOM",
      status: "OPEN",
      title: { startsWith: TURNAROUND_WO_TITLE_PREFIX },
      scheduledEndAt: { lt: new Date() },
    },
    select: { id: true, notes: true },
  });
  for (const wo of expiredTurnarounds) {
    await prisma.maintenanceWorkOrder.update({
      where: { id: wo.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        notes: `${wo.notes ? `${wo.notes}\n` : ""}[AUTO-COMPLETED by nightly cleanup: turnaround buffer elapsed]`,
      },
    });
  }
  if (expiredTurnarounds.length > 0) {
    logger.info(
      { completedCount: expiredTurnarounds.length },
      "swap-draft-cleanup completed expired turnaround work orders",
    );
  }

  return { voidedDrafts: stale.length, completedTurnarounds: expiredTurnarounds.length };
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
