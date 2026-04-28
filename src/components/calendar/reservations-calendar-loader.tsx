"use client";

import dynamic from "next/dynamic";
import { CalendarSkeleton } from "./calendar-skeleton";

export const ReservationsCalendar = dynamic(
  () =>
    import("./reservations-calendar").then((m) => ({
      default: m.ReservationsCalendar,
    })),
  {
    ssr: false,
    loading: () => <CalendarSkeleton />,
  },
);
