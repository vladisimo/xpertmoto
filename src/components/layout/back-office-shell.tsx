"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  User,
  UserCircle,
  Search,
} from "lucide-react";
import {
  BACK_OFFICE_NAV,
  canAccess,
  type BackOfficeNavItem,
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useBranding } from "@/components/shared/branding-provider";
import { GlobalSearch } from "@/components/layout/global-search";

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

function getProfilePath(accent: ShellAccent): string {
  return accent === "admin" ? "/admin/profile" : "/staff/profile";
}

/**
 * Avatar + dropdown account menu. Lives in the top bar (top-right of the
 * page) on both mobile and desktop — the desktop sidebar no longer carries a
 * user footer.
 */
function UserMenu({
  user,
  accent,
  onSignOut,
  variant = "bar",
}: {
  user: BackOfficeUser;
  accent: ShellAccent;
  onSignOut: () => void;
  /** `bar` = inside the dark mobile top bar. `floating` = standalone button
   *  on the light page surface (desktop top-right corner). */
  variant?: "bar" | "floating";
}) {
  const initials = getInitials(user.name, user.email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account menu"
          className={cn(
            "flex items-center gap-2 rounded-full p-1 transition-colors",
            variant === "bar"
              ? "hover:bg-white/10"
              : "bg-background shadow-sm ring-1 ring-border hover:bg-muted",
          )}
        >
          <Avatar className="h-8 w-8">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className="bg-slate-700 text-xs text-slate-200">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={getProfilePath(accent)}>
            <UserCircle className="mr-2 h-4 w-4" />
            My Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <User className="mr-2 h-4 w-4" />
            Customer Portal
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onSignOut}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Picks the child whose href best matches the current location. Tab children
 * (`?tab=…`) win on an exact tab match; sibling-route children win by longest
 * matching path prefix. Returns `null` when nothing matches.
 */
function activeChildHref(
  item: BackOfficeNavItem,
  pathname: string,
  currentTab: string | null,
): string | null {
  let best = -1;
  let href: string | null = null;
  for (const child of item.children ?? []) {
    const [path = child.href, query] = child.href.split("?");
    const childTab = query ? new URLSearchParams(query).get("tab") : null;
    const matchesPath = pathname === path || pathname.startsWith(path + "/");
    if (!matchesPath) continue;
    const score = childTab
      ? currentTab === childTab
        ? path.length + 1000
        : -1
      : path.length;
    if (score > best) {
      best = score;
      href = child.href;
    }
  }
  return href;
}

/**
 * A nav item whose destination page has tabs. Hovering reveals a flyout that
 * deep-links to each tab; clicking the item itself still navigates to the
 * default tab. HoverCard is hover-only, so a tap on touch follows the link.
 */
function FlyoutNavItem({
  item,
  link,
  collapsed,
  pathname,
  currentTab,
}: {
  item: BackOfficeNavItem;
  link: React.ReactNode;
  collapsed: boolean;
  pathname: string;
  currentTab: string | null;
}) {
  const activeHref = activeChildHref(item, pathname, currentTab);

  return (
    <HoverCard openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>{link}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={collapsed ? 12 : 8}
        className="w-56 max-h-[70vh] overflow-y-auto border-slate-700 bg-slate-800 p-1.5 text-white"
      >
        <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          {item.label}
        </p>
        <ul className="space-y-0.5">
          {item.children?.map((child) => {
            const childActive = child.href === activeHref;
            const ChildIcon = child.icon;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                    childActive
                      ? "bg-white/10 font-medium text-white"
                      : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <ChildIcon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      childActive ? "text-white" : "text-slate-400",
                    )}
                  />
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
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
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-2 lg:py-3 lg:space-y-3">
      {SECTIONS_ORDER.map((section) => {
        const items = BACK_OFFICE_NAV.filter(
          (i) => i.section === section && canAccess(i, role),
        );
        if (items.length === 0) return null;

        return (
          <div key={section}>
            {!collapsed && (
              <h3 className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {SECTION_META[section].label}
              </h3>
            )}
            {collapsed && (
              <Separator className="mb-3 mx-auto w-6 bg-slate-700" />
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/") ||
                  (item.href === "/staff/calendar" && pathname.startsWith("/staff/bookings")) ||
                  (item.href === "/admin/finance" &&
                    (pathname === "/admin/webhooks" ||
                      pathname.startsWith("/admin/webhooks/")));
                const Icon = item.icon;

                const link = (
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 lg:py-1.5",
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
                    {!collapsed && item.children && item.children.length > 0 && (
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-300" />
                    )}
                  </Link>
                );

                if (item.children && item.children.length > 0) {
                  return (
                    <li key={item.href}>
                      <FlyoutNavItem
                        item={item}
                        link={link}
                        collapsed={collapsed}
                        pathname={pathname}
                        currentTab={currentTab}
                      />
                    </li>
                  );
                }

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
  onOpenSearch,
  accent,
}: {
  user: BackOfficeUser;
  collapsed: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
  accent: ShellAccent;
}) {
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
          <Link href="/" className="flex items-center gap-2.5">
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
          <Link href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={squareLogoSrc}
              alt={branding.siteName}
              fetchPriority="high"
              className="h-8 w-8 object-contain"
            />
          </Link>
        )}
      </div>

      {/* Global search trigger — opens the ⌘K command palette */}
      <div className={cn("px-3 pt-3", collapsed && "px-2")}>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenSearch}
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Search (⌘K)"
              >
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="bg-slate-800 text-white border-slate-700"
            >
              Search — ⌘K
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={onOpenSearch}
            className="flex w-full items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-sm text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1">Search…</span>
            <kbd className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Nav */}
      <SidebarNav
        role={user.role as UserRole | undefined}
        collapsed={collapsed}
        accent={accent}
      />

      {/* Collapse toggle — desktop only, anchored at the very bottom */}
      <div
        className={cn(
          "hidden border-t border-white/5 p-2 lg:block",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <button
          onClick={onToggle}
          className={cn(
            "flex h-8 items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors",
            collapsed ? "w-full justify-center" : "w-full justify-end px-2 gap-1.5",
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
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  // ⌘K / Ctrl+K opens the global search palette from anywhere in the shell.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  // Close the mobile drawer on route change so tapping a nav item
  // doesn't leave the sheet open over the destination page. Done via
  // the setState-during-render pattern from the React docs ("You Might
  // Not Need an Effect") to avoid the cascading-render flagged by the
  // react-hooks/set-state-in-effect rule.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

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
            onOpenSearch={() => setSearchOpen(true)}
            accent={accent}
          />
        </aside>

        {/* Mobile sidebar sheet */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 border-r-0 p-0 bg-black">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              user={user}
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onOpenSearch={() => {
                setMobileOpen(false);
                setSearchOpen(true);
              }}
              accent={accent}
            />
          </SheetContent>
        </Sheet>

        {/* Main area */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* Mobile-only top bar. In PWA standalone on notched devices the
              status bar overlays the viewport, so we consume
              safe-area-inset-top here — otherwise the burger sits under
              the notch and there's no way to open the nav. */}
          <div className="flex lg:hidden min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-black px-4 pt-[env(safe-area-inset-top)] text-white">
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
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-white hover:bg-white/10 hover:text-white"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-5 w-5" />
              <span className="sr-only">Search</span>
            </Button>
            <UserMenu user={user} accent={accent} onSignOut={handleSignOut} />
          </div>

          {/* Desktop account menu — floats in the top-right corner of the
              page (no top bar). */}
          <div className="pointer-events-none absolute right-4 top-3 z-30 hidden lg:block">
            <div className="pointer-events-auto">
              <UserMenu
                user={user}
                accent={accent}
                onSignOut={handleSignOut}
                variant="floating"
              />
            </div>
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

        <GlobalSearch
          open={searchOpen}
          onOpenChange={setSearchOpen}
          accent={accent}
        />
      </div>
    </TooltipProvider>
  );
}
