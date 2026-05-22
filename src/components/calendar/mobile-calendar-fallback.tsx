"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { QUERY_TIERS } from "@/lib/trpc/query-tiers";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { MobileListRow } from "@/components/ui/mobile-list-row";
import { MobileEmptyState } from "@/components/ui/mobile-empty-state";
import { NewWalkInButton } from "@/components/staff/new-walk-in-button";
import { cn } from "@/lib/utils";

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function chipLabel(d: Date, today: Date): { line1: string; line2: string } {
  if (isSameDay(d, today)) return { line1: "Today", line2: d.getDate().toString() };
  if (isSameDay(d, addDays(today, 1))) return { line1: "Tomorrow", line2: d.getDate().toString() };
  return {
    line1: d.toLocaleDateString("en-AU", { weekday: "short" }),
    line2: d.getDate().toString(),
  };
}

/**
 * Mobile-only bookings agenda — replaces FullCalendar at `<md`. Chip row
 * selects a day from a 14-day window (today + 13 days forward), agenda
 * list shows that day's pickups in pickup-time order.
 */
export function MobileCalendarFallback() {
  const [today, setToday] = React.useState<Date>(() => startOfDay(new Date()));

  React.useEffect(() => {
    const refresh = () => {
      const next = startOfDay(new Date());
      setToday((prev) => (prev.getTime() === next.getTime() ? prev : next));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let timer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      timer = setTimeout(() => {
        refresh();
        scheduleMidnight();
      }, nextMidnight.getTime() - now.getTime());
    };
    scheduleMidnight();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(timer);
    };
  }, []);

  const days = React.useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(today, i)),
    [today],
  );
  const [rawSelected, setSelected] = React.useState<Date>(today);

  // When the day rolls over (midnight or visibilitychange brings the tab
  // back the next morning) `today` advances and the chip strip regenerates.
  // Clamp during render so a stale `rawSelected` that's now outside the
  // window snaps forward — without it, the agenda silently renders
  // yesterday under today's header.
  const selected = days.some((d) => isSameDay(d, rawSelected))
    ? rawSelected
    : today;

  const start = React.useMemo(() => startOfDay(selected).toISOString(), [selected]);
  const end = React.useMemo(() => endOfDay(selected).toISOString(), [selected]);

  const { data: bookings, isLoading } = trpc.staffBooking.calendarRange.useQuery(
    { start, end },
    QUERY_TIERS.operational,
  );

  const sorted = React.useMemo(() => {
    if (!bookings) return [];
    return [...bookings].sort(
      (a, b) =>
        new Date(a.pickupDateTime as unknown as string).getTime() -
        new Date(b.pickupDateTime as unknown as string).getTime(),
    );
  }, [bookings]);

  const sectionTitle = (() => {
    if (isSameDay(selected, today)) return "Today";
    if (isSameDay(selected, addDays(today, 1))) return "Tomorrow";
    return selected.toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
  })();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Bookings"
        actions={<NewWalkInButton />}
        mobileActionsOverflow
      />

      <div
        className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1"
        role="tablist"
        aria-label="Pick a day"
      >
        {days.map((d) => {
          const active = isSameDay(d, selected);
          const { line1, line2 } = chipLabel(d, today);
          return (
            <button
              key={d.toISOString()}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(d)}
              className={cn(
                "flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-md border transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted/40",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide">
                {line1}
              </span>
              <span className="text-lg font-semibold leading-none">{line2}</span>
            </button>
          );
        })}
      </div>

      <PageSection title={sectionTitle} flush>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-md border bg-card shadow-sm"
              />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <MobileEmptyState
            icon={<CalendarDays className="h-5 w-5" aria-hidden />}
            title={`No bookings on ${sectionTitle.toLowerCase()}`}
            description="Pick another day from the strip above to see its pickups and returns."
          />
        ) : (
          <ul className="space-y-2">
            {sorted.map((b) => (
              <li key={b.id}>
                <MobileListRow
                  href={`/staff/bookings/${b.id}`}
                  primary={b.bookingReference}
                  secondary={
                    b.customer
                      ? `${b.customer.firstName} ${b.customer.lastName}`
                      : "—"
                  }
                  meta={`${formatTime(b.pickupDateTime as unknown as string)} – ${formatTime(
                    b.returnDateTime as unknown as string,
                  )}`}
                  status={<StatusBadge status={b.status as StatusKey} />}
                />
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </PageShell>
  );
}
