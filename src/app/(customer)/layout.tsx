import { signOut } from "@/lib/auth";
import { requireFullSession } from "@/lib/auth-step-up";
import { PortalShell } from "@/components/layout/portal-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { capturePageView } from "@/server/services/audit";
import { prisma } from "@/lib/prisma";
import { needsOnboarding } from "@/lib/onboarding-status";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const h = new Headers(await headers());
  const path = h.get("x-audit-path") ?? undefined;
  const session = await requireFullSession({ pathname: path });

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      avatarUrl: true,
      firstName: true,
      lastName: true,
      customerProfile: { select: { onboardedAt: true, onboardingVersion: true } },
    },
  });

  // Onboarding gate: a user entering the customer portal without a
  // completed onboarding (no signature, no signed PDFs, or a stale joint
  // version) is routed to /onboarding before any portal page renders.
  //
  // CUSTOMER sessions carry the global requiresOnboarding flag; back-office
  // users (who now also carry a CustomerProfile so they can rent) never get
  // that flag — so this is also the enforcement point that catches a staff
  // member entering the customer portal un-onboarded. needsOnboarding(null)
  // is true, so a pre-backfill profile-less user is routed here too, where
  // onboarding.updateProfile's upsert creates the row.
  if (session.requiresOnboarding === true || needsOnboarding(me?.customerProfile)) {
    const next = path && path.startsWith("/") ? path : "/dashboard";
    redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }

  if (path) capturePageView(prisma, h, session, path);

  const displayName = me
    ? `${me.firstName} ${me.lastName}`.trim()
    : (session.user.name ?? null);

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <PortalShell
      user={{
        name: displayName,
        email: session.user.email,
        role: session.user.role,
        avatarUrl: me?.avatarUrl ?? null,
      }}
      signOutAction={handleSignOut}
    >
      <div className="contents [&_.page-header-lead]:hidden md:[&_.page-header-lead]:block">
        {children}
      </div>
    </PortalShell>
  );
}
