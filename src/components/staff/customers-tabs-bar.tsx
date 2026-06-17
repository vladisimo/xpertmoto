"use client";

import { SectionNav } from "@/components/layout/section-nav";
import { CUSTOMER_TAB_VALUES, type CustomerTabValue } from "@/lib/customers/tabs";

// Re-export for callers that already import from this module. New code
// should import from @/lib/customers/tabs directly.
export { CUSTOMER_TAB_VALUES };
export type { CustomerTabValue };

/**
 * Customers section menu. On lg+ the rail (see SectionShell) takes over; this
 * renders the horizontal scroll strip fallback below lg.
 */
export function CustomersTabsBar({ isAdmin = false }: { isAdmin?: boolean }) {
  return <SectionNav section="customers" isAdmin={isAdmin} />;
}
