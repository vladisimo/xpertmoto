"use client";

import { SectionNav } from "@/components/layout/section-nav";
import { FLEET_TAB_VALUES, type FleetTabValue } from "@/lib/fleet/tabs";

// Re-export for callers that already import from this module. New code
// should import from @/lib/fleet/tabs directly.
export { FLEET_TAB_VALUES };
export type { FleetTabValue };

/**
 * Fleet section menu. On lg+ the rail (see SectionShell) takes over; this
 * renders the horizontal scroll strip fallback below lg.
 */
export function FleetTabsBar({ isAdmin = false }: { isAdmin?: boolean }) {
  return <SectionNav section="fleet" isAdmin={isAdmin} />;
}
