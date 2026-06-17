import { BACK_OFFICE_NAV, canAccess, type UserRole } from "@/lib/nav";
import { e2ePrisma } from "../_fixtures/db";

/**
 * Route manifest for the role-scoped render sweeps. Back-office routes derive
 * from the canonical BACK_OFFICE_NAV (so new nav items are swept automatically,
 * including every `?tab=` flyout child); routes that exist but aren't in the
 * nav are listed explicitly. Dynamic `[id]`/`[slug]` routes resolve a
 * representative id from the seeded e2e database at runtime — a resolver
 * returning null annotate-skips that route rather than failing the sweep.
 */

export const PUBLIC_ROUTES: readonly string[] = [
  "/",
  "/booking",
  "/fleet",
  "/tours",
  "/locations",
  "/pricing",
  "/contact",
  "/faq",
  "/gift-cards",
  "/mechanic-services",
  "/privacy",
  "/refund-policy",
  "/reviews",
  "/terms",
  "/trust",
  "/why-xpert",
  // Auth pages render logged-out.
  "/login",
  "/register",
  "/forgot-password",
  "/magic-link-sent",
  // Token-gated pages render their "invalid / missing token" state without a
  // token — still a real render check.
  "/reset-password",
  "/accept-invite",
];

export const CUSTOMER_ROUTES: readonly string[] = [
  "/dashboard",
  "/dashboard/bookings",
  "/dashboard/documents",
  "/dashboard/profile",
  "/dashboard/security",
  "/dashboard/payment-methods",
  "/dashboard/pay",
  "/dashboard/pay/success",
  "/dashboard/support",
];

/** Back-office routes that exist but are not BACK_OFFICE_NAV entries. */
const EXTRA_STAFF_ROUTES: readonly string[] = [
  // /staff/fleet/vehicles is now a nav child (Fleet → Vehicles route), swept from the nav.
  "/staff/fleet/new",
  "/staff/incidents",
  "/staff/inspections",
  "/staff/infringements",
  "/staff/infringements/new",
  "/staff/maintenance",
  "/staff/tolls",
  "/staff/profile",
  "/staff/communications/templates/new",
  "/staff/communications/segments/new",
];

const EXTRA_ADMIN_ROUTES: readonly string[] = [
  "/admin/backups",
  "/admin/damage-tariff",
  "/admin/profile",
  "/admin/finance/categories",
  "/admin/ai-insights",
];

export function backOfficeRoutes(role: UserRole): string[] {
  const fromNav = BACK_OFFICE_NAV.filter((item) => canAccess(item, role)).flatMap((item) => {
    const childHrefs = item.children?.map((c) => c.href) ?? [];
    // The first child intentionally duplicates the parent href.
    return [item.href, ...childHrefs.filter((h) => h !== item.href)];
  });
  const section = role === "STAFF" || role === "MANAGER" ? "/staff/" : "/admin/";
  const extras = (section === "/staff/" ? EXTRA_STAFF_ROUTES : EXTRA_ADMIN_ROUTES).filter(
    (r) => r.startsWith(section),
  );
  return [...fromNav.filter((h) => h.startsWith(section)), ...extras];
}

/**
 * Routes with confirmed open bugs, tracked in docs/frontend-test-findings.md.
 * The sweep marks these test.fixme() so they stay visible in every report
 * without failing the suite; remove the entry when the finding is fixed.
 */
export const KNOWN_BUG_ROUTES: Readonly<Record<string, string>> = {
  "/staff/communications/campaigns":
    "finding #13: nav exposes Campaigns to STAFF but communication.campaignList is managerProcedure → page 403s for staff",
  "/staff/communications/segments":
    "finding #13: nav exposes Segments to STAFF but communication.segmentList is managerProcedure → page 403s for staff",
};

/**
 * Representative dynamic routes, resolved against the seeded e2e DB. Returns
 * null when no suitable row exists (the sweep records a skip annotation).
 */
export type DynamicRoute = { name: string; resolve: () => Promise<string | null> };

export const PUBLIC_DYNAMIC: readonly DynamicRoute[] = [
  {
    name: "/fleet/[slug]",
    resolve: async () => {
      const m = await e2ePrisma.vehicleModel.findFirst({ select: { slug: true } });
      return m ? `/fleet/${m.slug}` : null;
    },
  },
  {
    name: "/tours/[slug]",
    resolve: async () => {
      // Tours may be content-defined rather than DB rows; the listing page is
      // swept statically and the detail page resolves only if a tour model
      // exists. Adjust when tours move to the DB.
      return null;
    },
  },
];

