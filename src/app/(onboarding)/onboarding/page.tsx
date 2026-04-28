import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

/**
 * Sanitise an arbitrary `?next=...` query value before we hand it to
 * `router.push`. Reject schemes, protocol-relative paths, and anything
 * that doesn't start with a single forward slash.
 */
function sanitiseNext(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function destinationForNonCustomer(role: string): string {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "/admin/dashboard";
  if (role === "STAFF" || role === "MANAGER") return "/staff/dashboard";
  return "/";
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
  // Non-customers don't go through this flow.
  if (session.user.role !== "CUSTOMER") {
    redirect(destinationForNonCustomer(session.user.role));
  }
  // Already onboarded → bounce to dashboard.
  if (session.requiresOnboarding !== true) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const next = sanitiseNext(params.next);

  return <OnboardingWizard next={next} />;
}
