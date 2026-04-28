import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ImpersonationBanner } from "./impersonation-banner";

/**
 * Server component. Renders the impersonation banner only when the
 * current session has `impersonatorId` set (i.e. the user signed in
 * through the impersonation Credentials provider). No-ops on every
 * other request — zero overhead for normal traffic.
 */
export async function ImpersonationBannerGate() {
  const session = await auth();
  if (!session?.impersonatorId) return null;
  const targetUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, email: true },
  });
  const displayName = targetUser
    ? `${targetUser.firstName} ${targetUser.lastName}`.trim() || targetUser.email
    : session.user.email ?? "customer";
  return <ImpersonationBanner displayName={displayName} />;
}
