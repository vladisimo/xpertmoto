import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export async function AdminRevenueTrendChart() {
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rows = await prisma.$queryRaw<Array<{ month: Date; revenue: Prisma.Decimal | null }>>`
    SELECT date_trunc('month', "date") AS "month", SUM("totalRevenue") AS "revenue"
    FROM "DailyRevenue"
    WHERE "date" >= date_trunc('month', ${twelveMonthsAgo}::timestamp)
    GROUP BY 1
    ORDER BY 1
  `;

  const trend = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo.getFullYear(), twelveMonthsAgo.getMonth() + i, 1);
    trend.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
  }
  for (const r of rows) {
    const d = new Date(r.month);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (trend.has(key)) trend.set(key, Number(r.revenue ?? 0));
  }
  const trendArr = Array.from(trend.entries());
  const maxRev = Math.max(...trendArr.map(([, v]) => v), 1);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Revenue — last 12 months</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex min-h-0 flex-1 items-end gap-2">
          {trendArr.map(([month, revenue]) => (
            <div key={month} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-primary"
                style={{
                  height: `${(revenue / maxRev) * 100}%`,
                  minHeight: revenue ? 4 : 0,
                }}
                title={`${month}: ${formatCurrency(revenue)}`}
              />
              <span className="text-[10px] text-muted-foreground">{month.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Max month: {formatCurrency(maxRev)}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminRevenueTrendChartSkeleton() {
  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Revenue — last 12 months</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex min-h-0 flex-1 items-end gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-muted animate-pulse"
                style={{ height: `${30 + ((i * 7) % 60)}%` }}
              />
              <div className="h-3 w-8 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-3 w-32 rounded bg-muted animate-pulse" />
      </CardContent>
    </Card>
  );
}
