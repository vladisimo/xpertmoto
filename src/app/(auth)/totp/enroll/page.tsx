import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BrandLogo } from "@/components/shared/brand-logo";
import { TwoFactorCard } from "@/components/customer/two-factor-card";
import { Button } from "@/components/ui/button";

/**
 * Forced two-factor enrolment gate. Staff / Manager / Admin accounts that
 * don't yet have a `UserTotp` row with `enabled = true` are redirected here
 * by the back-office layouts; they can't reach /staff or /admin until they
 * complete enrolment. CLAUDE.md §F1 requires 2FA for staff roles.
 *
 * Customers don't hit this path — their layouts don't enforce it. If one
 * lands here anyway (e.g. bookmarked), we redirect them to their dashboard.
 */
const STAFF_ROLES = new Set(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]);

function destinationForRole(role: string): string {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "/admin/dashboard";
  if (role === "STAFF" || role === "MANAGER") return "/staff/dashboard";
  return "/dashboard";
}

export default async function TotpEnrollPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!STAFF_ROLES.has(session.user.role)) {
    redirect(destinationForRole(session.user.role));
  }

  const totp = await prisma.userTotp.findUnique({
    where: { userId: session.user.id },
    select: { enabled: true },
  });
  if (totp?.enabled) redirect(destinationForRole(session.user.role));

  const destination = destinationForRole(session.user.role);

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-4">
      <div className="flex justify-center">
        <BrandLogo height={36} />
      </div>
      <div className="space-y-1 text-center">
        <h1 className="h2">Secure your account</h1>
        <p className="text-sm text-muted-foreground">
          Two-factor authentication is required for staff accounts. Set it up
          now to access the back-office.
        </p>
      </div>
      <TwoFactorCard redirectTo={destination} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Signed in as <strong className="text-foreground">{session.user.email}</strong>
        </span>
        <form action={handleSignOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
