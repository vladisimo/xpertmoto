import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
        <Kpi label="Today's revenue" value={formatCurrency(Number(todayAgg._sum.totalAmount ?? 0))} />
        <Kpi label="MTD revenue" value={formatCurrency(Number(mtdAgg._sum.totalAmount ?? 0))} />
        <Kpi label="Active rentals" value={String(activeRentals)} />
        <Kpi label="Fleet utilisation" value={`${utilisation}%`} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="Today's bookings" value={String(todayAgg._count)} />
        <Kpi label="MTD bookings" value={String(mtdAgg._count)} />
        <Kpi label="New customers (MTD)" value={String(newCustomers)} />
        <Kpi label="Overdue" value={String(overdue)} tone={overdue > 0 ? "warn" : undefined} />
      </div>

      <Suspense fallback={<AdminRevenueTrendChartSkeleton />}>
        <AdminRevenueTrendChart />
      </Suspense>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/reports">Reports →</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/finance">Finance →</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/pricing">Pricing →</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/users">Users →</Link>
        </Button>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`font-display text-2xl font-semibold tracking-tight ${
            tone === "warn" ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
