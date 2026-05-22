"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { ChevronDown, Gauge, LayoutDashboard, LogOut, Menu } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandLogo } from "@/components/shared/brand-logo";
import { CUSTOMER_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

const NAV: Array<{ href: string; label: React.ReactNode; external?: boolean }> = [
  { href: "/fleet", label: "Fleet" },
  { href: "/booking", label: "Book Now" },
  { href: "/locations", label: "Locations" },
  { href: "/pricing", label: "Pricing" },
  { href: "https://xpertmotogear.com.au/", label: "Shop", external: true },
  {
    href: "https://xpertmoto.com.au/pages/mechanic-services",
    label: "Mechanic",
    external: true,
  },
  { href: "/terms", label: "Rental T&C's" },
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "FAQ" },
];

const SCROLL_THRESHOLD = 8;

// Routes that render on a light (non-hero) background — the unscrolled header
// needs dark text to stay legible. Scrolled state is always dark with white text.
const LIGHT_BG_ROUTES = ["/booking"];

// Routes that intentionally pull a dark hero up behind the fixed header
// (via `-mt-20` on the hero section), so the unscrolled navbar can stay
// transparent with white text and remain legible against the image.
// Every other route gets the solid dark header by default — otherwise the
// white-on-transparent navbar disappears over a light page background until
// the user scrolls.
const TRANSPARENT_BG_ROUTES = ["/", "/tours"];

type HeaderUser = {
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
};

type PublicHeaderProps = {
  user: HeaderUser | null;
  signOutAction: () => Promise<void>;
};

function initialsFor(user: HeaderUser) {
  const source = (user.name ?? user.email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) {
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function PublicHeader({ user, signOutAction }: PublicHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const onBooking = pathname.startsWith("/booking");
  const lightBg = LIGHT_BG_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  // Only the routes that explicitly pull a dark hero up behind the navbar
  // get the transparent unscrolled state. Everything else is solid so the
  // navbar text stays legible against the page bg. `/booking` is also
  // always solid — the wizard shouldn't render against a transparent hero
  // overlay, and the logo + nav must stay readable as the user scrolls
  // through forms with light backgrounds underneath.
  const hasTransparentHero = TRANSPARENT_BG_ROUTES.includes(pathname);
  const forceSolid = onBooking || !hasTransparentHero;
  const solid = scrolled || forceSolid;
  const darkText = lightBg && !solid;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)] transition-colors duration-300",
        solid
          ? "border-b border-white/10 bg-black/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div
        className={cn(
          "container flex items-center justify-between gap-6 transition-colors duration-300",
          // Tighter on the wizard so the page doesn't feel top-heavy on
          // mobile — the layout below pads to match.
          onBooking ? "h-14" : "h-20",
          darkText ? "text-foreground" : "text-white",
        )}
      >
        <div className="flex items-center gap-2">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors lg:hidden",
                  darkText
                    ? "text-foreground hover:bg-foreground/10"
                    : "text-white hover:bg-white/10",
                )}
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b border-border p-6 text-left">
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 p-4">
                {NAV.map((n) => {
                  const className =
                    "rounded-md px-3 py-3 text-base font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground";
                  if (n.external) {
                    return (
                      <a
                        key={n.href}
                        href={n.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={className}
                        onClick={() => setMenuOpen(false)}
                      >
                        {n.label}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={className}
                      onClick={() => setMenuOpen(false)}
                    >
                      {n.label}
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
          <BrandLogo variant={darkText ? "default" : "inverse"} height={32} />
        </div>
        <nav className="hidden lg:flex items-center gap-7">
          {NAV.map((n) => {
            const className = cn(
              "text-sm font-medium transition-colors",
              darkText
                ? "text-foreground/80 hover:text-foreground"
                : "text-white/90 hover:text-white",
            );
            if (n.external) {
              return (
                <a
                  key={n.href}
                  href={n.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {n.label}
                </a>
              );
            }
            return (
              <Link key={n.href} href={n.href} className={className}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors",
                    darkText ? "hover:bg-foreground/10" : "hover:bg-white/10",
                  )}
                  aria-label="Account menu"
                >
                  <Avatar className="h-8 w-8">
                    {user.image && <AvatarImage src={user.image} alt="" />}
                    <AvatarFallback
                      className={cn(
                        "text-xs font-medium",
                        darkText
                          ? "bg-foreground/10 text-foreground"
                          : "bg-white/15 text-white",
                      )}
                    >
                      {initialsFor(user)}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-opacity",
                      darkText ? "text-foreground/70" : "text-white/80",
                    )}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium truncate">
                      {user.name ?? user.email}
                    </p>
                    {user.email && user.name && (
                      <p className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CUSTOMER_NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href}>
                        <Icon className="mr-2 h-4 w-4" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
                {(user.role === "STAFF" ||
                  user.role === "MANAGER" ||
                  user.role === "ADMIN" ||
                  user.role === "SUPER_ADMIN") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/staff/dashboard">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Staff portal
                      </Link>
                    </DropdownMenuItem>
                    {(user.role === "ADMIN" || user.role === "SUPER_ADMIN") && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/dashboard">
                          <Gauge className="mr-2 h-4 w-4" />
                          Admin portal
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
                  <form action={signOutAction}>
                    <button type="submit" className="flex w-full items-center">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </button>
                  </form>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={cn(
                darkText
                  ? "text-foreground hover:bg-foreground/10 hover:text-foreground"
                  : "text-white hover:bg-white/10 hover:text-white",
              )}
            >
              <Link href="/login">Sign in</Link>
            </Button>
          )}
          <Button
            asChild
            variant="cta"
            size="sm"
            className={cn(
              // Already on /booking* → hide the CTA on mobile (where it
              // sits right next to the wizard's own back chevron and is
              // confusing). Desktop keeps it for navigation back to a
              // fresh booking flow from any sub-page.
              pathname.startsWith("/booking") && "hidden md:inline-flex",
            )}
          >
            <Link href="/booking">Book Now ➔</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
