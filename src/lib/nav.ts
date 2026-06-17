import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Award,
  Banknote,
  BarChart3,
  Bell,
  Bike,
  BookOpen,
  Brain,
  Building2,
  CalendarCheck,
  CalendarRange,
  CalendarX,
  Car,
  CheckSquare,
  ClipboardCheck,
  CreditCard,
  Database,
  DollarSign,
  Eye,
  FileText,
  Filter,
  Gauge,
  Gavel,
  HardDrive,
  HelpCircle,
  Home,
  IdCard,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  Lightbulb,
  ListOrdered,
  Lock,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  Pencil,
  Percent,
  Plug,
  PlusCircle,
  Radio,
  Receipt,
  Repeat,
  Route,
  Satellite,
  Scale,
  ScrollText,
  Send,
  Server,
  ServerCog,
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
  UserCircle,
  Users,
  Webhook,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type UserRole = "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
export type PortalSection = "staff" | "admin";

/** A single tab/sub-page of a nav item, rendered in the hover flyout. */
export type BackOfficeNavChild = {
  label: string;
  /** Full deep link — includes the `?tab=…` query or a sibling route. */
  href: string;
  /** Matches the icon used by the corresponding tab on the destination page. */
  icon: LucideIcon;
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
  {
    href: "/staff/customers", label: "Customers", icon: Users, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Overview",            href: "/staff/customers",                icon: Gauge },
      { label: "Directory",           href: "/staff/customers/directory",      icon: Users },
      { label: "Verification",        href: "/staff/customers/verification",   icon: IdCard },
      { label: "Risk & Compliance",   href: "/staff/customers/risk",           icon: ShieldAlert },
      { label: "Loyalty & Referrals", href: "/staff/customers/loyalty",        icon: Award },
      { label: "Communications",      href: "/staff/customers/communications", icon: MessageSquare },
      { label: "Documents",           href: "/staff/customers/documents",      icon: FileText },
      { label: "Settings",            href: "/staff/customers/settings",       icon: Settings },
    ],
  },
  {
    href: "/staff/fleet", label: "Fleet", icon: Bike, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Overview",        href: "/staff/fleet",              icon: Gauge },
      { label: "Vehicles",        href: "/staff/fleet/vehicles",     icon: Bike },
      { label: "Live map",        href: "/staff/fleet/live",         icon: Satellite },
      { label: "Makes & Models",  href: "/staff/fleet/makes-models", icon: BookOpen },
      { label: "Maintenance",     href: "/staff/fleet/maintenance",  icon: Wrench },
      { label: "Inspections",     href: "/staff/fleet/inspections",  icon: ClipboardCheck },
      { label: "Incidents",       href: "/staff/fleet/incidents",    icon: AlertTriangle },
      { label: "Infringements",   href: "/staff/fleet/infringements", icon: Receipt },
      { label: "Nominations",     href: "/staff/fleet/nominations",  icon: Gavel },
      { label: "Tolls",           href: "/staff/fleet/tolls",        icon: Route },
      { label: "Settings",        href: "/staff/fleet/settings",     icon: Settings },
    ],
  },
  {
    href: "/staff/communications", label: "Communications", icon: MessageCircle, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Log",          href: "/staff/communications",             icon: Inbox },
      { label: "Compose",      href: "/staff/communications/compose",     icon: Send },
      { label: "Campaigns",    href: "/staff/communications/campaigns",   icon: MessageSquare },
      { label: "Templates",    href: "/staff/communications/templates",   icon: FileText },
      { label: "Segments",     href: "/staff/communications/segments",    icon: Target },
      { label: "Preferences",  href: "/staff/communications/preferences", icon: ShieldCheck },
      { label: "Automations",  href: "/staff/communications/automations", icon: Zap },
    ],
  },
  {
    href: "/staff/support", label: "Support", icon: LifeBuoy, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Tickets",  href: "/staff/support",          icon: Ticket },
      { label: "Insights", href: "/staff/support/insights",  icon: Lightbulb },
    ],
  },
  {
    href: "/staff/live", label: "Live Visitors", icon: Eye, section: "staff", allowedRoles: STAFF_PLUS,
    children: [
      { label: "Live",              href: "/staff/live",              icon: Radio },
      { label: "Sessions",          href: "/staff/live/sessions",     icon: Users },
      { label: "Interactions",      href: "/staff/live/interactions", icon: MousePointerClick },
      { label: "Sales performance", href: "/staff/live/sales",        icon: TrendingUp },
      { label: "Overview",          href: "/staff/live/overview",     icon: Gauge },
      { label: "Acquisition",       href: "/staff/live/acquisition",  icon: Megaphone },
      { label: "Behaviour",         href: "/staff/live/behaviour",    icon: Activity },
      { label: "Conversion",        href: "/staff/live/conversion",   icon: Filter },
      { label: "Retention",         href: "/staff/live/retention",    icon: Repeat },
      { label: "Alerts",            href: "/staff/live/alerts",       icon: Bell },
    ],
  },
  { href: "/staff/ai-insights",    label: "AI Insights",    icon: Sparkles,        section: "staff", allowedRoles: MANAGER_PLUS },
  { href: "/staff/help",           label: "Help",           icon: HelpCircle,      section: "staff", allowedRoles: STAFF_PLUS },

  {
    href: "/admin/dashboard", label: "Dashboard", icon: Gauge, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview", href: "/admin/dashboard",         icon: LayoutDashboard },
      { label: "Risk",     href: "/admin/dashboard/risk",     icon: ShieldAlert },
      { label: "Debt",     href: "/admin/dashboard/debt",     icon: DollarSign },
      { label: "Support",  href: "/admin/dashboard/support",  icon: LifeBuoy },
    ],
  },
  {
    href: "/admin/finance", label: "Finance", icon: DollarSign, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview",       href: "/admin/finance",                icon: LayoutDashboard },
      { label: "Transactions",   href: "/admin/finance/transactions",   icon: ArrowLeftRight },
      { label: "Invoices",       href: "/admin/finance/invoices",       icon: FileText },
      { label: "Bonds",          href: "/admin/finance/bonds",          icon: Lock },
      { label: "GST / BAS",      href: "/admin/finance/gst",            icon: Receipt },
      { label: "Reconciliation", href: "/admin/finance/reconciliation", icon: Scale },
      { label: "Recurring",      href: "/admin/finance/recurring",      icon: Repeat },
      { label: "Webhook health", href: "/admin/webhooks",               icon: Webhook },
    ],
  },
  {
    href: "/admin/pricing", label: "Pricing", icon: Tags, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Rates",      href: "/admin/pricing",            icon: DollarSign },
      { label: "Categories", href: "/admin/pricing/categories", icon: Shapes },
      { label: "Models",     href: "/admin/pricing/models",     icon: Bike },
      { label: "Add-ons",    href: "/admin/pricing/addons",     icon: PlusCircle },
      { label: "Insurance",  href: "/admin/pricing/insurance",  icon: Umbrella },
      { label: "Discounts",  href: "/admin/pricing/discounts",  icon: Percent },
      { label: "Seasons",    href: "/admin/pricing/seasons",    icon: CalendarRange },
    ],
  },
  {
    href: "/admin/reports", label: "Reports", icon: BarChart3, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Bookings",    href: "/admin/reports",             icon: ArrowLeftRight },
      { label: "Fleet",       href: "/admin/reports/fleet",       icon: Bike },
      { label: "Customers",   href: "/admin/reports/customers",   icon: Users },
      { label: "Financial",   href: "/admin/reports/financial",   icon: Banknote },
      { label: "Operational", href: "/admin/reports/operational", icon: AlertTriangle },
    ],
  },
  {
    href: "/admin/integrations", label: "Integrations", icon: Plug, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview",      href: "/admin/integrations",            icon: LayoutGrid },
      { label: "Payments & ID", href: "/admin/integrations/payments",   icon: CreditCard },
      { label: "Messaging",     href: "/admin/integrations/messaging",  icon: MessagesSquare },
      { label: "Accounting",    href: "/admin/integrations/accounting", icon: Receipt },
      { label: "Tolls",         href: "/admin/integrations/tolls",      icon: Car },
      { label: "Customer CX",   href: "/admin/integrations/customer",   icon: Sparkles },
      { label: "Operations",    href: "/admin/integrations/operations", icon: Satellite },
      { label: "API keys",      href: "/admin/integrations/api-keys",   icon: KeyRound },
    ],
  },
  {
    href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, section: "admin", allowedRoles: ADMIN_PLUS,
    children: [
      { label: "Overview",        href: "/admin/audit-log",                icon: Gauge },
      { label: "Security",        href: "/admin/audit-log/security",       icon: ShieldAlert },
      { label: "Authentication",  href: "/admin/audit-log/authentication", icon: KeyRound },
      { label: "Mutations",       href: "/admin/audit-log/mutations",      icon: Pencil },
      { label: "Webhooks & Jobs", href: "/admin/audit-log/webhooks",       icon: Webhook },
      { label: "Impersonation",   href: "/admin/audit-log/impersonation",  icon: UserCheck },
      { label: "Activity",        href: "/admin/audit-log/activity",       icon: Activity },
      { label: "All events",      href: "/admin/audit-log/all",            icon: ListOrdered },
    ],
  },
  {
    href: "/admin/platform", label: "Platform", icon: ServerCog, section: "admin", allowedRoles: SUPER_ADMIN_ONLY,
    children: [
      { label: "Database",      href: "/admin/platform",               icon: Database },
      { label: "Server",        href: "/admin/platform/server",        icon: Server },
      { label: "Storage",       href: "/admin/platform/storage",       icon: HardDrive },
      { label: "LLM",           href: "/admin/platform/llm",           icon: Brain },
      { label: "Email",         href: "/admin/platform/email",         icon: Mail },
      { label: "SMS",           href: "/admin/platform/sms",           icon: MessageSquare },
      { label: "Payments",      href: "/admin/platform/payments",      icon: CreditCard },
      { label: "Observability", href: "/admin/platform/observability", icon: Activity },
    ],
  },
  {
    href: "/admin/settings", label: "System Settings", icon: Settings, section: "admin", allowedRoles: SUPER_ADMIN_ONLY,
    children: [
      { label: "Organisation",      href: "/admin/settings",                icon: Building2 },
      { label: "Booking",           href: "/admin/settings/booking",        icon: CalendarCheck },
      { label: "Checkout",          href: "/admin/settings/checkout",       icon: ShoppingCart },
      { label: "Cancellation",      href: "/admin/settings/cancellation",   icon: CalendarX },
      { label: "Payment & tax",     href: "/admin/settings/payment",        icon: CreditCard },
      { label: "Pricing",           href: "/admin/settings/pricing",        icon: Tags },
      { label: "Loyalty",           href: "/admin/settings/loyalty",        icon: Award },
      { label: "Notifications",     href: "/admin/settings/notifications",  icon: Bell },
      { label: "Authentication",    href: "/admin/settings/authentication", icon: KeyRound },
      { label: "Audit & retention", href: "/admin/settings/audit",          icon: Archive },
      { label: "Security",          href: "/admin/settings/security",       icon: ShieldCheck },
    ],
  },
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

