"use client";

import { useVisitorHeartbeat } from "@/hooks/use-visitor-heartbeat";

/**
 * Tiny client boundary that just runs the heartbeat hook. Split from the
 * layout so the server layout file stays a server component and we don't
 * ship TRPCProvider wiring twice.
 */
export function VisitorHeartbeatMount(): null {
  useVisitorHeartbeat();
  return null;
}
