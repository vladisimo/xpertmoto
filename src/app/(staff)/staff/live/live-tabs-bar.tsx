"use client";

import { SectionNav } from "@/components/layout/section-nav";

/**
 * Live visitors section menu. On lg+ the rail (see SectionShell) takes over;
 * this renders the horizontal scroll strip fallback below lg.
 */
export function LiveTabsBar() {
  return <SectionNav section="live" />;
}
