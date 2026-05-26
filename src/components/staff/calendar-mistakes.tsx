import Link from "next/link";
import {
  AlertOctagon,
  Calendar,
  CheckCircle2,
  FileWarning,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { CalendarMistakes } from "@/server/services/staff-ops-signals";

export function CalendarMistakesView({ data }: { data: CalendarMistakes }) {
  if (data.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
        <CheckCircle2
          className="h-5 w-5 text-muted-foreground/60"
          aria-hidden
        />
        <p className="text-sm font-medium">No inconsistencies</p>
        <p className="text-xs text-muted-foreground">
          Allocations, maintenance, statuses and document expiries all line up.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.unallocated.length > 0 && (
        <Section
          icon={AlertOctagon}
          title="No vehicle allocated"
          count={data.unallocated.length}
        >
          {data.unallocated.map((b) => (
            <AlertItem
              key={b.id}
              href={`/staff/bookings/${b.id}`}
              title={`${b.bookingReference} · ${b.customerName}`}
              detail={b.categoryName}
              badge={
                <StatusBadge status={b.status as "ACTIVE" | "CHECKED_OUT"} />
              }
            />
          ))}
        </Section>
      )}

      {data.maintenanceConflicts.length > 0 && (
        <Section
          icon={Wrench}
          title="Maintenance conflict"
          count={data.maintenanceConflicts.length}
        >
          {data.maintenanceConflicts.map((c) => (
            <AlertItem
              key={`${c.bookingId}:${c.workOrderId}`}
              href={`/staff/bookings/${c.bookingId}`}
              title={`${c.bookingReference} · ${c.vehicleCode}`}
              detail={`WO ${c.workOrderNumber} · ${formatDate(c.scheduledStartAt)} → ${formatDate(
                c.scheduledEndAt,
              )} · booking ${formatDate(c.pickupDateTime)}`}
            />
          ))}
        </Section>
      )}

      {data.statusMismatches.length > 0 && (
        <Section
          icon={Calendar}
          title="Status mismatch"
          count={data.statusMismatches.length}
        >
          {data.statusMismatches.map((m) => (
            <AlertItem
              key={m.vehicleId}
              href={`/staff/fleet/${m.vehicleId}`}
              title={m.vehicleCode}
              detail={
                m.observed === "AVAILABLE_BUT_ON_HIRE"
                  ? `Marked AVAILABLE but booking ${m.bookingReference ?? "—"} is active`
                  : "Marked RENTED but no active booking"
              }
              badge={
                <StatusBadge
                  status={m.vehicleStatus as "AVAILABLE" | "RENTED"}
                />
              }
            />
          ))}
        </Section>
      )}

      {data.docsExpiringWithBooking.length > 0 && (
        <Section
          icon={FileWarning}
          title="Docs expire mid-booking"
          count={data.docsExpiringWithBooking.length}
        >
          {data.docsExpiringWithBooking.map((d) => (
            <AlertItem
              key={`${d.bookingId}:${d.expiringDoc}`}
              href={`/staff/fleet/${d.vehicleId}`}
              title={`${d.vehicleCode} · ${d.bookingReference}`}
              detail={`${d.expiringDoc.toUpperCase()} expires ${formatDate(
                d.expiresAt,
              )} · pickup ${formatDateTime(d.pickupDateTime)}`}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-destructive" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive">
          {count}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function AlertItem({
  href,
  title,
  detail,
  badge,
}: {
  href: string;
  title: string;
  detail: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-border bg-background px-2.5 py-2 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-medium">{title}</span>
        {badge && <span className="shrink-0">{badge}</span>}
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
        {detail}
      </p>
    </Link>
  );
}
