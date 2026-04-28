"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  ChevronDown,
  User,
} from "lucide-react";
import {
  BACK_OFFICE_NAV,
  canAccess,
  type PortalSection,
  type UserRole,
} from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useBranding } from "@/components/shared/branding-provider";

type BackOfficeUser = {
  name?: string | null;
  email?: string | null;
  role?: string;
  avatarUrl?: string | null;
};

export type ShellAccent = "staff" | "admin";

const SECTION_META: Record<PortalSection, { label: string }> = {
  staff: { label: "Operations" },
  admin: { label: "Administration" },
};

const SECTIONS_ORDER: PortalSection[] = ["staff", "admin"];

/**
 * Role-accent palette for the sidebar chrome. Keyed by `accent`, not role,
 * because a SUPER_ADMIN viewing `/staff/*` should see the staff accent.
 */
const ACCENT: Record<ShellAccent, {
  gradient: string;
  logoBg: string;
  activeIcon: string;
  chipLabel: string;
  chipClasses: string;
}> = {
  staff: {
    gradient: "bg-black",
    logoBg: "bg-staff text-staff-foreground",
    activeIcon: "text-staff",
    chipLabel: "Operations",
    chipClasses: "bg-staff/15 text-staff ring-1 ring-inset ring-staff/30",
  },
  admin: {
    gradient: "bg-black",
    logoBg: "bg-admin text-admin-foreground",
    activeIcon: "text-admin",
    chipLabel: "Admin",
    chipClasses: "bg-admin/15 text-admin ring-1 ring-inset ring-admin/30",
  },
};

/** Role badge styling — adapts the sidebar accent per role tier. */
const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  STAFF:       { bg: "bg-amber-500/20", text: "text-amber-300", label: "Staff" },
  MANAGER:     { bg: "bg-amber-500/20", text: "text-amber-300", label: "Manager" },
  ADMIN:       { bg: "bg-red-500/20",   text: "text-red-300",   label: "Admin" },
  SUPER_ADMIN: { bg: "bg-red-500/20",   text: "text-red-300",   label: "Super Admin" },
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email?.[0] ?? "U").toUpperCase();
}

function getHomePath(role?: string): string {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "/admin/dashboard";
  return "/staff/dashboard";
}

function getProfilePath(accent: ShellAccent): string {
  return accent === "admin" ? "/admin/profile" : "/staff/profile";
}

