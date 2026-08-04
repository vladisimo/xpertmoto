import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { invalidateTag } from "@/lib/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { getQueue, registerWorker } from "./queue";
import { withJobLock } from "./run-lock";

const QUEUE = "revenue-reconcile" as const;
const log = logger.child({ component: "revenue-reconcile" });

/**
 * Rebuilds DailyRevenue rows for a date window from source tables.
 * Idempotent: upserts by (date, depotId). Defaults to yesterday+today.
 */
export async function reconcileDailyRevenue(
  opts: { fromDaysAgo?: number; toDaysAgo?: number } = {},
): Promise<number> {
  const fromDaysAgo = opts.fromDaysAgo ?? 1;
  const toDaysAgo = opts.toDaysAgo ?? 0;
  const now = new Date();
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - toDaysAgo + 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - fromDaysAgo));

  type Row = {
    date: Date;
    depotId: string;
    bookingRevenue: Prisma.Decimal;
    addonRevenue: Prisma.Decimal;
    gstAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  };

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      date_trunc('day', COALESCE("actualReturnDateTime", "returnDateTime"))::date AS "date",
      "depotId",
      SUM("subtotal")::numeric(12,2)    AS "bookingRevenue",
      SUM("addonTotal")::numeric(12,2)  AS "addonRevenue",
      SUM("gstAmount")::numeric(12,2)   AS "gstAmount",
      SUM("totalAmount")::numeric(12,2) AS "totalAmount"
    FROM "Booking"
    WHERE "status" IN ('COMPLETED', 'RETURNED')
      AND COALESCE("actualReturnDateTime", "returnDateTime") >= ${start}
      AND COALESCE("actualReturnDateTime", "returnDateTime") <  ${endExclusive}
    GROUP BY 1, 2
  `;

  let written = 0;
  for (const r of rows) {
    // Rebuild the booking-derived columns from source of truth, but PRESERVE
    // the live-accumulated deltas (damage/late revenue via
    // recordAdditionalCharges, refunds via recordRefund): the old update
    // overwrote totalRevenue/netRevenue with booking-only sums, silently
    // erasing every same-day ancillary charge and refund each night.
    const existing = await prisma.dailyRevenue.findUnique({
      where: { date_depotId: { date: r.date, depotId: r.depotId } },
      select: { damageRevenue: true, lateFeesRevenue: true, totalRefunds: true },
    });
    const damage = Number(existing?.damageRevenue ?? 0);
    const late = Number(existing?.lateFeesRevenue ?? 0);
    const refunds = Number(existing?.totalRefunds ?? 0);
    const total =
      Math.round((Number(r.totalAmount) + damage + late) * 100) / 100;
    const net = Math.round((total - refunds) * 100) / 100;
    await prisma.dailyRevenue.upsert({
      where: { date_depotId: { date: r.date, depotId: r.depotId } },
      create: {
        date: r.date,
        depotId: r.depotId,
        bookingRevenue: r.bookingRevenue,
        addonRevenue: r.addonRevenue,
        totalRevenue: r.totalAmount,
        totalGst: r.gstAmount,
        netRevenue: r.totalAmount,
      },
      update: {
        bookingRevenue: r.bookingRevenue,
        addonRevenue: r.addonRevenue,
        totalRevenue: total,
        totalGst: r.gstAmount,
        netRevenue: net,
      },
    });
    written++;
  }

  await invalidateTag(CACHE_TAGS.DASHBOARD(null));
  const depotRows = new Set(rows.map((r) => r.depotId));
  for (const depotId of depotRows) {
    await invalidateTag(CACHE_TAGS.DASHBOARD(depotId));
  }

  log.info({ written, from: start, to: endExclusive }, "revenue reconcile done");
  return written;
}

/**
 * One-off backfill — rebuild the last 13 months from scratch.
 * Safe to run repeatedly (idempotent upserts).
 */
export async function backfillDailyRevenue(): Promise<number> {
  return reconcileDailyRevenue({ fromDaysAgo: 400, toDaysAgo: 0 });
}

export function startRevenueReconcileScheduler() {
  // Full-table scan: lock so a hung/restarted run can't overlap the next
  // tick and double-write the same daily rows.
  registerWorker(QUEUE, async () => withJobLock(QUEUE, 30 * 60, () => reconcileDailyRevenue()));
  const q = getQueue(QUEUE);
  if (q) {
    q.add(
      "nightly",
      {},
      { repeat: { pattern: "15 2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
    );
  }
}
