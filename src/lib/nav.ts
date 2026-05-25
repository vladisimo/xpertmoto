import {
  BarChart3,
  Bike,
  CalendarCheck,
  CheckSquare,
  CreditCard,
  DollarSign,
  Eye,
  FileText,
  Gauge,
  HelpCircle,
  Home,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  MessageCircle,
  MessageSquare,
  Plug,
  ScrollText,
  ServerCog,
  Settings,
  Sparkles,
  UserCircle,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type UserRole = "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
export type PortalSection = "staff" | "admin";

/** A single tab/sub-page of a nav item, rendered in the hover flyout. */
export type BackOfficeNavChild = {
  label: string;
  /** Full deep link — includes the `?tab=…` query or a sibling route. */
  href: string;
};

export type BackOfficeNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  section: PortalSection;
  allowedRoles: readonly UserRole[];
  /**
   * Tabs of the destination page, deep-linked from a hover flyout in the
   * sidebar. Children inherit the parent's `allowedRoles`. The first child
   * (the page's default tab) intentionally equals the parent `href`.
   */
  children?: readonly BackOfficeNavChild[];
};

const STAFF_PLUS: readonly UserRole[] = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"];
const MANAGER_PLUS: readonly UserRole[] = ["MANAGER", "ADMIN", "SUPER_ADMIN"];
const ADMIN_PLUS: readonly UserRole[] = ["ADMIN", "SUPER_ADMIN"];
const SUPER_ADMIN_ONLY: readonly UserRole[] = ["SUPER_ADMIN"];