function SidebarNav({
  role,
  collapsed,
  accent,
}: {
  role: UserRole | undefined;
  collapsed: boolean;
  accent: ShellAccent;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      {SECTIONS_ORDER.map((section) => {
        const items = BACK_OFFICE_NAV.filter(
          (i) => i.section === section && canAccess(i, role),
        );
        if (items.length === 0) return null;

        return (
          <div key={section}>
            {!collapsed && (
              <h3 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {SECTION_META[section].label}
              </h3>
            )}
            {collapsed && (
              <Separator className="mb-3 mx-auto w-6 bg-slate-700" />
            )}
            <ul className="space-y-1">
              {items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/") ||
                  (item.href === "/staff/calendar" && pathname.startsWith("/staff/bookings")) ||
                  (item.href === "/admin/finance" &&
                    (pathname === "/admin/pricing" ||
                      pathname.startsWith("/admin/pricing/") ||
                      pathname === "/admin/webhooks" ||
                      pathname.startsWith("/admin/webhooks/")));
                const Icon = item.icon;

                const link = (
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-white/10 text-white shadow-sm"
                        : "text-slate-300 hover:bg-white/5 hover:text-white",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        active
                          ? ACCENT[accent].activeIcon
                          : "text-slate-400 group-hover:text-slate-200",
                      )}
                    />
                    {!collapsed && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </Link>
                );

                if (collapsed) {
                  return (
                    <li key={item.href}>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="bg-slate-800 text-white border-slate-700"
                        >
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                }

                return <li key={item.href}>{link}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarContent({
  user,
  collapsed,
  onToggle,
  onSignOut,
  accent,
}: {
  user: BackOfficeUser;
  collapsed: boolean;
  onToggle: () => void;
  onSignOut: () => void;
  accent: ShellAccent;
}) {
  const initials = getInitials(user.name, user.email);
  const homePath = getHomePath(user.role);
  const badge = ROLE_BADGE[user.role ?? "STAFF"] ?? { bg: "bg-slate-500/20", text: "text-slate-300", label: "Staff" };
  const accentStyle = ACCENT[accent];
  const branding = useBranding();
  const wideLogoSrc = branding.logoWideUrl ?? "/brand/xpert-logo-white.png";
  const squareLogoSrc = branding.logoSquareUrl ?? "/brand/xpert-logo-white-square.png";

  return (
    <div className={cn("flex h-full flex-col", accentStyle.gradient)}>
      {/* Header */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-white/5",
          collapsed ? "justify-center px-2" : "justify-between px-5",
        )}
      >
        {!collapsed && (
          <Link href={homePath} className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wideLogoSrc}
              alt={branding.siteName}
              fetchPriority="high"
              className="h-8 w-auto"
            />
          </Link>
        )}
        {collapsed && (
          <Link href={homePath}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={squareLogoSrc}
              alt={branding.siteName}
              fetchPriority="high"
              className="h-8 w-8 object-contain"
            />
          </Link>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "hidden lg:flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors",
            collapsed && "mx-auto mt-2",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <SidebarNav
        role={user.role as UserRole | undefined}
        collapsed={collapsed}
        accent={accent}
      />

      {/* User footer */}
      <div className="border-t border-white/5 p-3">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                href={getProfilePath(accent)}
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="My Profile"
              >
                <Avatar className="h-8 w-8">
                  {user.avatarUrl && (
                    <AvatarImage src={user.avatarUrl} alt="" />
                  )}
                  <AvatarFallback className="bg-slate-700 text-xs text-slate-200">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Link>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="bg-slate-800 text-white border-slate-700"
            >
              {user.name ?? user.email} — My Profile
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/5 transition-colors">
                <Avatar className="h-9 w-9">
                  {user.avatarUrl && (
                    <AvatarImage src={user.avatarUrl} alt="" />
                  )}
                  <AvatarFallback className="bg-slate-700 text-xs text-slate-200">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {user.name ?? "User"}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {badge.label}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              className="w-56 mb-1"
            >
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={getProfilePath(accent)}>My Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard">
                  <User className="mr-2 h-4 w-4" />
                  Customer Portal
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export function BackOfficeShell({
  children,
  user,
  signOutAction,
  accent = "staff",
  notificationsPaused = false,
}: {
  children: React.ReactNode;
  user: BackOfficeUser;
  signOutAction: () => Promise<void>;
  accent?: ShellAccent;
  notificationsPaused?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const handleSignOut = useCallback(() => {
    signOutAction();
  }, [signOutAction]);

  // Derive page title from pathname
  const pageTitle = React.useMemo(() => {
    const matched = BACK_OFFICE_NAV.find(
      (item) =>
        pathname === item.href ||
        pathname.startsWith(item.href + "/") ||
        (item.href === "/staff/calendar" && pathname.startsWith("/staff/bookings")) ||
        (item.href === "/admin/finance" &&
          (pathname === "/admin/pricing" ||
            pathname.startsWith("/admin/pricing/") ||
            pathname === "/admin/webhooks" ||
            pathname.startsWith("/admin/webhooks/"))),
    );
    return matched?.label ?? "Dashboard";
  }, [pathname]);

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden lg:flex flex-col shrink-0 transition-all duration-300 ease-in-out",
            collapsed ? "w-[68px]" : "w-64",
          )}
        >
          <SidebarContent
            user={user}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            onSignOut={handleSignOut}
            accent={accent}
          />
        </aside>

        {/* Mobile sidebar sheet */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              user={user}
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onSignOut={handleSignOut}
              accent={accent}
            />
          </SheetContent>
        </Sheet>

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile-only top bar */}
          <div className="flex lg:hidden h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-black px-4 text-white">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-white hover:bg-white/10 hover:text-white"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </Button>
            <span className="text-lg font-semibold tracking-tight">{pageTitle}</span>
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/10 transition-colors">
                  <Avatar className="h-8 w-8">
                    {user.avatarUrl && (
                      <AvatarImage src={user.avatarUrl} alt="" />
                    )}
                    <AvatarFallback className="bg-slate-700 text-xs text-slate-200">
                      {getInitials(user.name, user.email)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={getProfilePath(accent)}>My Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">
                    <User className="mr-2 h-4 w-4" />
                    Customer Portal
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Page content */}
          <main className="relative flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-900">
            {notificationsPaused ? (
              <div className="sticky top-0 z-30 h-0">
                <div className="border-b border-amber-500/30 bg-amber-500/70 px-4 py-2.5 text-sm text-amber-950 shadow-sm backdrop-blur dark:bg-amber-900/60 dark:text-amber-100">
                  <div className="mx-auto flex max-w-6xl items-center gap-3">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
                    <span className="flex-1">
                      <span className="font-semibold">Outbound notifications are paused.</span>{" "}
                      Customers are not receiving emails, SMS or push — auth flows (magic link,
                      password reset) still work.
                    </span>
                    <Link
                      href="/admin/settings"
                      className="shrink-0 font-semibold underline-offset-2 hover:underline"
                    >
                      Unpause
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
