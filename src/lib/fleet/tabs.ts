/**
 * Tab values for /staff/fleet — kept in a pure module (no "use client",
 * no React imports) so server components can import them without forcing
 * Next.js to serialise icon component refs across the client boundary.
 *
 * Labels and icons live in the client tab bar component; this file is the
 * single source of truth for the value tuple and the matching union type.
 */
export const FLEET_TAB_VALUES = [
  "overview",
  "vehicles",
  "makes-models",
  "maintenance",
  "inspections",
  "incidents",
  "infringements",
  "tolls",
  "depots",
  "settings",
] as const;

export type FleetTabValue = (typeof FLEET_TAB_VALUES)[number];

/**
 * Tabs that are only meaningful to ADMIN / SUPER_ADMIN. The "depots" tab wraps
 * the former /admin/depots page (locations, contact details, operating hours),
 * whose tRPC procedures are admin-gated — staff and managers never see it.
 */
export const ADMIN_ONLY_FLEET_TABS: readonly FleetTabValue[] = ["depots"];

export function isFleetTabValue(v: string | undefined): v is FleetTabValue {
  return v != null && (FLEET_TAB_VALUES as readonly string[]).includes(v);
}

export function isAdminOnlyFleetTab(v: FleetTabValue): boolean {
  return ADMIN_ONLY_FLEET_TABS.includes(v);
}