export const CUSTOMER_DYNAMIC: readonly DynamicRoute[] = [
  {
    name: "/dashboard/bookings/[id]",
    resolve: async () => {
      // Booking.customerId references User.id (customer identity is
      // profile-based, but bookings key on the user).
      const sarah = await e2ePrisma.user.findUnique({
        where: { email: "sarah.smith@example.com" },
        select: { id: true },
      });
      if (!sarah) return null;
      const b = await e2ePrisma.booking.findFirst({
        where: { customerId: sarah.id },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      return b ? `/dashboard/bookings/${b.id}` : null;
    },
  },
  {
    name: "/dashboard/support/[id]",
    resolve: async () => {
      const sarah = await e2ePrisma.user.findUnique({
        where: { email: "sarah.smith@example.com" },
        select: { id: true },
      });
      if (!sarah) return null;
      const t = await e2ePrisma.supportTicket
        .findFirst({ where: { customerId: sarah.id }, select: { id: true } })
        .catch(() => null);
      return t ? `/dashboard/support/${t.id}` : null;
    },
  },
];

const HELP_SLUG = "back-office-basics";

export const STAFF_DYNAMIC: readonly DynamicRoute[] = [
  {
    name: "/staff/bookings/[id] (QA-CONFIRMED)",
    resolve: async () => {
      const b = await e2ePrisma.booking.findFirst({
        where: { bookingReference: "QA-CONFIRMED" },
        select: { id: true },
      });
      return b ? `/staff/bookings/${b.id}` : null;
    },
  },
  {
    name: "/staff/bookings/[id]/check-out (QA-CONFIRMED)",
    resolve: async () => {
      const b = await e2ePrisma.booking.findFirst({
        where: { bookingReference: "QA-CONFIRMED" },
        select: { id: true },
      });
      return b ? `/staff/bookings/${b.id}/check-out` : null;
    },
  },
  {
    name: "/staff/bookings/[id]/check-in (QA-OVERDUE)",
    resolve: async () => {
      const b = await e2ePrisma.booking.findFirst({
        where: { bookingReference: "QA-OVERDUE" },
        select: { id: true },
      });
      return b ? `/staff/bookings/${b.id}/check-in` : null;
    },
  },
  {
    name: "/staff/customers/[id]",
    resolve: async () => {
      // staffCustomer.detail looks up by User.id (not CustomerProfile.id).
      const u = await e2ePrisma.user.findUnique({
        where: { email: "qa.customer@example.com" },
        select: { id: true, customerProfile: { select: { id: true } } },
      });
      return u?.customerProfile ? `/staff/customers/${u.id}` : null;
    },
  },
  {
    name: "/staff/fleet/vehicles/[id]",
    resolve: async () => {
      const v = await e2ePrisma.vehicle.findFirst({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
      });
      return v ? `/staff/fleet/vehicles/${v.id}` : null;
    },
  },
  {
    name: "/staff/maintenance/[id]",
    resolve: async () => {
      const wo = await e2ePrisma.maintenanceWorkOrder.findFirst({ select: { id: true } });
      return wo ? `/staff/maintenance/${wo.id}` : null;
    },
  },
  {
    name: "/staff/incidents/[id]",
    resolve: async () => {
      const i = await e2ePrisma.incident.findFirst({ select: { id: true } }).catch(() => null);
      return i ? `/staff/incidents/${i.id}` : null;
    },
  },
  {
    name: "/staff/communications/templates/[id]",
    resolve: async () => {
      const t = await e2ePrisma.notificationTemplate
        .findFirst({ select: { id: true } })
        .catch(() => null);
      return t ? `/staff/communications/templates/${t.id}` : null;
    },
  },
  {
    name: "/staff/communications/segments/[id]",
    resolve: async () => {
      const s = await e2ePrisma.segment.findFirst({ select: { id: true } }).catch(() => null);
      return s ? `/staff/communications/segments/${s.id}` : null;
    },
  },
  {
    name: "/staff/help/[slug]",
    resolve: async () => `/staff/help/${HELP_SLUG}`,
  },
];

export const ADMIN_DYNAMIC: readonly DynamicRoute[] = [
  {
    name: "/admin/help/[slug]",
    resolve: async () => `/admin/help/${HELP_SLUG}`,
  },
  {
    // MANAGER_PLUS staff route — the staff sweep runs as role STAFF and can't
    // see it, so it's swept here under the SUPER_ADMIN session instead.
    name: "/staff/ai-insights (MANAGER_PLUS)",
    resolve: async () => "/staff/ai-insights",
  },
  {
    name: "/admin/ai-insights/[id]",
    // Insights are computed on the fly (no Insight model); the listing page is
    // swept statically and there is no stable id to deep-link. Skip.
    resolve: async () => null,
  },
];
