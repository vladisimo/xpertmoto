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

export type BackOfficeNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  section: PortalSection;
  allowedRoles: readonly UserRole[];
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
  { href: "/staff/communications", label: "Communications", icon: MessageCircle,   section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/support",        label: "Support",        icon: LifeBuoy,        section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/live",           label: "Live Visitors",  icon: Eye,             section: "staff", allowedRoles: STAFF_PLUS },
  { href: "/staff/ai-insights",    label: "AI Insights",    icon: Sparkles,        section: "staff", allowedRoles: MANAGER_PLUS },

  { href: "/admin/dashboard",    label: "Dashboard", icon: Gauge,       section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/users",        label: "Users & Roles",   icon: UserCog,     section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/depots",       label: "Depots",          icon: MapPin,      section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/finance",      label: "Finance",         icon: DollarSign,  section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/reports",      label: "Reports",         icon: BarChart3,   section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/integrations", label: "Integrations",    icon: Plug,          section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/notification-templates", label: "Templates", icon: MessageSquare, section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/audit-log",    label: "Audit Log",       icon: ScrollText,    section: "admin", allowedRoles: ADMIN_PLUS },
  { href: "/admin/platform",     label: "Platform",        icon: ServerCog,     section: "admin", allowedRoles: SUPER_ADMIN_ONLY },
  { href: "/admin/settings",     label: "System Settings", icon: Settings,    section: "admin", allowedRoles: SUPER_ADMIN_ONLY },
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

