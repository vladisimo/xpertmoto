import Link from "next/link";
import Image from "next/image";
import {
  AlertOctagon,
  AlertTriangle,
  Bike,
  CheckCircle2,
  Disc,
  ImageIcon,
  LogIn,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { NotReturnedBikes } from "@/components/staff/not-returned-bikes";
import { StaffDashboardStats } from "@/components/staff/staff-dashboard-stats";
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
    fleetSize,
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
      include: vehicleInclude,
      orderBy: { nextServiceDueDate: "asc" },
      take: 40,
    }),
    getCalendarMistakes(depotId),
    getTyreAlerts(depotId),
    prisma.vehicle.count({
      where: { isActive: true, ...(depotId ? { depotId } : {}) },
    }),
  ]);

  // Overdue signals — merged in from the former Overdue tab. The not-returned
  // query shares the Today "Overdue" definition, so derive the counts from it.
  const overdueCount = overdueRows.length;
  const stats = {
    pickups: pickups.length,
    returns: returns.length,
    active: activeCount,
    overdue: {
      total: overdueCount,
      due: overdueRows.filter((r) => r.overdueStage < 1).length,
      noticeSent: overdueRows.filter(
        (r) => r.overdueStage >= 1 && r.overdueStage < 3,
      ).length,
      escalated: overdueRows.filter((r) => r.overdueStage >= 3).length,
      over24h: overdueRows.filter((r) => r.hoursOverdue >= 24).length,
    },
    fleet: {
      total: fleetSize,
      needsAttention: fleetAttentionCount,
      calendarMistakes: mistakes.total,
      tyreAlerts: tyreAlerts.length,
    },
  };

  return (
    // Viewport-fit when there is room (the min-h floors keep every card
    // usable); on shorter screens (landing-bay iPads) the whole tab scrolls
    // instead of crushing the card bodies.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <StaffDashboardStats data={stats} />

      <div className="flex shrink-0 flex-col gap-2 lg:min-h-[18rem] lg:flex-[5]">
        <p className="eyebrow shrink-0">Today&apos;s run sheet</p>
        <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
          <ScrollCard icon={LogOut} title="Pickups" count={pickups.length}>
            {pickups.length === 0 ? (
              <EmptyState
                icon={LogOut}
                title="No pickups today"
                hint="Confirmed bookings due out will appear here."
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
          <ScrollCard icon={LogIn} title="Returns" count={returns.length}>
            {returns.length === 0 ? (
              <EmptyState
                icon={LogIn}
                title="No returns due today"
                hint="Active hires due back will appear here."
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
            icon={AlertTriangle}
            title="Not returned"
            count={overdueCount}
            alert
          >
            {overdueCount === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="All bikes accounted for"
                hint="No hires are past their return time."
              />
            ) : (
              <NotReturnedBikes rows={overdueRows} />
            )}
          </ScrollCard>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 lg:min-h-[16rem] lg:flex-[4]">
        <p className="eyebrow shrink-0">Fleet health</p>
        <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
          <ScrollCard
            icon={Bike}
            title="Vehicles needing attention"
            count={fleetAttentionCount}
            alert
            description="Rego / CTP / insurance within 30 days, or service within 14."
            contentClassName="flex flex-col gap-2"
          >
            {fleetVehicles.length === 0 ? (
              <EmptyState
                icon={Bike}
                title="Fleet is current"
                hint="No rego, CTP, insurance or service due soon."
              />
            ) : (
              <>
                {fleetVehicles.map((v) => (
                  <FleetRow
                    key={v.id}
                    v={v}
                    chips={attentionChips(v, now, in30, in14)}
                  />
                ))}
                {fleetAttentionCount > fleetVehicles.length && (
                  <Link
                    href="/staff/fleet"
                    className="rounded-md px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
                  >
                    +{fleetAttentionCount - fleetVehicles.length} more — view in
                    Fleet
                  </Link>
                )}
              </>
            )}
          </ScrollCard>

          <ScrollCard
            icon={AlertOctagon}
            title="Calendar mistakes"
            count={mistakes.total}
            alert
            description="Booking ↔ vehicle ↔ maintenance inconsistencies."
          >
            <CalendarMistakesView data={mistakes} />
          </ScrollCard>

          <ScrollCard
            icon={Disc}
            title="Tyre alerts"
            count={tyreAlerts.length}
            alert
            description="Low tread or high km since last replacement."
          >
            <TyreAlerts rows={tyreAlerts} />
          </ScrollCard>
        </div>
      </div>
    </div>
  );
}

function ScrollCard({
  icon: Icon,
  title,
  count,
  alert,
  description,
  contentClassName,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  /** Renders the count pill in the destructive tone while count > 0. */
  alert?: boolean;
  description?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex min-h-0 flex-col overflow-hidden lg:flex-1">
      <CardHeader className="shrink-0 space-y-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="truncate">{title}</span>
          {count != null && (
            <Badge
              variant={alert && count > 0 ? "destructive" : "outline"}
              className="px-2 py-0 text-[11px] tabular-nums"
            >
              {count}
            </Badge>
          )}
          <Icon className="ml-auto h-4 w-4 shrink-0" aria-hidden />
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

type AttentionChip = {
  label: string;
  date: Date;
  overdue: boolean;
  dueText: string;
};

function dueText(date: Date, now: Date): string {
  const days = Math.round((date.getTime() - now.getTime()) / MS_IN_DAY);
  if (days < 0) {
    const n = Math.abs(days);
    return `overdue by ${n} day${n === 1 ? "" : "s"}`;
  }
  if (days === 0) return "due today";
  return `due in ${days} day${days === 1 ? "" : "s"}`;
}

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
  const add = (label: string, date: Date) =>
    chips.push({ label, date, overdue: date < now, dueText: dueText(date, now) });
  if (v.regoExpiry && v.regoExpiry < in30) add("Rego", v.regoExpiry);
  if (v.ctpExpiry && v.ctpExpiry < in30) add("CTP", v.ctpExpiry);
  if (v.insuranceExpiry && v.insuranceExpiry < in30) add("Ins", v.insuranceExpiry);
  if (v.nextServiceDueDate && v.nextServiceDueDate < in14)
    add("Service", v.nextServiceDueDate);
  return chips;
}

function FleetRow({
  v,
  chips,
}: {
  v: {
    id: string;
    make: string;
    model: string;
    year: number;
    colour: string;
    internalCode: string;
    images: { url: string; caption: string | null }[];
  };
  chips: AttentionChip[];
}) {
  const image = v.images[0];
  const title = `${v.year} ${v.make} ${v.model}`;
  return (
    <Link
      href={`/staff/fleet/vehicles/${v.id}?tab=overview&edit=compliance`}
      className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 transition-colors hover:bg-muted/50"
    >
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {image ? (
          <Image
            src={image.url}
            alt={image.caption ?? title}
            fill
            sizes="56px"
            className="object-contain"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wider">
            {v.internalCode}
          </span>
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{v.colour}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className={cn(
                "text-[11px] leading-tight tabular-nums",
                c.overdue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <span className="font-medium">
                {c.label} {c.dueText}
              </span>{" "}
              · {formatDate(c.date)}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
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
