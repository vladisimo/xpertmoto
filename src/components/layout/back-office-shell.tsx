"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { GlobalSearch } from "@/components/layout/global-search";
import { BackOfficeRoleProvider } from "@/components/layout/back-office-role";

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

/** Sidebar width bounds (px) for drag-to-resize, plus persistence keys. */
const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 384;
const SIDEBAR_DEFAULT_WIDTH = 256; // matches the previous w-64
const SIDEBAR_COLLAPSED_WIDTH = 68; // matches the previous w-[68px]
/** Drag the handle left of this viewport-x to snap the sidebar collapsed. */
const SIDEBAR_COLLAPSE_THRESHOLD = 150;
const SIDEBAR_WIDTH_KEY = "backoffice.sidebar.width";
const SIDEBAR_COLLAPSED_KEY = "backoffice.sidebar.collapsed";

const clampSidebarWidth = (w: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));

/**
 * Role-accent palette for the sidebar chrome. Keyed by `accent`, not role,
 * because a SUPER_ADMIN viewing `/staff/*` should see the staff accent.
 */
const ACCENT: Record<ShellAccent, {
  gradient: string;
  /** Accent hue (HSL triplet var) used to tint the misty sidebar glow. */
  glowVar: string;
  logoBg: string;
  activeIcon: string;
  chipLabel: string;
  chipClasses: string;
}> = {
  staff: {
    gradient: "bg-black",
    glowVar: "var(--staff-accent)",
    logoBg: "bg-staff text-staff-foreground",
    activeIcon: "text-staff",
    chipLabel: "Operations",
    chipClasses: "bg-staff/15 text-staff ring-1 ring-inset ring-staff/30",
  },
  admin: {
    gradient: "bg-black",
    glowVar: "var(--admin-accent)",
    logoBg: "bg-admin text-admin-foreground",
    activeIcon: "text-admin",
    chipLabel: "Admin",
    chipClasses: "bg-admin/15 text-admin ring-1 ring-inset ring-admin/30",
  },
};

/**
 * Subtle "misty wavey glow" backdrop for the sidebar. A few soft, accent-tinted
 * radial blooms layered low and blurred — reads as professional ambient depth
 * against the near-black chrome rather than a flat panel. Sits behind content
 * via a negative z-index (parent is `isolate`), and is purely decorative.
 */
