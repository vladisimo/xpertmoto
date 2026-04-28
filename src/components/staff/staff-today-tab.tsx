import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export async function StaffTodayTab({ depotId }: { depotId?: string }) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [pickups, returns, activeCount, overdueCount] = await Promise.all([
    prisma.booking.findMany({
      where: {
        pickupDateTime: { gte: startOfDay, lt: endOfDay },
        status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
        ...(depotId ? { pickupDepotId: depotId } : {}),
      },
      include: { customer: true, category: true, vehicle: true },
      orderBy: { pickupDateTime: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        returnDateTime: { gte: startOfDay, lt: endOfDay },
        status: { in: ["ACTIVE", "CHECKED_OUT"] },
        ...(depotId ? { returnDepotId: depotId } : {}),
      },
      include: { customer: true, category: true, vehicle: true },
    }),
    prisma.booking.count({
      where: { status: "ACTIVE", ...(depotId ? { depotId } : {}) },
    }),
    prisma.booking.count({
      where: {
        status: { in: ["ACTIVE", "OVERDUE", "CHECKED_OUT"] },
        returnDateTime: { lt: now },
        ...(depotId ? { returnDepotId: depotId } : {}),
      },
    }),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="Today's pickups" value={pickups.length} />
        <Kpi label="Today's returns" value={returns.length} />
        <Kpi label="Active rentals" value={activeCount} />
        <Kpi label="Overdue" value={overdueCount} tone={overdueCount > 0 ? "warn" : undefined} />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Today&apos;s pickups</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
            {pickups.length === 0 ? (
              <p className="caption">No pickups scheduled.</p>
            ) : (
              pickups.map((b) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  action="Check out"
                  href={`/staff/bookings/${b.id}/check-out`}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Today&apos;s returns</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
            {returns.length === 0 ? (
              <p className="caption">No returns scheduled.</p>
            ) : (
              returns.map((b) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  action="Check in"
                  href={`/staff/bookings/${b.id}/check-in`}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
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

type BookingRowProps = {
  b: {
    id: string;
    bookingReference: string;
    pickupDateTime: Date;
    returnDateTime: Date;
    totalAmount: unknown;
    customer: { firstName: string; lastName: string; email: string };
    category: { name: string };
    vehicle: { internalCode: string } | null;
  };
  action: string;
  href: string;
};

function BookingRow({ b, action, href }: BookingRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate font-medium">
          {b.bookingReference} · {b.customer.firstName} {b.customer.lastName}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {b.category.name}
          {b.vehicle && ` · ${b.vehicle.internalCode}`} · {formatDateTime(b.pickupDateTime)} →{" "}
          {formatDateTime(b.returnDateTime)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm font-medium">{formatCurrency(Number(b.totalAmount))}</span>
        <Button asChild size="sm">
          <Link href={href}>{action}</Link>
        </Button>
      </div>
    </div>
  );
}
