"use client";

import { SectionNav } from "@/components/layout/section-nav";

/**
 * Reports section menu. On lg+ the rail (see SectionShell) takes over; this
 * renders the horizontal scroll strip fallback below lg.
 */
export function ReportsTabsBar() {
  return <SectionNav section="reports" />;
}