function SidebarGlow({ glowVar }: { glowVar: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div
        className="absolute inset-x-[-30%] top-[-8%] h-[55%] blur-2xl opacity-50"
        style={{
          background: `radial-gradient(60% 80% at 25% 18%, hsl(${glowVar} / 0.9), transparent 68%)`,
        }}
      />
      <div
        className="absolute inset-x-[-35%] top-[32%] h-[50%] blur-2xl opacity-40"
        style={{
          background: `radial-gradient(70% 70% at 80% 50%, hsl(${glowVar} / 0.8), transparent 70%)`,
        }}
      />
      <div
        className="absolute inset-x-[-25%] bottom-[-10%] h-[50%] blur-2xl opacity-45"
        style={{
          background: `radial-gradient(65% 75% at 30% 88%, hsl(${glowVar} / 0.85), transparent 68%)`,
        }}
      />
    </div>
  );
}

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
  collapsed = false,
}: {
  user: BackOfficeUser;
  accent: ShellAccent;
  onSignOut: () => void;
  /** `bar` = inside the dark mobile top bar. `floating` = standalone button
   *  on the light page surface (desktop top-right corner). `sidebar` = footer
   *  row anchored at the bottom of the dark side nav. */
  variant?: "bar" | "floating" | "sidebar";
  /** Sidebar variant only — render avatar-only when the rail is collapsed. */
  collapsed?: boolean;
}) {
  const initials = getInitials(user.name, user.email);
  const avatar = (
    <Avatar className="h-8 w-8">
      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
      <AvatarFallback className="bg-slate-700 text-xs text-slate-200">
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  let trigger: React.ReactNode;
  if (variant === "sidebar") {
    trigger = (
      <button
        aria-label="Account menu"
        className={cn(
          "flex items-center rounded-md text-left text-slate-300 transition-colors hover:bg-white/10 hover:text-white",
          collapsed ? "h-9 w-9 justify-center" : "w-full gap-2.5 px-2 py-1.5",
        )}
      >
        {avatar}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {user.name}
            </p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
        )}
      </button>
    );
  } else {
    trigger = (
      <button
        aria-label="Account menu"
        className={cn(
          "flex items-center gap-2 rounded-full p-1 transition-colors",
          variant === "bar"
            ? "hover:bg-white/10"
            : "bg-background shadow-sm ring-1 ring-border hover:bg-muted",
        )}
      >
        {avatar}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        className="w-56"
      >
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
                    data-primary-nav-active={active || undefined}
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
  onOpenSearch,
  onSignOut,
  accent,
}: {
  user: BackOfficeUser;
  collapsed: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
  onSignOut: () => void;
  accent: ShellAccent;
}) {
  const accentStyle = ACCENT[accent];
  const branding = useBranding();
  const wideLogoSrc = branding.logoWideUrl ?? "/brand/xpert-logo-white.png";
  const squareLogoSrc = branding.logoSquareUrl ?? "/brand/xpert-logo-white-square.png";

  return (
    <div
      className={cn(
        "relative isolate flex h-full flex-col overflow-hidden",
        accentStyle.gradient,
      )}
    >
      <SidebarGlow glowVar={accentStyle.glowVar} />
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

      {/* Collapse toggle — desktop only */}
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

      {/* Account menu — anchored at the very bottom of the rail */}
      <div
        className={cn(
          "border-t border-white/5 py-2",
          collapsed ? "flex justify-center px-2" : "px-3",
        )}
      >
        <UserMenu
          user={user}
          accent={accent}
          onSignOut={onSignOut}
          variant="sidebar"
          collapsed={collapsed}
        />
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
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  // Gate persistence writes until after we've hydrated from localStorage, so
  // the initial default doesn't clobber a stored preference on first paint.
  const [hydrated, setHydrated] = useState(false);
  const resizingRef = useRef(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  // Restore the user's saved sidebar position once, on mount. Done in an
  // effect (not a lazy initializer) to keep SSR markup and the first client
  // render identical — avoids a hydration mismatch.
  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (c !== null) setCollapsed(c === "1");
      const w = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (w !== null) {
        const n = Number.parseInt(w, 10);
        if (Number.isFinite(n)) setSidebarWidth(clampSidebarWidth(n));
      }
    } catch {
      /* localStorage unavailable (private mode / SSR) — use defaults */
    }
    setHydrated(true);
  }, []);

  // Persist position whenever it changes (post-hydration only).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* ignore write failures */
    }
  }, [collapsed, sidebarWidth, hydrated]);

  // Drag-to-resize. The sidebar's left edge is the viewport's left edge, so
  // the pointer's clientX is the desired width. Listeners live on window so
  // the drag keeps tracking even when the cursor leaves the handle.
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizingRef.current) return;
      if (e.clientX < SIDEBAR_COLLAPSE_THRESHOLD) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
        setSidebarWidth(clampSidebarWidth(e.clientX));
      }
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

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
          style={{
            width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth,
          }}
          className={cn(
            "relative hidden lg:flex flex-col shrink-0 ease-in-out",
            // Suppress the width transition while actively dragging so the
            // edge tracks the cursor 1:1 instead of lagging behind.
            !resizing && "transition-[width] duration-300",
          )}
        >
          <SidebarContent
            user={user}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            onOpenSearch={() => setSearchOpen(true)}
            onSignOut={handleSignOut}
            accent={accent}
          />
          {/* Drag-to-resize handle on the right edge. Double-click resets to
              the default width. Hidden while collapsed (use the toggle to
              expand). */}
          {!collapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={startResize}
              onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
              className="group absolute inset-y-0 right-0 z-20 w-1.5 translate-x-1/2 cursor-col-resize"
            >
              <div
                className={cn(
                  "h-full w-px translate-x-1/2 transition-colors",
                  resizing
                    ? "bg-white/40"
                    : "bg-transparent group-hover:bg-white/25",
                )}
              />
            </div>
          )}
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
              onSignOut={handleSignOut}
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
            {/* Publishes the viewer's role to nav chrome rendered by the page
                itself (the section top bar), which no layout passes it to. */}
            <BackOfficeRoleProvider role={user.role as UserRole | undefined}>
              {children}
            </BackOfficeRoleProvider>
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
