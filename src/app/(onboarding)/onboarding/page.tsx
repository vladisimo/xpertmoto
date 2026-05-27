import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { needsOnboarding } from "@/lib/onboarding-status";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

/**
 * Sanitise an arbitrary `?next=...` query value before we hand it to
 * `router.push`. Reject schemes, protocol-relative paths, and anything
 * that doesn't start with a single forward slash.
 */
function sanitiseNext(
  raw: string | string[] | undefined,
  fallback = "/dashboard",
): string {
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

/**
 * Where a fully-onboarded user lands when they hit /onboarding with nothing
 * left to do. Customers go to their portal home; back-office users (who now
 * also carry a CustomerProfile) go to the portal chooser.
 */
function onboardedHome(role: string): string {
  return role === "CUSTOMER" ? "/dashboard" : "/portal-select";
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?next=/onboarding");
  }
  // pending2fa always wins — TOTP step-up runs before onboarding.
  if (session.pending2fa === true) {
    redirect("/verify-2fa-step-up?next=/onboarding");
  }

  // Onboarding is profile-based, not role-based: anyone with a CustomerProfile
  // that still needs onboarding runs the wizard — including back-office users
  // who carry a profile so they can rent. We read the profile directly rather
  // than the session `requiresOnboarding` flag, which is never set for
  // back-office roles (it would lock them out of the back office).
  const profile = await prisma.customerProfile.findUnique({
    where: { userId: session.user.id },
    select: { onboardedAt: true, onboardingVersion: true },
  });
  if (!needsOnboarding(profile)) {
    redirect(onboardedHome(session.user.role));
  }

  const params = await searchParams;
  const role = session.user.role;
  const fallback = role === "CUSTOMER" ? "/dashboard" : "/portal-select";
  const next = sanitiseNext(params.next, fallback);

  return <OnboardingWizard next={next} />;
}
