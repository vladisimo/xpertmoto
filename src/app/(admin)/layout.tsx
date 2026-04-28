import { signOut } from "@/lib/auth";
import { requireFullSession } from "@/lib/auth-step-up";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { BackOfficeShellWrapper } from "@/components/layout/back-office-shell-wrapper";
import { capturePageView } from "@/server/services/audit";
import { isNotificationsPaused } from "@/server/services/notification-gate";
import { prisma } from "@/lib/prisma";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const h = new Headers(await headers());
  const path = h.get("x-audit-path") ?? undefined;
  const session = await requireFullSession({ pathname: path });
  if (!ADMIN_ROLES.has(session.user.role)) redirect("/");

  if (path) capturePageView(prisma, h, session, path);

  // CLAUDE.md §F1: admin roles must have 2FA enrolled before touching the
  // back-office. First sign-in after accepting an invite routes through the
  // forced enrolment gate.
  const totp = await prisma.userTotp.findUnique({
    where: { userId: session.user.id },
    select: { enabled: true },
  });
  if (!totp?.enabled) redirect("/totp/enroll");

  const [me, notificationsPaused] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatarUrl: true },
    }),
    isNotificationsPaused(),
  ]);

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <BackOfficeShellWrapper
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        avatarUrl: me?.avatarUrl ?? null,
      }}
      signOutAction={handleSignOut}
      accent="admin"
      notificationsPaused={notificationsPaused}
    >
      {children}
    </BackOfficeShellWrapper>
  );
}
