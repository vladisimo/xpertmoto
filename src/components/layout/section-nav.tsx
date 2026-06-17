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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as TabsPrimitive from "@radix-ui/react-tabs";
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
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { cn } from "@/lib/utils";

export type SectionNavItem = {
  /** Stable id. For query sections this is the `?tab=` value; for route
   *  sections it doubles as the href. */
  key: string;
  label: string;
  icon: LucideIcon;
  /** Route sections only — the destination. */
  href?: string;
  /** Route sections only — match the pathname exactly (section root). */
  exact?: boolean;
  /** Hidden unless the viewer is ADMIN / SUPER_ADMIN. */
  adminOnly?: boolean;
};

export type SectionNavMode =
  | { kind: "query"; basePath: string; clearParams?: string[] }
  | { kind: "route" };

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
    mode: { kind: "query", basePath: "/staff/fleet" },
    items: [
      { key: "overview", label: "Overview", icon: Gauge },
      { key: "vehicles", label: "Vehicles", icon: Bike },
      { key: "live", label: "Live map", icon: Satellite },
      { key: "makes-models", label: "Makes & Models", icon: BookOpen },
      { key: "maintenance", label: "Maintenance", icon: Wrench },
      { key: "inspections", label: "Inspections", icon: ClipboardCheck },
      { key: "incidents", label: "Incidents", icon: AlertTriangle },
      { key: "infringements", label: "Infringements", icon: Receipt },
      { key: "nominations", label: "Nominations", icon: Gavel },
      { key: "tolls", label: "Tolls", icon: Route },
      { key: "depots", label: "Depots", icon: MapPin, adminOnly: true },
      { key: "settings", label: "Settings", icon: Settings },
    ],
  },
  customers: {
    heading: "Customers",
    ariaLabel: "Customer sections",
    mode: { kind: "query", basePath: "/staff/customers" },
    items: [
      { key: "overview", label: "Overview", icon: Gauge },
      { key: "directory", label: "Directory", icon: Users },
      { key: "verification", label: "Verification", icon: IdCard },
      { key: "risk", label: "Risk & Compliance", icon: ShieldAlert },
      { key: "loyalty", label: "Loyalty & Referrals", icon: Award },
      { key: "communications", label: "Communications", icon: MessageSquare },
      { key: "documents", label: "Documents", icon: FileText },
      { key: "settings", label: "Settings", icon: Settings },
      { key: "users", label: "Users & Roles", icon: UserCog, adminOnly: true },
    ],
  },
  audit: {
    heading: "Audit log",
    ariaLabel: "Audit log sections",
    // Drop tab-scoped cursor state when switching tabs so stale pagination
    // doesn't leak into the next view.
    mode: { kind: "query", basePath: "/admin/audit-log", clearParams: ["cursor"] },
    items: [
      { key: "overview", label: "Overview", icon: Gauge },
      { key: "security", label: "Security", icon: ShieldAlert },
      { key: "authentication", label: "Authentication", icon: KeyRound },
      { key: "mutations", label: "Mutations", icon: Pencil },
      { key: "webhooks", label: "Webhooks & Jobs", icon: Webhook },
      { key: "impersonation", label: "Impersonation", icon: UserCheck },
      { key: "activity", label: "Activity", icon: Activity },
      { key: "all", label: "All events", icon: ListOrdered },
    ],
  },
  platform: {
    heading: "Platform",
    ariaLabel: "Platform sections",
    mode: { kind: "query", basePath: "/admin/platform" },
    items: [
      { key: "database", label: "Database", icon: Database },
      { key: "server", label: "Server", icon: Server },
      { key: "storage", label: "Storage", icon: HardDrive },
      { key: "llm", label: "LLM", icon: Brain },
      { key: "email", label: "Email", icon: Mail },
      { key: "sms", label: "SMS", icon: MessageSquare },
      { key: "payments", label: "Payments", icon: CreditCard },
      { key: "observability", label: "Observability", icon: Activity },
    ],
  },
  "admin-dashboard": {
    heading: "Dashboard",
    ariaLabel: "Dashboard sections",
    mode: { kind: "query", basePath: "/admin/dashboard" },
    items: [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      { key: "risk", label: "Risk", icon: ShieldAlert },
      { key: "debt", label: "Debt", icon: DollarSign },
      { key: "support", label: "Support", icon: LifeBuoy },
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
    mode: { kind: "query", basePath: "/staff/support" },
    items: [
      { key: "tickets", label: "Tickets", icon: Ticket },
      { key: "insights", label: "Insights", icon: Lightbulb },
    ],
  },
  live: {
    heading: "Live Visitors",
    ariaLabel: "Live visitor sections",
    mode: { kind: "query", basePath: "/staff/live" },
    items: [
      { key: "live", label: "Live", icon: Radio },
      { key: "sessions", label: "Sessions", icon: Users },
      { key: "interactions", label: "Interactions", icon: MousePointerClick },
      { key: "sales", label: "Sales performance", icon: TrendingUp },
      { key: "overview", label: "Overview", icon: Gauge },
      { key: "acquisition", label: "Acquisition", icon: Megaphone },
      { key: "behaviour", label: "Behaviour", icon: Activity },
      { key: "conversion", label: "Conversion", icon: Filter },
      { key: "retention", label: "Retention", icon: Repeat },
      { key: "alerts", label: "Alerts", icon: Bell },
    ],
  },
  pricing: {
    heading: "Pricing",
    ariaLabel: "Pricing sections",
    mode: { kind: "query", basePath: "/admin/pricing" },
    items: [
      { key: "rates", label: "Rates", icon: DollarSign },
      { key: "categories", label: "Categories", icon: Shapes },
      { key: "models", label: "Models", icon: Bike },
      { key: "addons", label: "Add-ons", icon: PlusCircle },
      { key: "insurance", label: "Insurance", icon: Umbrella },
      { key: "discounts", label: "Discounts", icon: Percent },
      { key: "seasons", label: "Seasons", icon: CalendarRange },
    ],
  },
  reports: {
    heading: "Reports",
    ariaLabel: "Report sections",
    mode: { kind: "query", basePath: "/admin/reports" },
    items: [
      { key: "bookings", label: "Bookings", icon: ArrowLeftRight },
      { key: "fleet", label: "Fleet", icon: Bike },
      { key: "customers", label: "Customers", icon: Users },
      { key: "financial", label: "Financial", icon: Banknote },
      { key: "operational", label: "Operational", icon: AlertTriangle },
    ],
  },
  integrations: {
    heading: "Integrations",
    ariaLabel: "Integration sections",
    mode: { kind: "query", basePath: "/admin/integrations" },
    items: [
      { key: "overview", label: "Overview", icon: LayoutGrid },
      { key: "payments", label: "Payments & ID", icon: CreditCard },
      { key: "messaging", label: "Messaging", icon: MessagesSquare },
      { key: "accounting", label: "Accounting", icon: Receipt },
      { key: "tolls", label: "Tolls", icon: Car },
      { key: "customer", label: "Customer CX", icon: Sparkles },
      { key: "operations", label: "Operations", icon: Satellite },
      { key: "api-keys", label: "API keys", icon: KeyRound },
    ],
  },
  settings: {
    heading: "System Settings",
    ariaLabel: "System settings sections",
    mode: { kind: "query", basePath: "/admin/settings" },
    items: [
      { key: "organisation", label: "Organisation", icon: Building2 },
      { key: "booking", label: "Booking", icon: CalendarCheck },
      { key: "checkout", label: "Checkout", icon: ShoppingCart },
      { key: "cancellation", label: "Cancellation", icon: CalendarX },
      { key: "payment", label: "Payment & tax", icon: CreditCard },
      { key: "pricing", label: "Pricing", icon: Tags },
      { key: "loyalty", label: "Loyalty", icon: Award },
      { key: "notifications", label: "Notifications", icon: Bell },
      { key: "authentication", label: "Authentication", icon: KeyRound },
      { key: "audit", label: "Audit & retention", icon: Archive },
      { key: "security", label: "Security", icon: ShieldCheck },
    ],
  },
};

