import { signOut } from "@/lib/auth";
import { requireFullSession } from "@/lib/auth-step-up";
import { PortalShell } from "@/components/layout/portal-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { capturePageView } from "@/server/services/audit";
import { prisma } from "@/lib/prisma";
import { needsOnboarding } from "@/lib/onboarding-status";
import { VerifyEmailBanner } from "@/components/customer/verify-email-banner";

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
      emailVerified: true,
      customerProfile: { select: { onboardedAt: true, onboardingVersion: true } },
    },
  });

  // Onboarding gate: a user entering the customer portal without a
  // completed onboarding (no signature, no signed PDFs, or a stale joint
  // version) is routed to /onboarding before any portal page renders.
  //
  // R2-M3: gate purely on the DB profile (needsOnboarding), NOT on the JWT's
  // session.requiresOnboarding flag. The JWT flag lags a just-completed
  // onboarding — it only refreshes on the next session.update()/sign-in — so
  // trusting it here bounced freshly-onboarded users back to /onboarding in a
  // redirect loop with /dashboard. The profile we read above is the
  // authoritative, up-to-the-request source of truth. needsOnboarding(null) is
  // true, so a profile-less user (a back-office user who never carries the
  // flag, or a pre-backfill row) is still routed here, where
  // onboarding.updateProfile's upsert creates the row. protectedProcedure
  // continues to enforce the JWT flag server-side for API calls.
  if (needsOnboarding(me?.customerProfile)) {
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
        {/* R2-M4: nudge a public customer to confirm their email before they
            hit the payment-step hard gate. Back-office renters are exempt. */}
        {session.user.role === "CUSTOMER" &&
          !me?.emailVerified &&
          session.user.email && (
            <VerifyEmailBanner email={session.user.email} />
          )}
        {children}
      </div>
    </PortalShell>
  );
}
