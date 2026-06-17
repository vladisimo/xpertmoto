"use client";

/**
 * Section navigation — the per-page menu that used to render as a horizontal
 * tab strip. Now renders two ways from a single registry:
 *
 *  - <SectionTopBar> → a dark horizontal bar (hidden lg:flex), placed by
 *    <SectionShell> as a full-width strip above the page header on large
 *    screens.
 *  - <SectionNav>   → the horizontal scroll strip (lg:hidden), kept inside
 *    PageShell below the PageHeader as the tablet/phone fallback.
 *
 * Both are driven by SECTIONS below so labels/icons/active-state can never
 * drift between the top bar and the strip. Props are serialisable (a section key
 * and an isAdmin boolean) so a server component can render either without
 * passing icon component refs across the client boundary.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Award,
  Banknote,
  Bell,
  Bike,
  BookOpen,
  Brain,
  Building2,
  CalendarCheck,
  CalendarRange,
  CalendarX,
  Car,
  ClipboardCheck,
  CreditCard,
  Database,
  DollarSign,
  FileText,
  Filter,
  Gauge,
  Gavel,
  HardDrive,
  IdCard,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  LifeBuoy,
  ListOrdered,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  Pencil,
  Percent,
  PlusCircle,
  Radio,
  Receipt,
  Repeat,
  Route,
  Satellite,
  Scale,
  Send,
  Server,
  Settings,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tags,
  Target,
  Ticket,
  TrendingUp,
  Umbrella,
  UserCheck,
  UserCog,
  Users,
  Webhook,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionNavItem = {
  /** Stable id; doubles as the href for the route. */
  key: string;
  label: string;
  icon: LucideIcon;
  /** The destination route. */
  href?: string;
  /** Match the pathname exactly (use for the section root / default tab). */
  exact?: boolean;
  /** Hidden unless the viewer is ADMIN / SUPER_ADMIN. */
  adminOnly?: boolean;
};

/**
 * Every back-office section now navigates via real routes. (The legacy
 * `?tab=` query mode was removed once all sections were split into pages.)
 */
export type SectionNavMode = { kind: "route" };

export type SectionKey =
  | "fleet"
  | "customers"
  | "audit"
  | "platform"
  | "admin-dashboard"
  | "finance"
  | "comms"
  | "support"
  | "live"
  | "pricing"
  | "reports"
  | "integrations"
  | "settings";

type SectionDef = {
  heading: string;
  ariaLabel: string;
  mode: SectionNavMode;
  items: SectionNavItem[];
};

