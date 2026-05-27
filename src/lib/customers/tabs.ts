/**
 * Tab values for /staff/customers — kept in a pure module (no "use client",
 * no React imports) so server components can import them without forcing
 * Next.js to serialise icon component refs across the client boundary.
 *
 * Labels and icons live in the client tab bar component; this file is the
 * single source of truth for the value tuple and the matching union type.
 */
export const CUSTOMER_TAB_VALUES = [
  "overview",
  "directory",
  "verification",
  "risk",
  "loyalty",
  "communications",
  "documents",
  "settings",
  "users",
] as const;

export type CustomerTabValue = (typeof CUSTOMER_TAB_VALUES)[number];

/**
 * Tabs that are only meaningful to ADMIN / SUPER_ADMIN. The "users" tab wraps
 * the former /admin/users page (invite staff, manage roles, sessions), whose
 * tRPC procedures are admin-gated — staff and managers never see it.
 */
export const ADMIN_ONLY_CUSTOMER_TABS: readonly CustomerTabValue[] = ["users"];

export function isCustomerTabValue(v: string | undefined): v is CustomerTabValue {
  return v != null && (CUSTOMER_TAB_VALUES as readonly string[]).includes(v);
}

export function isAdminOnlyCustomerTab(v: CustomerTabValue): boolean {
  return ADMIN_ONLY_CUSTOMER_TABS.includes(v);
}
