"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { QUERY_TIERS } from "@/lib/trpc/query-tiers";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import { DesktopRecommendedNotice } from "@/components/layout/desktop-recommended-notice";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { NewWalkInButton } from "@/components/staff/new-walk-in-button";

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfTodayISO() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function formatTime(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/**
 * Mobile-only fallback for the bookings calendar — the FullCalendar grid
 * is unusable below `md`, so on small viewports we show today's pickups
 * and returns as a plain list with a "use desktop" hint.
 */
export function MobileCalendarFallback() {
  const start = useMemo(() => startOfTodayISO(), []);
  const end = useMemo(() => endOfTodayISO(), []);

  const { data: bookings, isLoading } = trpc.staffBooking.calendarRange.useQuery(
    { start, end },
    QUERY_TIERS.operational,
  );

  const sorted = useMemo(() => {
    if (!bookings) return [];
    return [...bookings].sort(
      (a, b) =>
        new Date(a.pickupDateTime as unknown as string).getTime() -
        new Date(b.pickupDateTime as unknown as string).getTime(),
    );
  }, [bookings]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Bookings"
        actions={<NewWalkInButton />}
      />

      <DesktopRecommendedNotice
        description="The bookings calendar is built for a desktop screen. Below is today's bookings list — open on a laptop or tablet for the full timeline."
      />

      <PageSection title="Today" flush>
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
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <CalendarDays className="h-6 w-6" aria-hidden />
              <p>No bookings for today.</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {sorted.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/staff/bookings/${b.id}`}
                  className="block rounded-md border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="text-body font-semibold text-foreground">
                        {b.bookingReference}
                      </div>
                      <div className="text-caption text-muted-foreground">
                        {b.customer
                          ? `${b.customer.firstName} ${b.customer.lastName}`
                          : "—"}
                      </div>
                      <div className="text-caption text-muted-foreground">
                        {formatTime(b.pickupDateTime as unknown as string)} –{" "}
                        {formatTime(b.returnDateTime as unknown as string)}
                      </div>
                    </div>
                    <StatusBadge status={b.status as StatusKey} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </PageShell>
  );
}
