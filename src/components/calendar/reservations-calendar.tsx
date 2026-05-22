"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import { ChevronDown } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { QUERY_TIERS } from "@/lib/trpc/query-tiers";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bookingsToEvents, type CalendarBooking } from "./calendar-utils";
import { CalendarLegend } from "./calendar-legend";
import { renderEventContent } from "./custom-event-content";
import { NewWalkInButton } from "@/components/staff/new-walk-in-button";
import { PageHeader } from "@/components/layout/page-header";
import { CalendarStats } from "@/components/staff/calendar-stats";

export function ReservationsCalendar() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);

  const [depotId, setDepotId] = useState<string>("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 7);
    return { start: start.toISOString(), end: end.toISOString() };
  });

  const { data: depots } = trpc.depot.list.useQuery(undefined, QUERY_TIERS.stable);
  const { data: categories } = trpc.catalog.listCategories.useQuery(undefined, QUERY_TIERS.stable);
  const { data: bookings } = trpc.staffBooking.calendarRange.useQuery(
    {
      start: dateRange.start,
      end: dateRange.end,
      ...(depotId ? { depotId } : {}),
    },
    QUERY_TIERS.operational,
  );
  const { data: stats, isLoading: statsLoading } = trpc.staffBooking.stats.useQuery(
    depotId ? { depotId } : {},
    { staleTime: 30_000 },
  );

  const events = bookingsToEvents((bookings ?? []) as CalendarBooking[]);

  const handleDatesSet = useCallback((dateInfo: DatesSetArg) => {
    setDateRange({ start: dateInfo.startStr, end: dateInfo.endStr });
  }, []);

  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      info.jsEvent.preventDefault();
      const bookingId = (info.event.extendedProps as { bookingId?: string }).bookingId;
      if (bookingId) {
        router.push(`/staff/bookings/${bookingId}`);
      }
    },
    [router],
  );

  const handleDepotChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setDepotId(e.target.value);
    },
    [],
  );

  const toggleCategory = useCallback((id: string) => {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const categoryLabel =
    categoryIds.length === 0
      ? "All types"
      : categoryIds.length === 1
        ? (categories?.find((c) => c.id === categoryIds[0])?.name ?? "1 type")
        : `${categoryIds.length} types`;

  return (
    <div className="mx-auto flex h-full w-full max-w-screen-2xl flex-col overflow-hidden p-6 lg:p-8">
      <PageHeader
        className="shrink-0 pb-4"
        eyebrow="Operations"
        title="Bookings"
        actions={<NewWalkInButton />}
      />

      <div className="shrink-0 pb-4">
        <CalendarStats data={stats} loading={statsLoading} />
      </div>

      <div className="fc-calendar fc-calendar--with-depot-filter rounded-lg overflow-hidden flex-1 min-h-0 relative">
        <div className="fc-depot-filter absolute top-[4px] right-0 z-10 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-[34px] items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm min-w-[180px]">
              <span className="truncate">{categoryLabel}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              {categories?.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={categoryIds.includes(c.id)}
                  onCheckedChange={() => toggleCategory(c.id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <select
            value={depotId}
            onChange={handleDepotChange}
            className="h-[34px] rounded-md border bg-background px-3 text-sm min-w-[180px]"
          >
            <option value="">All depots</option>
            {depots?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: "today",
            month: "Month",
            week: "Week",
            day: "Day",
            list: "List",
          }}
          events={events}
          eventClick={handleEventClick}
          datesSet={handleDatesSet}
          eventContent={renderEventContent}
          dayMaxEvents={true}
          moreLinkClick="popover"
          nowIndicator={true}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          scrollTime="08:00:00"
          slotDuration="01:00:00"
          height="100%"
          expandRows={true}
          stickyHeaderDates={true}
          eventTimeFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          slotLabelFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          firstDay={0}
          fixedWeekCount={false}
          eventDisplay="block"
          views={{
            dayGridMonth: { eventDisplay: "list-item" },
          }}
          displayEventTime={false}
          dayHeaderFormat={{ weekday: "short", day: "numeric", omitCommas: true }}
        />
      </div>

      <div className="shrink-0 pt-3">
        <CalendarLegend />
      </div>
    </div>
  );
}