const SECTIONS: Record<SectionKey, SectionDef> = {
  fleet: {
    heading: "Fleet",
    ariaLabel: "Fleet sections",
    mode: { kind: "route" },
    items: [
      { key: "/staff/fleet", label: "Overview", icon: Gauge, href: "/staff/fleet", exact: true },
      { key: "/staff/fleet/vehicles", label: "Vehicles", icon: Bike, href: "/staff/fleet/vehicles" },
      { key: "/staff/fleet/live", label: "Live map", icon: Satellite, href: "/staff/fleet/live" },
      { key: "/staff/fleet/makes-models", label: "Makes & Models", icon: BookOpen, href: "/staff/fleet/makes-models" },
      { key: "/staff/fleet/maintenance", label: "Maintenance", icon: Wrench, href: "/staff/fleet/maintenance" },
      { key: "/staff/fleet/inspections", label: "Inspections", icon: ClipboardCheck, href: "/staff/fleet/inspections" },
      { key: "/staff/fleet/incidents", label: "Incidents", icon: AlertTriangle, href: "/staff/fleet/incidents" },
      { key: "/staff/fleet/infringements", label: "Infringements", icon: Receipt, href: "/staff/fleet/infringements" },
      { key: "/staff/fleet/nominations", label: "Nominations", icon: Gavel, href: "/staff/fleet/nominations" },
      { key: "/staff/fleet/tolls", label: "Tolls", icon: Route, href: "/staff/fleet/tolls" },
      { key: "/staff/fleet/depots", label: "Depots", icon: MapPin, href: "/staff/fleet/depots", adminOnly: true },
      { key: "/staff/fleet/settings", label: "Settings", icon: Settings, href: "/staff/fleet/settings" },
    ],
  },
  customers: {
    heading: "Customers",
    ariaLabel: "Customer sections",
    mode: { kind: "route" },
    items: [
      { key: "/staff/customers", label: "Overview", icon: Gauge, href: "/staff/customers", exact: true },
      { key: "/staff/customers/directory", label: "Directory", icon: Users, href: "/staff/customers/directory" },
      { key: "/staff/customers/verification", label: "Verification", icon: IdCard, href: "/staff/customers/verification" },
      { key: "/staff/customers/risk", label: "Risk & Compliance", icon: ShieldAlert, href: "/staff/customers/risk" },
      { key: "/staff/customers/loyalty", label: "Loyalty & Referrals", icon: Award, href: "/staff/customers/loyalty" },
      { key: "/staff/customers/communications", label: "Communications", icon: MessageSquare, href: "/staff/customers/communications" },
      { key: "/staff/customers/documents", label: "Documents", icon: FileText, href: "/staff/customers/documents" },
      { key: "/staff/customers/settings", label: "Settings", icon: Settings, href: "/staff/customers/settings" },
      { key: "/staff/customers/users", label: "Users & Roles", icon: UserCog, href: "/staff/customers/users", adminOnly: true },
    ],
  },
  audit: {
    heading: "Audit log",
    ariaLabel: "Audit log sections",
    // Each tab is its own route now, so pagination cursors no longer leak
    // across tabs (the old query-mode clearParams:['cursor'] is unnecessary).
    mode: { kind: "route" },
    items: [
      { key: "/admin/audit-log", label: "Overview", icon: Gauge, href: "/admin/audit-log", exact: true },
      { key: "/admin/audit-log/security", label: "Security", icon: ShieldAlert, href: "/admin/audit-log/security" },
      { key: "/admin/audit-log/authentication", label: "Authentication", icon: KeyRound, href: "/admin/audit-log/authentication" },
      { key: "/admin/audit-log/mutations", label: "Mutations", icon: Pencil, href: "/admin/audit-log/mutations" },
      { key: "/admin/audit-log/webhooks", label: "Webhooks & Jobs", icon: Webhook, href: "/admin/audit-log/webhooks" },
      { key: "/admin/audit-log/impersonation", label: "Impersonation", icon: UserCheck, href: "/admin/audit-log/impersonation" },
      { key: "/admin/audit-log/activity", label: "Activity", icon: Activity, href: "/admin/audit-log/activity" },
      { key: "/admin/audit-log/all", label: "All events", icon: ListOrdered, href: "/admin/audit-log/all" },
    ],
  },
  platform: {
    heading: "Platform",
    ariaLabel: "Platform sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/platform", label: "Database", icon: Database, href: "/admin/platform", exact: true },
      { key: "/admin/platform/server", label: "Server", icon: Server, href: "/admin/platform/server" },
      { key: "/admin/platform/storage", label: "Storage", icon: HardDrive, href: "/admin/platform/storage" },
      { key: "/admin/platform/llm", label: "LLM", icon: Brain, href: "/admin/platform/llm" },
      { key: "/admin/platform/email", label: "Email", icon: Mail, href: "/admin/platform/email" },
      { key: "/admin/platform/sms", label: "SMS", icon: MessageSquare, href: "/admin/platform/sms" },
      { key: "/admin/platform/payments", label: "Payments", icon: CreditCard, href: "/admin/platform/payments" },
      { key: "/admin/platform/observability", label: "Observability", icon: Activity, href: "/admin/platform/observability" },
    ],
  },
  "admin-dashboard": {
    heading: "Dashboard",
    ariaLabel: "Dashboard sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/dashboard", label: "Overview", icon: LayoutDashboard, href: "/admin/dashboard", exact: true },
      { key: "/admin/dashboard/risk", label: "Risk", icon: ShieldAlert, href: "/admin/dashboard/risk" },
      { key: "/admin/dashboard/debt", label: "Debt", icon: DollarSign, href: "/admin/dashboard/debt" },
      { key: "/admin/dashboard/support", label: "Support", icon: LifeBuoy, href: "/admin/dashboard/support" },
    ],
  },
  finance: {
    heading: "Finance",
    ariaLabel: "Finance sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/finance", label: "Overview", icon: LayoutDashboard, href: "/admin/finance", exact: true },
      { key: "/admin/finance/transactions", label: "Transactions", icon: ArrowLeftRight, href: "/admin/finance/transactions" },
      { key: "/admin/finance/invoices", label: "Invoices", icon: FileText, href: "/admin/finance/invoices" },
      { key: "/admin/finance/bonds", label: "Bonds", icon: Lock, href: "/admin/finance/bonds" },
      { key: "/admin/finance/gst", label: "GST / BAS", icon: Receipt, href: "/admin/finance/gst" },
      { key: "/admin/finance/reconciliation", label: "Reconciliation", icon: Scale, href: "/admin/finance/reconciliation" },
      { key: "/admin/finance/recurring", label: "Recurring", icon: Repeat, href: "/admin/finance/recurring" },
      { key: "/admin/webhooks", label: "Webhook health", icon: Webhook, href: "/admin/webhooks" },
    ],
  },
  comms: {
    heading: "Communications",
    ariaLabel: "Communications sections",
    mode: { kind: "route" },
    items: [
      { key: "/staff/communications", label: "Log", icon: Inbox, href: "/staff/communications", exact: true },
      { key: "/staff/communications/compose", label: "Compose", icon: Send, href: "/staff/communications/compose" },
      { key: "/staff/communications/campaigns", label: "Campaigns", icon: MessageSquare, href: "/staff/communications/campaigns" },
      { key: "/staff/communications/templates", label: "Templates", icon: FileText, href: "/staff/communications/templates" },
      { key: "/staff/communications/segments", label: "Segments", icon: Target, href: "/staff/communications/segments" },
      { key: "/staff/communications/preferences", label: "Preferences", icon: ShieldCheck, href: "/staff/communications/preferences" },
      { key: "/staff/communications/automations", label: "Automations", icon: Zap, href: "/staff/communications/automations" },
    ],
  },
  support: {
    heading: "Support",
    ariaLabel: "Support sections",
    mode: { kind: "route" },
    items: [
      { key: "/staff/support", label: "Tickets", icon: Ticket, href: "/staff/support", exact: true },
      { key: "/staff/support/insights", label: "Insights", icon: Lightbulb, href: "/staff/support/insights" },
    ],
  },
  live: {
    heading: "Live Visitors",
    ariaLabel: "Live visitor sections",
    mode: { kind: "route" },
    items: [
      { key: "/staff/live", label: "Live", icon: Radio, href: "/staff/live", exact: true },
      { key: "/staff/live/sessions", label: "Sessions", icon: Users, href: "/staff/live/sessions" },
      { key: "/staff/live/interactions", label: "Interactions", icon: MousePointerClick, href: "/staff/live/interactions" },
      { key: "/staff/live/sales", label: "Sales performance", icon: TrendingUp, href: "/staff/live/sales" },
      { key: "/staff/live/overview", label: "Overview", icon: Gauge, href: "/staff/live/overview" },
      { key: "/staff/live/acquisition", label: "Acquisition", icon: Megaphone, href: "/staff/live/acquisition" },
      { key: "/staff/live/behaviour", label: "Behaviour", icon: Activity, href: "/staff/live/behaviour" },
      { key: "/staff/live/conversion", label: "Conversion", icon: Filter, href: "/staff/live/conversion" },
      { key: "/staff/live/retention", label: "Retention", icon: Repeat, href: "/staff/live/retention" },
      { key: "/staff/live/alerts", label: "Alerts", icon: Bell, href: "/staff/live/alerts" },
    ],
  },
  pricing: {
    heading: "Pricing",
    ariaLabel: "Pricing sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/pricing", label: "Rates", icon: DollarSign, href: "/admin/pricing", exact: true },
      { key: "/admin/pricing/categories", label: "Categories", icon: Shapes, href: "/admin/pricing/categories" },
      { key: "/admin/pricing/models", label: "Models", icon: Bike, href: "/admin/pricing/models" },
      { key: "/admin/pricing/addons", label: "Add-ons", icon: PlusCircle, href: "/admin/pricing/addons" },
      { key: "/admin/pricing/insurance", label: "Insurance", icon: Umbrella, href: "/admin/pricing/insurance" },
      { key: "/admin/pricing/discounts", label: "Discounts", icon: Percent, href: "/admin/pricing/discounts" },
      { key: "/admin/pricing/seasons", label: "Seasons", icon: CalendarRange, href: "/admin/pricing/seasons" },
    ],
  },
  reports: {
    heading: "Reports",
    ariaLabel: "Report sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/reports", label: "Bookings", icon: ArrowLeftRight, href: "/admin/reports", exact: true },
      { key: "/admin/reports/fleet", label: "Fleet", icon: Bike, href: "/admin/reports/fleet" },
      { key: "/admin/reports/customers", label: "Customers", icon: Users, href: "/admin/reports/customers" },
      { key: "/admin/reports/financial", label: "Financial", icon: Banknote, href: "/admin/reports/financial" },
      { key: "/admin/reports/operational", label: "Operational", icon: AlertTriangle, href: "/admin/reports/operational" },
    ],
  },
  integrations: {
    heading: "Integrations",
    ariaLabel: "Integration sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/integrations", label: "Overview", icon: LayoutGrid, href: "/admin/integrations", exact: true },
      { key: "/admin/integrations/payments", label: "Payments & ID", icon: CreditCard, href: "/admin/integrations/payments" },
      { key: "/admin/integrations/messaging", label: "Messaging", icon: MessagesSquare, href: "/admin/integrations/messaging" },
      { key: "/admin/integrations/accounting", label: "Accounting", icon: Receipt, href: "/admin/integrations/accounting" },
      { key: "/admin/integrations/tolls", label: "Tolls", icon: Car, href: "/admin/integrations/tolls" },
      { key: "/admin/integrations/customer", label: "Customer CX", icon: Sparkles, href: "/admin/integrations/customer" },
      { key: "/admin/integrations/operations", label: "Operations", icon: Satellite, href: "/admin/integrations/operations" },
      { key: "/admin/integrations/api-keys", label: "API keys", icon: KeyRound, href: "/admin/integrations/api-keys" },
    ],
  },
  settings: {
    heading: "System Settings",
    ariaLabel: "System settings sections",
    mode: { kind: "route" },
    items: [
      { key: "/admin/settings", label: "Organisation", icon: Building2, href: "/admin/settings", exact: true },
      { key: "/admin/settings/booking", label: "Booking", icon: CalendarCheck, href: "/admin/settings/booking" },
      { key: "/admin/settings/checkout", label: "Checkout", icon: ShoppingCart, href: "/admin/settings/checkout" },
      { key: "/admin/settings/cancellation", label: "Cancellation", icon: CalendarX, href: "/admin/settings/cancellation" },
      { key: "/admin/settings/payment", label: "Payment & tax", icon: CreditCard, href: "/admin/settings/payment" },
      { key: "/admin/settings/pricing", label: "Pricing", icon: Tags, href: "/admin/settings/pricing" },
      { key: "/admin/settings/loyalty", label: "Loyalty", icon: Award, href: "/admin/settings/loyalty" },
      { key: "/admin/settings/notifications", label: "Notifications", icon: Bell, href: "/admin/settings/notifications" },
      { key: "/admin/settings/authentication", label: "Authentication", icon: KeyRound, href: "/admin/settings/authentication" },
      { key: "/admin/settings/audit", label: "Audit & retention", icon: Archive, href: "/admin/settings/audit" },
      { key: "/admin/settings/security", label: "Security", icon: ShieldCheck, href: "/admin/settings/security" },
    ],
  },
};

