import type { PrismaClient } from "@prisma/client";
import type { InsightsGeneratorContext, RevenueTrendPayload } from "../types";

const MONTHS_BACK = 12;

function monthKey(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
}

function pct(curr: number, prior: number): number | null {
  if (prior === 0) return curr === 0 ? 0 : null;
  return Number((((curr - prior) / prior) * 100).toFixed(2));
}

function direction(v: number | null): "up" | "down" | "flat" {
  if (v === null) return "flat";
  if (v > 0.5) return "up";
  if (v < -0.5) return "down";
  return "flat";
}

export async function generateRevenueTrend(
  prisma: PrismaClient,
  ctx: InsightsGeneratorContext,
): Promise<RevenueTrendPayload> {
  const base = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
  const currentStart = new Date(base.getFullYear(), base.getMonth() - (MONTHS_BACK - 1), 1);
  const priorStart = new Date(currentStart.getFullYear() - 1, currentStart.getMonth(), 1);
  const currentEnd = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  const rows = await prisma.$queryRaw<
    Array<{ month: Date; revenue: unknown; isCurrent: boolean }>
  >`
    SELECT date_trunc('month', "date") AS "month",
           SUM("totalRevenue") AS "revenue",
           "date" >= ${currentStart}::date AS "isCurrent"
    FROM "DailyRevenue"
    WHERE "date" >= ${priorStart}::date
      AND "date" < ${currentEnd}::date
      ${ctx.depotId ? prismaAndDepot(ctx.depotId) : prismaNoDepot()}
    GROUP BY 1, 3
    ORDER BY 1
  `;

  const currentBuckets = new Map<string, number>();
  const priorBuckets = new Map<string, number>();
  for (let i = 0; i < MONTHS_BACK; i++) {
    const d = new Date(currentStart.getFullYear(), currentStart.getMonth() + i, 1);
    currentBuckets.set(monthKey(d.getFullYear(), d.getMonth()), 0);
    const p = new Date(d.getFullYear() - 1, d.getMonth(), 1);
    priorBuckets.set(monthKey(p.getFullYear(), p.getMonth()), 0);
  }

  for (const r of rows) {
    const d = new Date(r.month);
    const key = monthKey(d.getFullYear(), d.getMonth());
    const val = Number(r.revenue ?? 0);
    if (r.isCurrent) currentBuckets.set(key, val);
    else priorBuckets.set(key, val);
  }

  const months: RevenueTrendPayload["months"] = [];
  let latestMonth: string | null = null;
  let latestCurrent = 0;
  let latestPrior = 0;
  let previousCurrent = 0;

  for (const [key, currentRevenue] of currentBuckets) {
    const [yStr, mStr] = key.split("-");
    const y = Number(yStr) - 1;
    const priorKey = `${y}-${mStr}`;
    const priorRevenue = priorBuckets.get(priorKey) ?? 0;
    months.push({
      month: key,
      currentRevenue: Number(currentRevenue.toFixed(2)),
      priorYearRevenue: Number(priorRevenue.toFixed(2)),
    });
    previousCurrent = latestCurrent;
    latestCurrent = currentRevenue;
    latestPrior = priorRevenue;
    latestMonth = key;
  }

  const momChange = pct(latestCurrent, previousCurrent);
  const yoyChange = pct(latestCurrent, latestPrior);

  return {
    id: "revenue-trend",
    months,
    mom: { changePct: momChange, direction: direction(momChange) },
    yoy: { changePct: yoyChange, direction: direction(yoyChange) },
    latestMonth,
    headlineMetric: {
      label: "Latest month revenue",
      value: `$${latestCurrent.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`,
      trendPct: yoyChange ?? undefined,
      trendLabel: "vs same month last year",
    },
  };
}

// Tiny helpers so the template tag reads clearly; Prisma.sql would do but
// an explicit `if/else` is easier to follow in a generator.
import { Prisma } from "@prisma/client";

function prismaAndDepot(depotId: string) {
  return Prisma.sql`AND "depotId" = ${depotId}`;
}

function prismaNoDepot() {
  return Prisma.sql``;
}