/** Shared per-render state derived from the section def + current URL. */
function useSectionState(section: SectionKey, isAdmin: boolean) {
  const def = SECTIONS[section];
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const items = React.useMemo(
    () => def.items.filter((i) => isAdmin || !i.adminOnly),
    [def, isAdmin],
  );

  // Admin route groups carry the indigo accent; staff carry green. The active
  // icon colour mirrors the primary sidebar's ACCENT map.
  const accentIcon = pathname.startsWith("/admin") ? "text-admin" : "text-staff";

  const isQuery = def.mode.kind === "query";
  const activeTab = isQuery
    ? (searchParams.get("tab") ?? items[0]?.key ?? "")
    : "";

  const onSelectTab = React.useCallback(
    (key: string) => {
      if (def.mode.kind !== "query") return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", key);
      def.mode.clearParams?.forEach((p) => params.delete(p));
      router.replace(`${def.mode.basePath}?${params.toString()}`, { scroll: false });
    },
    [def, router, searchParams],
  );

  const isRouteActive = React.useCallback(
    (item: SectionNavItem) => {
      if (!item.href) return false;
      return item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(item.href + "/");
    },
    [pathname],
  );

  return { def, items, accentIcon, isQuery, activeTab, onSelectTab, isRouteActive };
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
  const { def, items, accentIcon, isQuery, activeTab, onSelectTab, isRouteActive } =
    useSectionState(section, isAdmin);

  if (isQuery) {
    return (
      <TabsPrimitive.Root value={activeTab} onValueChange={onSelectTab}>
        <TabsPrimitive.List
          aria-label={def.ariaLabel}
          className="flex items-center gap-1"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const on = item.key === activeTab;
            return (
              <TabsPrimitive.Trigger
                key={item.key}
                value={item.key}
                className={cn(BAR_ITEM, on ? BAR_ACTIVE : BAR_INACTIVE)}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0",
                    on ? accentIcon : BAR_ICON_INACTIVE,
                  )}
                />
                <span>{item.label}</span>
              </TabsPrimitive.Trigger>
            );
          })}
        </TabsPrimitive.List>
      </TabsPrimitive.Root>
    );
  }

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
  const { def, items, isQuery, activeTab, onSelectTab, isRouteActive } =
    useSectionState(section, isAdmin);

  if (isQuery) {
    return (
      <div className="lg:hidden">
        <Tabs value={activeTab} onValueChange={onSelectTab}>
          <MobileScrollTabs className="w-full justify-start sm:w-full">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <TabsTrigger key={item.key} value={item.key} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </TabsTrigger>
              );
            })}
          </MobileScrollTabs>
        </Tabs>
      </div>
    );
  }

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