/** Shared per-render state derived from the section def + current URL. */
function useSectionState(section: SectionKey, isAdmin: boolean) {
  const def = SECTIONS[section];
  const pathname = usePathname() ?? "";

  const items = React.useMemo(
    () => def.items.filter((i) => isAdmin || !i.adminOnly),
    [def, isAdmin],
  );

  // Admin route groups carry the indigo accent; staff carry green. The active
  // icon colour mirrors the primary sidebar's ACCENT map.
  const accentIcon = pathname.startsWith("/admin") ? "text-admin" : "text-staff";

  const isRouteActive = React.useCallback(
    (item: SectionNavItem) => {
      if (!item.href) return false;
      return item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(item.href + "/");
    },
    [pathname],
  );

  return { def, items, accentIcon, isRouteActive };
}

const BAR_ITEM =
  "group inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BAR_INACTIVE = "text-slate-300 hover:bg-white/5 hover:text-white";
const BAR_ACTIVE = "bg-white/10 text-white shadow-sm";
const BAR_ICON_INACTIVE = "text-slate-400 group-hover:text-slate-200";

/**
 * The dark horizontal top bar. Rendered by <SectionShell> as a full-width
 * strip above the page header on large screens; never on its own. Below lg
 * it is hidden and the in-page <SectionNav> strip takes over. Items overflow
 * to a horizontal scroll when a section has more than fits the row.
 */