export const BACK_OFFICE_NAV: readonly BackOfficeNavItem[] = [
  { href: "/staff/dashboard",      label: "Dashboard",      icon: LayoutDashboard, section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/tasks",          label: "Priority Tasks", icon: CheckSquare,     section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/calendar",       label: "Bookings",       icon: CalendarCheck,   section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/customers",      label: "Customers",      icon: Users,           section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/fleet",          label: "Fleet",          icon: Bike,            section: "staff", allowedRoles: STAFF_PLUS },
  {
    href: "/staff/communications", label: "Communications", icon: MessageCircle, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Log",          href: "/staff/communications" },
      { label: "Compose",      href: "/staff/communications/compose" },
      { label: "Campaigns",    href: "/staff/communications/campaigns" },
      { label: "Segments",     href: "/staff/communications/segments" },
      { label: "Preferences",  href: "/staff/communications/preferences" },
      { label: "Automations",  href: "/staff/communications/automations" },
    ],
  },
  {
    href: "/staff/support", label: "Support", icon: LifeBuoy, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Tickets",  href: "/staff/support" },
      { label: "Insights", href: "/staff/support?tab=insights" },
    ],
  },
  {
    href: "/staff/live", label: "Live Visitors", icon: Eye, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Live",              href: "/staff/live" },
      { label: "Sessions",          href: "/staff/live?tab=sessions" },
      { label: "Interactions",      href: "/staff/live?tab=interactions" },
      { label: "Sales performance", href: "/staff/live?tab=sales" },
      { label: "Overview",          href: "/staff/live?tab=overview" },
      { label: "Acquisition",       href: "/staff/live?tab=acquisition" },
      { label: "Behaviour",         href: "/staff/live?tab=behaviour" },
      { label: "Conversion",        href: "/staff/live?tab=conversion" },
      { label: "Retention",         href: "/staff/live?tab=retention" },
      { label: "Alerts",            href: "/staff/live?tab=alerts" },
    ],
  },
  { href: "/staff/ai-insights",    label: "AI Insights",    icon: Sparkles,        section: "staff", allowedRoles: MANAGER_PLUS },
  { href: "/staff/help",           label: "Help",           icon: HelpCircle,      section: "staff", allowedRoles: STAFF_PLUS },

  {
    href: "/admin/dashboard", label: "Dashboard", icon: Gauge, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview", href: "/admin/dashboard" },
      { label: "Risk",     href: "/admin/dashboard?tab=risk" },
      { label: "Debt",     href: "/admin/dashboard?tab=debt" },
      { label: "Support",  href: "/admin/dashboard?tab=support" },
    ],
  },
  { href: "/admin/users",        label: "Users & Roles",   icon: UserCog,     section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/depots",       label: "Depots",          icon: MapPin,      section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/finance",      label: "Finance",         icon: DollarSign,  section: "admin", allowedRoles: ADMIN_PLUS },
  {
    href: "/admin/reports", label: "Reports", icon: BarChart3, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Bookings",    href: "/admin/reports" },
      { label: "Fleet",       href: "/admin/reports?tab=fleet" },
      { label: "Customers",   href: "/admin/reports?tab=customers" },
      { label: "Financial",   href: "/admin/reports?tab=financial" },
      { label: "Operational", href: "/admin/reports?tab=operational" },
    ],
  },
  {
    href: "/admin/integrations", label: "Integrations", icon: Plug, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview",     href: "/admin/integrations" },
      { label: "Payments & ID", href: "/admin/integrations?tab=payments" },
      { label: "Messaging",    href: "/admin/integrations?tab=messaging" },
      { label: "Accounting",   href: "/admin/integrations?tab=accounting" },
      { label: "Tolls",        href: "/admin/integrations?tab=tolls" },
      { label: "Customer CX",  href: "/admin/integrations?tab=customer" },
      { label: "Operations",   href: "/admin/integrations?tab=operations" },
      { label: "API keys",     href: "/admin/integrations?tab=api-keys" },
    ],
  },
  { href: "/admin/notification-templates", label: "Templates", icon: MessageSquare, section: "admin", allowedRoles: ADMIN_PLUS },
  {
    href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview",       href: "/admin/audit-log" },
      { label: "Security",       href: "/admin/audit-log?tab=security" },
      { label: "Authentication", href: "/admin/audit-log?tab=authentication" },
      { label: "Mutations",      href: "/admin/audit-log?tab=mutations" },
      { label: "Webhooks & Jobs", href: "/admin/audit-log?tab=webhooks" },
      { label: "Impersonation",  href: "/admin/audit-log?tab=impersonation" },
      { label: "Activity",       href: "/admin/audit-log?tab=activity" },
      { label: "All events",     href: "/admin/audit-log?tab=all" },
    ],
  },
  {
    href: "/admin/platform", label: "Platform", icon: ServerCog, section: "admin", allowedRoles: SUPER_ADMIN_ONLY,
    children: [
      { label: "Database",      href: "/admin/platform" },
      { label: "Server",        href: "/admin/platform?tab=server" },
      { label: "Storage",       href: "/admin/platform?tab=storage" },
      { label: "LLM",           href: "/admin/platform?tab=llm" },
      { label: "Email",         href: "/admin/platform?tab=email" },
      { label: "SMS",           href: "/admin/platform?tab=sms" },
      { label: "Payments",      href: "/admin/platform?tab=payments" },
      { label: "Observability", href: "/admin/platform?tab=observability" },
    ],
  },
  { href: "/admin/settings",     label: "System Settings", icon: Settings,    section: "admin", allowedRoles: SUPER_ADMIN_ONLY },
  { href: "/admin/help",         label: "Help",            icon: HelpCircle,  section: "admin", allowedRoles: ADMIN_PLUS },
];

export type CustomerNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** True for items shown in the mobile bottom tab bar. */
  primary: boolean;
};

export const CUSTOMER_NAV: readonly CustomerNavItem[] = [
  { href: "/dashboard",                 label: "Dashboard",       icon: Home,        primary: true  },
  { href: "/dashboard/bookings",        label: "My Bookings",     icon: Bike,        primary: true  },
  { href: "/dashboard/documents",       label: "Documents",       icon: FileText,    primary: true  },
  { href: "/dashboard/profile",         label: "Profile",         icon: UserCircle,  primary: true  },
  { href: "/dashboard/payment-methods", label: "Payment methods", icon: CreditCard,  primary: false },
  { href: "/dashboard/support",         label: "Support",         icon: LifeBuoy,    primary: false },
];

export function canAccess(item: BackOfficeNavItem, role: UserRole | undefined): boolean {
  return !!role && item.allowedRoles.includes(role);
}

export function disabledReason(item: BackOfficeNavItem): string {
  if (item.allowedRoles === SUPER_ADMIN_ONLY) return "Requires SUPER_ADMIN role";
  if (item.allowedRoles === ADMIN_PLUS) return "Requires ADMIN role";
  if (item.allowedRoles === MANAGER_PLUS) return "Requires MANAGER role";
  return "You do not have access to this area";
}

