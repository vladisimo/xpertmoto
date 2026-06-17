import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  AdminRevenueTrendChartClient,
  type RevenueTrendPoint,
} from "./admin-revenue-trend-chart-client";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Booking-based so the trend always matches the "Today's / MTD revenue" KPIs
// on this tab. (The DailyRevenue rollup is populated by a reconcile job that
// may not have run in every deployment — sourcing it here left the chart blank
// while real booking revenue existed.)
export async function AdminRevenueTrendChart() {
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rows = await prisma.$queryRaw<
    Array<{ month: Date; revenue: Prisma.Decimal | null; bookings: bigint }>
  >`
    SELECT
      date_trunc('month', "createdAt") AS "month",
      SUM("totalAmount") AS "revenue",
      COUNT(*) AS "bookings"
    FROM "Booking"
    WHERE "createdAt" >= date_trunc('month', ${twelveMonthsAgo}::timestamp)
      AND "status" NOT IN ('CANCELLED', 'NO_SHOW')
      AND "deletedAt" IS NULL
    GROUP BY 1
    ORDER BY 1
  `;

  const byKey = new Map<string, { revenue: number; bookings: number }>();
  for (const r of rows) {
    const d = new Date(r.month);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byKey.set(key, { revenue: Number(r.revenue ?? 0), bookings: Number(r.bookings) });
  }

  const data: RevenueTrendPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo.getFullYear(), twelveMonthsAgo.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const hit = byKey.get(key);
    const month = d.getMonth();
    data.push({
      key,
      // Year-stamp January (and the first bar) so a 12-month window spanning a
      // year boundary stays unambiguous.
      label: month === 0 || i === 0 ? `${MONTH_LABELS[month]} ’${String(d.getFullYear()).slice(2)}` : MONTH_LABELS[month]!,
      revenue: hit?.revenue ?? 0,
      bookings: hit?.bookings ?? 0,
    });
  }

  const total12mo = data.reduce((a, p) => a + p.revenue, 0);
  const best = data.reduce((a, p) => (p.revenue > a.revenue ? p : a), data[0]!);
  const monthsWithRevenue = data.filter((p) => p.revenue > 0).length;
  const avgPerMonth = monthsWithRevenue ? total12mo / monthsWithRevenue : 0;

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
        <CardTitle className="text-base">Revenue — last 12 months</CardTitle>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <HeaderStat label="12-mo total" value={formatCurrency(total12mo)} />
          <HeaderStat label="Avg / active month" value={formatCurrency(avgPerMonth)} />
          <HeaderStat
            label="Best month"
            value={best.revenue > 0 ? `${formatCurrency(best.revenue)} · ${best.label}` : "—"}
          />
        </div>
      </CardHeader>
      <CardContent className="min-h-[16rem] flex-1 pb-3">
        <AdminRevenueTrendChartClient data={data} />
      </CardContent>
    </Card>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-display text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

export function AdminRevenueTrendChartSkeleton() {
  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Revenue — last 12 months</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-[16rem] flex-1 items-end gap-2 pb-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-muted animate-pulse"
              style={{ height: `${30 + ((i * 7) % 60)}%` }}
            />
            <div className="h-3 w-8 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
