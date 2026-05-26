import Link from "next/link";
import Image from "next/image";
import {
  AlertOctagon,
  AlertTriangle,
  Bike,
  Clock,
  Disc,
  ImageIcon,
  LogIn,
  LogOut,
  Send,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { NotReturnedBikes } from "@/components/staff/not-returned-bikes";
import { CalendarMistakesView } from "@/components/staff/calendar-mistakes";
import { TyreAlerts } from "@/components/staff/tyre-alerts";
import { findNotReturnedBookings } from "@/server/services/staff-ops-signals";
import { getCalendarMistakes, getTyreAlerts } from "@/server/queries/cached";

const MS_IN_DAY = 86_400_000;

export async function StaffTodayTab({ depotId }: { depotId?: string }) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const in14 = new Date(now.getTime() + 14 * MS_IN_DAY);
  const in30 = new Date(now.getTime() + 30 * MS_IN_DAY);
  const fleetAttentionWhere = {
    isActive: true,
    ...(depotId ? { depotId } : {}),
    OR: [
      { regoExpiry: { lt: in30 } },
      { ctpExpiry: { lt: in30 } },
      { insuranceExpiry: { lt: in30 } },
      { nextServiceDueDate: { lt: in14 } },
    ],
  };

  const vehicleInclude = {
    images: {
      orderBy: [
        { isPrimary: "desc" as const },
        { displayOrder: "asc" as const },
      ],
      take: 1,
    },
  };

  const [
    pickups,
    returns,
    activeCount,
    overdueRows,
    fleetAttentionCount,
    fleetVehicles,
    mistakes,
    tyreAlerts,
  ] = await Promise.all([
    prisma.booking.findMany({
      where: {
        pickupDateTime: { gte: startOfDay, lt: endOfDay },
        status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
        ...(depotId ? { pickupDepotId: depotId } : {}),
      },
      include: {
        customer: true,
        category: true,
        vehicle: { include: vehicleInclude },
      },
      orderBy: { pickupDateTime: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        returnDateTime: { gte: startOfDay, lt: endOfDay },
        status: { in: ["ACTIVE", "CHECKED_OUT"] },
        ...(depotId ? { returnDepotId: depotId } : {}),
      },
      include: {
        customer: true,
        category: true,
        vehicle: { include: vehicleInclude },
      },
      orderBy: { returnDateTime: "asc" },
    }),
    prisma.booking.count({
      where: { status: "ACTIVE", ...(depotId ? { depotId } : {}) },
    }),
    findNotReturnedBookings(depotId),
    prisma.vehicle.count({ where: fleetAttentionWhere }),
    prisma.vehicle.findMany({
      where: fleetAttentionWhere,
      orderBy: { nextServiceDueDate: "asc" },
      take: 40,
    }),
    getCalendarMistakes(depotId),
    getTyreAlerts(depotId),
  ]);

  // Overdue signals — merged in from the former Overdue tab. The not-returned
  // query shares the Today "Overdue" definition, so derive the count from it.
  const overdueCount = overdueRows.length;
  const noticeSent = overdueRows.filter((r) => r.overdueStage >= 1).length;
  const managerEscalation = overdueRows.filter(
    (r) => r.overdueStage >= 3,
  ).length;
  const over24h = overdueRows.filter((r) => r.hoursOverdue >= 24).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:overflow-hidden">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Today's movements">
          <StatTile label="Pickups" value={pickups.length} icon={LogOut} />
          <StatTile label="Returns" value={returns.length} icon={LogIn} />
          <StatTile label="Active" value={activeCount} icon={Bike} />
          <StatTile
            label="Overdue"
            value={overdueCount}
            icon={AlertTriangle}
            tone={overdueCount > 0 ? "warn" : undefined}
          />
        </StatCard>
        <StatCard title="Overdue escalation">
          <StatTile
            label="Not returned"
            value={overdueCount}
            icon={AlertOctagon}
            tone={overdueCount > 0 ? "warn" : undefined}
          />
          <StatTile label="Notice sent" value={noticeSent} icon={Send} />
          <StatTile
            label="Manager escalation"
            value={managerEscalation}
            icon={ShieldAlert}
            tone={managerEscalation > 0 ? "warn" : undefined}
          />
          <StatTile
            label="Over 24 hours"
            value={over24h}
            icon={Clock}
            tone={over24h > 0 ? "warn" : undefined}
          />
        </StatCard>
        <StatCard title="Fleet & maintenance">
          <StatTile
            label="Fleet attention"
            value={fleetAttentionCount}
            icon={Bike}
            tone={fleetAttentionCount > 0 ? "warn" : undefined}
          />
          <StatTile
            label="Calendar mistakes"
            value={mistakes.total}
            icon={AlertOctagon}
            tone={mistakes.total > 0 ? "warn" : undefined}
          />
          <StatTile
            label="Tyre alerts"
            value={tyreAlerts.length}
            icon={Disc}
            tone={tyreAlerts.length > 0 ? "warn" : undefined}
          />
        </StatCard>
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
        <ScrollCard title="Today's pickups" count={pickups.length}>
          {pickups.length === 0 ? (
            <EmptyState
              icon={LogOut}
              title="No pickups"
              hint="Nothing scheduled to go out today."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {pickups.map((b) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  kind="pickup"
                  action="Check out"
                  href={`/staff/bookings/${b.id}/check-out`}
                />
              ))}
            </div>
          )}
        </ScrollCard>
        <ScrollCard title="Today's returns" count={returns.length}>
          {returns.length === 0 ? (
            <EmptyState
              icon={LogIn}
              title="No returns"
              hint="Nothing scheduled to come back today."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {returns.map((b) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  kind="return"
                  action="Check in"
                  href={`/staff/bookings/${b.id}/check-in`}
                />
              ))}
            </div>
          )}
        </ScrollCard>
        <ScrollCard
          title="Not returned"
          count={overdueCount}
          description="Past scheduled return — escalation auto-advances (+1h notice, +24h manager, +72h theft)."
        >
          <NotReturnedBikes rows={overdueRows} />
        </ScrollCard>
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
        <ScrollCard
          title="Vehicles needing attention"
          description="Rego / CTP / insurance within 30 days, or service within 14."
          contentClassName="flex flex-col gap-1.5"
        >
          {fleetVehicles.length === 0 ? (
            <EmptyState
              icon={Bike}
              title="Fleet is current"
              hint="No rego, CTP, insurance or service due soon."
            />
          ) : (
            fleetVehicles.map((v) => (
              <Link
                key={v.id}
                href="/staff/fleet?tab=vehicles"
                className="block rounded-md border border-border bg-background px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wider">
                    {v.internalCode}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {v.make} {v.model}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {attentionChips(v, now, in30, in14).map((c) => (
                    <span
                      key={c.label}
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                        c.overdue
                          ? "border-destructive/30 bg-destructive/5 text-destructive"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {c.label} {formatDate(c.date)}
                    </span>
                  ))}
                </div>
              </Link>
            ))
          )}
        </ScrollCard>

        <ScrollCard
          title="Calendar mistakes"
          description="Booking ↔ vehicle ↔ maintenance inconsistencies."
        >
          <CalendarMistakesView data={mistakes} />
        </ScrollCard>

        <ScrollCard
          title="Tyre alerts"
          description="Low tread or high km since last replacement."
        >
          <TyreAlerts rows={tyreAlerts} />
        </ScrollCard>
      </div>
    </div>
  );
}

