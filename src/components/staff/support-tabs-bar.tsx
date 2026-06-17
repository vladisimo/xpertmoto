"use client";

import { SectionNav } from "@/components/layout/section-nav";

/**
 * Support section menu. On lg+ the rail (see SectionShell) takes over; this
 * renders the horizontal scroll strip fallback below lg.
 */
export function SupportTabsBar() {
  return <SectionNav section="support" />;
}
