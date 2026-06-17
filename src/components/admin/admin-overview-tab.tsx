import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  AdminRevenueTrendChart,
  AdminRevenueTrendChartSkeleton,
} from "./admin-revenue-trend-chart";

export async function AdminOverviewTab() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayAgg, mtdAgg, activeRentals, newCustomers, totalFleet, rented, overdue] =
    await Promise.all([
      prisma.booking.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.booking.aggregate({
        where: { createdAt: { gte: startOfMonth }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.booking.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: startOfMonth } } }),
      prisma.vehicle.count({ where: { isActive: true } }),
      prisma.vehicle.count({ where: { isActive: true, status: "RENTED" } }),
      prisma.booking.count({ where: { status: "OVERDUE" } }),
    ]);

  const utilisation = totalFleet ? Math.round((rented / totalFleet) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi
          label="Today's revenue"
          value={formatCurrency(Number(todayAgg._sum.totalAmount ?? 0))}
          hint={`${todayAgg._count} booking${todayAgg._count === 1 ? "" : "s"} today`}
          href="/admin/finance"
        />
        <Kpi
          label="MTD revenue"
          value={formatCurrency(Number(mtdAgg._sum.totalAmount ?? 0))}
          hint={`${mtdAgg._count} booking${mtdAgg._count === 1 ? "" : "s"} this month`}
          href="/admin/reports"
        />
        <Kpi
          label="Active rentals"
          value={String(activeRentals)}
          hint="Out on hire now"
          href="/staff/live"
        />
        <Kpi
          label="Fleet utilisation"
          value={`${utilisation}%`}
          hint={`${rented} of ${totalFleet} on hire`}
          href="/staff/fleet"
        />
        <Kpi
          label="New customers (MTD)"
          value={String(newCustomers)}
          hint="Joined this month"
          href="/staff/customers?tab=users"
        />
        <Kpi
          label="Today's bookings"
          value={String(todayAgg._count)}
          hint="Created today"
          href="/staff/bookings"
        />
        <Kpi
          label="MTD bookings"
          value={String(mtdAgg._count)}
          hint="Created this month"
          href="/staff/bookings"
        />
        <Kpi
          label="Overdue"
          value={String(overdue)}
          hint={overdue > 0 ? "Past due — action needed" : "All on time"}
          tone={overdue > 0 ? "warn" : undefined}
          href="/staff/bookings?status=OVERDUE"
        />
      </div>

      <Suspense fallback={<AdminRevenueTrendChartSkeleton />}>
        <AdminRevenueTrendChart />
      </Suspense>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
  href?: string;
}) {
  const body = (
    <Card
      className={`h-full ${
        href ? "transition-colors hover:border-admin-accent/40 hover:bg-muted/40" : ""
      } ${tone === "warn" ? "border-destructive/30" : ""}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div
          className={`font-display text-2xl font-semibold tracking-tight ${
            tone === "warn" ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      {body}
    </Link>
  );
}
