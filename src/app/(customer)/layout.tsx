import { signOut } from "@/lib/auth";
import { requireFullSession } from "@/lib/auth-step-up";
import { PortalShell } from "@/components/layout/portal-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { capturePageView } from "@/server/services/audit";
import { prisma } from "@/lib/prisma";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const h = new Headers(await headers());
  const path = h.get("x-audit-path") ?? undefined;
  const session = await requireFullSession({ pathname: path });

  // Onboarding gate: customers without a completed onboarding (no
  // signature, no signed PDFs, or with stale joint version) are routed
  // to /onboarding before any portal page renders. The dedicated
  // /onboarding route group is the only place a requiresOnboarding
  // session can land — see src/app/(onboarding)/layout.tsx.
  if (session.requiresOnboarding === true) {
    const next = path && path.startsWith("/") ? path : "/dashboard";
    redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }

  if (path) capturePageView(prisma, h, session, path);

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { avatarUrl: true, firstName: true, lastName: true },
  });

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
