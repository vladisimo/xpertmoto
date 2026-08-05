import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase, ChevronRight, ShieldCheck, User } from "lucide-react";
import { requireFullSession } from "@/lib/auth-step-up";
import { getBranding } from "@/lib/branding";
import { Card, CardContent } from "@/components/ui/card";
import type { UserRole } from "@prisma/client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose portal",
};

type Tile = {
  href: string;
  label: string;
  description: string;
  Icon: typeof User;
};

function buildTiles(role: UserRole): Tile[] {
  const tiles: Tile[] = [
    {
      href: "/dashboard",
      label: "Customer Portal",
      description: "Your bookings, identity documents, and personal hires.",
      Icon: User,
    },
  ];
  if (role === "STAFF" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN") {
    tiles.push({
      href: "/staff/dashboard",
      label: "Staff Portal",
      description: "Front-desk operations, fleet, and customer service.",
      Icon: Briefcase,
    });
  }
  if (role === "ADMIN" || role === "SUPER_ADMIN") {
    tiles.push({
      href: "/admin/dashboard",
      label: "Admin Portal",
      description: "Settings, users, billing, and platform configuration.",
      Icon: ShieldCheck,
    });
  }
  return tiles;
}

/**
 * The session + branding reads are uncached request data; they live in an
 * async child behind Suspense so the route stays prerenderable and
 * navigations here stay instant.
 */
export default function PortalSelectPage() {
  return (
    <main className="relative min-h-screen bg-background">
      <Suspense fallback={null}>
        <PortalSelectContent />
      </Suspense>
    </main>
  );
}

async function PortalSelectContent() {
  const session = await requireFullSession({ pathname: "/portal-select" });
  const { role } = session.user;
  const hasCustomer = session.hasCustomerProfile === true;

  const isBackOffice =
    role === "STAFF" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN";

  if (!isBackOffice) {
    if (session.requiresOnboarding) redirect("/onboarding");
    redirect("/dashboard");
  }
  if (!hasCustomer) {
    redirect(role === "ADMIN" || role === "SUPER_ADMIN" ? "/admin/dashboard" : "/staff/dashboard");
  }

  const branding = await getBranding();
  const tiles = buildTiles(role);

  return (
    <>
      <Image
        src="/brand/xpert-logo-black.avif"
        alt={branding.siteName}
        width={160}
        height={40}
        priority
        className="pointer-events-none absolute right-6 top-6 z-10 h-10 w-auto sm:right-10 sm:top-10"
        style={{ width: "auto" }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-16 sm:px-10">
        <div className="space-y-2">
          <p className="eyebrow text-muted-foreground">Welcome back</p>
          <h1 className="h1">Where would you like to go?</h1>
          <p className="body-text text-muted-foreground">
            You have access to more than one {branding.siteName} workspace. Pick one to continue.
          </p>
        </div>

        <ul className="mt-8 space-y-3">
          {tiles.map((tile) => (
            <li key={tile.href}>
              <Link
                href={tile.href}
                className="group block rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Card className="transition-colors group-hover:border-foreground/40 group-hover:bg-accent">
                  <CardContent className="flex items-center gap-4 p-5">
                    <span
                      aria-hidden
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
                    >
                      <tile.Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="h3 leading-tight">{tile.label}</p>
                      <p className="caption text-muted-foreground">{tile.description}</p>
                    </div>
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                      aria-hidden
                    />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>

        <p className="caption mt-8 text-center text-muted-foreground">
          Signed in as {session.user.email ?? session.user.id}.{" "}
          <Link href="/api/auth/signout" className="font-medium text-foreground hover:underline">
            Sign out
          </Link>
        </p>
      </div>
    </>
  );
}
