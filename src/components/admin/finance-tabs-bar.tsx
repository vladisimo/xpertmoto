"use client";

import { SectionNav } from "@/components/layout/section-nav";

/**
 * Finance section menu. On lg+ the rail (see SectionShell, wired via the
 * finance route-group layout) takes over; this renders the horizontal scroll
 * strip fallback below lg.
 */
export function FinanceTabsBar() {
  return <SectionNav section="finance" />;
}