export function SectionTopBar({
  section,
  isAdmin = false,
}: {
  section: SectionKey;
  isAdmin?: boolean;
}) {
  const { def, items, accentIcon, isRouteActive } = useSectionState(section, isAdmin);

  return (
    <nav aria-label={def.ariaLabel} className="flex items-center gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const on = isRouteActive(item);
        return (
          <Link
            key={item.key}
            href={item.href!}
            aria-current={on ? "page" : undefined}
            className={cn(BAR_ITEM, on ? BAR_ACTIVE : BAR_INACTIVE)}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                on ? accentIcon : BAR_ICON_INACTIVE,
              )}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const ROUTE_BAR_ITEM = cn(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium ring-offset-background transition-all",
  "border-b-2 border-transparent text-muted-foreground",
  "hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
);

/**
 * The horizontal scroll strip — the tablet/phone fallback. Kept inside
 * PageShell below the PageHeader, exactly where the old tab bars lived.
 * Hidden on lg+, where <SectionRail> takes over.
 */
export function SectionNav({
  section,
  isAdmin = false,
}: {
  section: SectionKey;
  isAdmin?: boolean;
}) {
  const { def, items, isRouteActive } = useSectionState(section, isAdmin);

  return (
    <nav
      aria-label={def.ariaLabel}
      className="-mx-3 inline-flex h-10 w-full items-center justify-start gap-1 overflow-x-auto border-b bg-transparent px-3 sm:mx-0 sm:px-0 lg:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const on = isRouteActive(item);
        return (
          <Link
            key={item.key}
            href={item.href!}
            aria-current={on ? "page" : undefined}
            className={cn(ROUTE_BAR_ITEM, on && "border-primary text-foreground font-semibold")}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
