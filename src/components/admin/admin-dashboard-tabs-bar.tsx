"use client";

import { SectionNav } from "@/components/layout/section-nav";

// Tab value tuple + type kept here because the page imports the type to
// validate `?tab=`. Labels/icons now live in the section registry.
export const ADMIN_DASHBOARD_TABS = [
  { value: "overview" },
  { value: "risk" },
  { value: "debt" },
  { value: "support" },
] as const;

export type AdminDashboardTabValue = (typeof ADMIN_DASHBOARD_TABS)[number]["value"];

/**
 * Admin dashboard section menu. On lg+ the rail (see SectionShell) takes over;
 * this renders the horizontal scroll strip fallback below lg.
 */
export function AdminDashboardTabsBar() {
  return <SectionNav section="admin-dashboard" />;
}