function ScrollCard({
  title,
  count,
  description,
  contentClassName,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex min-h-0 flex-col overflow-hidden lg:flex-1">
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className="flex items-baseline gap-1.5 text-base">
          <span>{title}</span>
          {count != null && (
            <span className="text-sm font-normal text-muted-foreground">
              ({count})
            </span>
          )}
        </CardTitle>
        {description && (
          <p className="text-caption text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent
        className={cn("min-h-0 flex-1 overflow-auto", contentClassName)}
      >
        {children}
      </CardContent>
    </Card>
  );
}

type AttentionChip = { label: string; date: Date; overdue: boolean };

function attentionChips(
  v: {
    regoExpiry: Date | null;
    ctpExpiry: Date | null;
    insuranceExpiry: Date | null;
    nextServiceDueDate: Date | null;
  },
  now: Date,
  in30: Date,
  in14: Date,
): AttentionChip[] {
  const chips: AttentionChip[] = [];
  if (v.regoExpiry && v.regoExpiry < in30)
    chips.push({
      label: "Rego",
      date: v.regoExpiry,
      overdue: v.regoExpiry < now,
    });
  if (v.ctpExpiry && v.ctpExpiry < in30)
    chips.push({ label: "CTP", date: v.ctpExpiry, overdue: v.ctpExpiry < now });
  if (v.insuranceExpiry && v.insuranceExpiry < in30)
    chips.push({
      label: "Ins",
      date: v.insuranceExpiry,
      overdue: v.insuranceExpiry < now,
    });
  if (v.nextServiceDueDate && v.nextServiceDueDate < in14)
    chips.push({
      label: "Service",
      date: v.nextServiceDueDate,
      overdue: v.nextServiceDueDate < now,
    });
  return chips;
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <Icon className="h-5 w-5 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function StatCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 p-3 pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "warn";
}) {
  const active = tone === "warn" && value > 0;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md border p-2.5 transition-colors ${
        active
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-background"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
          active
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div
          className={`font-display text-xl font-semibold leading-none tracking-tight ${
            active ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

type RowBooking = {
  id: string;
  customerId: string;
  bookingReference: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  totalAmount: unknown;
  customer: { firstName: string; lastName: string };
  category: { name: string };
  vehicle: {
    make: string;
    model: string;
    year: number;
    colour: string;
    rego: string;
    regoState: string;
    internalCode: string;
    images: { url: string; caption: string | null }[];
  } | null;
};

function formatTime(d: Date) {
  return formatDate(d, { timeStyle: "short" });
}

function BookingRow({
  b,
  kind,
  action,
  href,
}: {
  b: RowBooking;
  kind: "pickup" | "return";
  action: string;
  href: string;
}) {
  const v = b.vehicle;
  const image = v?.images[0];
  const title = v ? `${v.year} ${v.make} ${v.model}` : b.category.name;
  const imageAlt = image?.caption ?? title;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5">
      <Link
        href={`/staff/bookings/${b.id}`}
        aria-label={`Open booking ${b.bookingReference}`}
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted ring-offset-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {image ? (
          <Image
            src={image.url}
            alt={imageAlt}
            fill
            sizes="56px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {v && (
            <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wider">
              {v.rego}
            </span>
          )}
          <Link
            href={`/staff/bookings/${b.id}`}
            className="truncate font-semibold hover:underline"
          >
            {title}
          </Link>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {v ? (
            <>
              {v.colour} · {v.regoState} · {v.internalCode}
            </>
          ) : (
            "Vehicle assigned at pickup"
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <Link
            href={`/staff/customers/${b.customerId}`}
            className="font-medium text-foreground hover:underline"
          >
            {b.customer.firstName} {b.customer.lastName}
          </Link>{" "}
          ·{" "}
          {kind === "pickup" ? (
            <>
              out {formatTime(b.pickupDateTime)} · back{" "}
              {formatDate(b.returnDateTime, { day: "numeric", month: "short" })}
            </>
          ) : (
            <>due {formatTime(b.returnDateTime)}</>
          )}{" "}
          · {b.bookingReference}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-sm font-medium">
          {formatCurrency(Number(b.totalAmount))}
        </span>
        <Button asChild size="sm">
          <Link href={href}>{action}</Link>
        </Button>
      </div>
    </div>
  );
}
