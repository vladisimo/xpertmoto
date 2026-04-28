"use client";

import { useVisitorEvents } from "@/hooks/use-visitor-events";

/**
 * Tiny client boundary that runs the event-tracking hook. Split from
 * the layout for the same reason as `VisitorHeartbeatMount` — keeps
 * the server layout a server component and avoids duplicating the
 * TRPC provider wiring.
 */
export function VisitorEventsMount(): null {
  useVisitorEvents();
  return null;
}
