"use client";

import { SectionNav } from "@/components/layout/section-nav";

// Tab value tuple + type kept here because the page imports the type to
// validate `?tab=`. Labels/icons now live in the section registry.
export const PLATFORM_TABS = [
  { value: "database" },
  { value: "server" },
  { value: "storage" },
  { value: "llm" },
  { value: "email" },
  { value: "sms" },
  { value: "payments" },
  { value: "observability" },
] as const;

export type PlatformTabValue = (typeof PLATFORM_TABS)[number]["value"];

/**
 * Platform section menu. On lg+ the rail (see SectionShell) takes over; this
 * renders the horizontal scroll strip fallback below lg.
 */
export function PlatformTabsBar() {
  return <SectionNav section="platform" />;
}
