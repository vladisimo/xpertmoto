import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { ReservationsCalendar } from "@/components/calendar/reservations-calendar-loader";
import { MobileCalendarFallback } from "@/components/calendar/mobile-calendar-fallback";

export default async function CalendarPage() {
  const helpers = await getSSRHelpers();

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 7).toISOString();

  // Mobile fallback also pulls calendarRange, but for today only — prefetch
  // both ranges so neither code path needs a client round-trip.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  await Promise.all([
    helpers.depot.list.prefetch(),
    helpers.catalog.listCategories.prefetch(),
    helpers.staffBooking.calendarRange.prefetch({ start, end }),
    helpers.staffBooking.calendarRange.prefetch({
      start: todayStart.toISOString(),
      end: todayEnd.toISOString(),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(helpers.queryClient)}>
      <div className="hidden h-full md:block">
        <ReservationsCalendar />
      </div>
      <div className="md:hidden">
        <MobileCalendarFallback />
      </div>
    </HydrationBoundary>
  );
}
