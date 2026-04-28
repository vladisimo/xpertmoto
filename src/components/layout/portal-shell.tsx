"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { CUSTOMER_NAV } from "@/lib/nav";
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
import { useBranding } from "@/components/shared/branding-provider";
import { BookingCtaText } from "@/components/booking/booking-cta";

type PortalUser = {
  name?: string | null;
  email?: string | null;
  role?: string;
  avatarUrl?: string | null;
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

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function SidebarNav({
  collapsed,
  onItemClick,
}: {
  collapsed: boolean;
  onItemClick?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {CUSTOMER_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const link = (
            <Link
              href={item.href}
              onClick={onItemClick}
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
                    ? "text-primary"
                    : "text-slate-400 group-hover:text-slate-200",
                )}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
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
    </nav>
  );
}

function SidebarContent({
  user,
  collapsed,
  onToggle,
  onSignOut,
  onItemClick,
}: {
  user: PortalUser;
  collapsed: boolean;
  onToggle: () => void;
  onSignOut: () => void;
  onItemClick?: () => void;
}) {
  const branding = useBranding();
  const wideLogoSrc = branding.logoWideUrl ?? "/brand/xpert-logo-white.png";
  const squareLogoSrc =
    branding.logoSquareUrl ?? "/brand/xpert-logo-white-square.png";
  const initials = getInitials(user.name, user.email);

  return (
    <div className="flex h-full flex-col bg-black">
      <div
        className={cn(
          "flex h-16 items-center border-b border-white/5",
          collapsed ? "justify-center px-2" : "justify-between px-5",
        )}
      >
        {!collapsed ? (
          <Link href="/" className="flex items-center gap-2.5" aria-label={`${branding.siteName} home`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wideLogoSrc}
              alt={branding.siteName}
              fetchPriority="high"
              className="h-8 w-auto"
            />
          </Link>
        ) : (
          <Link href="/" aria-label={`${branding.siteName} home`}>
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

      <SidebarNav collapsed={collapsed} onItemClick={onItemClick} />

      <div className="border-t border-white/5 p-3">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard/profile"
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="My Profile"
              >
                <Avatar className="h-8 w-8">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
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
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                  <AvatarFallback className="bg-slate-700 text-xs text-slate-200">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {user.name ?? user.email ?? ""}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {user.email}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56 mb-1">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/profile">My Profile</Link>
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
        )}
      </div>
    </div>
  );
}

function MobileBottomTabs({
  onMoreClick,
}: {
  onMoreClick: () => void;
}) {
  const pathname = usePathname();
  const primary = CUSTOMER_NAV.filter((i) => i.primary);

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex lg:hidden",
        "border-t border-white/10 bg-black",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {primary.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
              active
                ? "text-amber-400"
                : "text-slate-300 hover:text-white",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-slate-300 transition-colors hover:text-white"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}

export function PortalShell({
  children,
  user,
  signOutAction,
}: {
  children: React.ReactNode;
  user: PortalUser;
  signOutAction: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const handleSignOut = useCallback(() => {
    signOutAction();
  }, [signOutAction]);

  const pageTitle = useMemo(() => {
    const matched = CUSTOMER_NAV.find((item) => isActive(pathname, item.href));
    return matched?.label ?? "Dashboard";
  }, [pathname]);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-background">
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
          />
        </aside>

        {/* Mobile sidebar sheet (shared by hamburger + "More" tab) */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-0 border-none">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              user={user}
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onSignOut={handleSignOut}
              onItemClick={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>

        {/* Main area */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Mobile top bar */}
          <div className="flex lg:hidden h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-black px-4 sticky top-0 z-20 text-white">
            <BrandLogo variant="mark" height={32} className="shrink-0" />
            <span className="text-lg font-semibold tracking-tight truncate">
              {pageTitle}
            </span>
            <div className="flex-1" />
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="h-9 border border-white bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/booking" aria-label="New booking">
                <Plus className="h-4 w-4" />
                <span>
                  <BookingCtaText initial="Book" resume="Continue" />
                </span>
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/10 transition-colors"
                  aria-label="Account menu"
                >
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
                  <Link href="/dashboard/profile">My Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Page content — bottom padding on mobile to clear the tab bar */}
          <main className="flex-1 pb-20 lg:pb-0">{children}</main>
        </div>

        {/* Mobile bottom tab bar */}
        <MobileBottomTabs onMoreClick={() => setMobileOpen(true)} />
      </div>
    </TooltipProvider>
  );
}
