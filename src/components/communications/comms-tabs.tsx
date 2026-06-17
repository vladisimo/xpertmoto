"use client";

import { SectionNav } from "@/components/layout/section-nav";

/**
 * Communications section menu. On lg+ the rail (see SectionShell, wired via
 * the communications route-group layout) takes over; this renders the
 * horizontal scroll strip fallback below lg.
 */
export function CommsTabs() {
  return <SectionNav section="comms" />;
}
