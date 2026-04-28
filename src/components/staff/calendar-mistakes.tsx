import Link from "next/link";
import { AlertOctagon, Calendar, FileWarning, Wrench } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { CalendarMistakes } from "@/server/services/staff-ops-signals";

export function CalendarMistakesView({ data }: { data: CalendarMistakes }) {
  if (data.total === 0) {
    return (
      <p className="caption">
        No calendar inconsistencies detected. Allocations, maintenance windows, vehicle
        statuses, and document expiries all line up.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {data.unallocated.length > 0 && (
        <MistakeBlock
          icon={<AlertOctagon className="h-4 w-4 text-destructive" aria-hidden />}
          title="Active booking with no vehicle allocated"
          hint="Staff forgot to allocate a vehicle at check-out. Open the booking to assign one."
        >
          {data.unallocated.map((b) => (
            <Row
              key={b.id}
              href={`/staff/bookings/${b.id}`}
              left={
                <span className="font-medium">
                  {b.bookingReference} · {b.customerName}
                </span>
              }
              mid={<span className="text-xs text-muted-foreground">{b.categoryName}</span>}
              right={<StatusBadge status={b.status as "ACTIVE" | "CHECKED_OUT"} />}
            />
          ))}
        </MistakeBlock>
      )}

      {data.maintenanceConflicts.length > 0 && (
        <MistakeBlock
          icon={<Wrench className="h-4 w-4 text-destructive" aria-hidden />}
          title="Confirmed booking conflicts with maintenance"
          hint="A future booking overlaps a scheduled work order for the same vehicle. Re-allocate or reschedule."
        >
          {data.maintenanceConflicts.map((c) => (
            <Row
              key={`${c.bookingId}:${c.workOrderId}`}
              href={`/staff/bookings/${c.bookingId}`}
              left={
                <span className="font-medium">
                  {c.bookingReference} · {c.vehicleCode}
                </span>
              }
              mid={
                <span className="text-xs text-muted-foreground">
                  Work order {c.workOrderNumber} · {formatDate(c.scheduledStartAt)} → {formatDate(c.scheduledEndAt)}
                </span>
              }
              right={
                <span className="text-xs text-muted-foreground">
                  Booking {formatDate(c.pickupDateTime)}
                </span>
              }
            />
          ))}
        </MistakeBlock>
      )}

      {data.statusMismatches.length > 0 && (
        <MistakeBlock
          icon={<Calendar className="h-4 w-4 text-destructive" aria-hidden />}
          title="Vehicle status does not match booking state"
          hint="Vehicle status drifted from what the bookings say. Review the vehicle to resync."
        >
          {data.statusMismatches.map((m) => (
            <Row
              key={m.vehicleId}
              href={`/staff/fleet/${m.vehicleId}`}
              left={<span className="font-medium">{m.vehicleCode}</span>}
              mid={
                <span className="text-xs text-muted-foreground">
                  {m.observed === "AVAILABLE_BUT_ON_HIRE"
                    ? `Marked AVAILABLE but booking ${m.bookingReference ?? "—"} is active`
                    : "Marked RENTED but no active booking"}
                </span>
              }
              right={<StatusBadge status={m.vehicleStatus as "AVAILABLE" | "RENTED"} />}
            />
          ))}
        </MistakeBlock>
      )}

      {data.docsExpiringWithBooking.length > 0 && (
        <MistakeBlock
          icon={<FileWarning className="h-4 w-4 text-destructive" aria-hidden />}
          title="Vehicle docs expire before booking ends"
          hint="Rego / CTP / insurance lapses during the rental window. Renew or re-allocate."
        >
          {data.docsExpiringWithBooking.map((d) => (
            <Row
              key={`${d.bookingId}:${d.expiringDoc}`}
              href={`/staff/fleet/${d.vehicleId}`}
              left={
                <span className="font-medium">
                  {d.vehicleCode} · {d.bookingReference}
                </span>
              }
              mid={
                <span className="text-xs text-muted-foreground">
                  {d.expiringDoc.toUpperCase()} expires {formatDate(d.expiresAt)}
                </span>
              }
              right={
                <span className="text-xs text-muted-foreground">
                  Pickup {formatDateTime(d.pickupDateTime)}
                </span>
              }
            />
          ))}
        </MistakeBlock>
      )}
    </div>
  );
}

function MistakeBlock({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  href,
  left,
  mid,
  right,
}: {
  href: string;
  left: React.ReactNode;
  mid: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1 truncate">{left}</div>
      <div className="min-w-0 flex-1 truncate">{mid}</div>
      <div className="shrink-0">{right}</div>
    </Link>
  );
}
