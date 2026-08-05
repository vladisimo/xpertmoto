import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { OAUTH_PROVIDER_IDS, getEnabledOAuthProviders } from "@/lib/auth-providers";
import { auth } from "@/lib/auth";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { LoginForm } from "./login-form";
import { LoginImageCarousel } from "./login-image-carousel";

// M-11: per-page title (composed via the root template) + unique description.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your bookings, complete a hire, or access your account.",
};

/**
 * The session redirect and the OAuth SystemSetting are uncached request data;
 * they live in an async child behind Suspense so the page shell (carousel,
 * heading) stays prerenderable and navigations to /login stay instant.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  return (
    <div className="relative min-h-screen grid grid-cols-1 md:grid-cols-2">
      <Image
        src="/brand/xpert-logo-black.avif"
        alt="XPERT Moto"
        width={160}
        height={40}
        priority
        className="pointer-events-none absolute right-6 top-6 z-10 h-10 w-auto sm:right-10 sm:top-10"
        style={{ width: "auto" }}
      />

      <aside className="relative hidden overflow-hidden bg-black md:block">
        <LoginImageCarousel />
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10 md:p-12">
        {/* M-9/M-11: every page needs exactly one <h1>. The visible UI leads
         *  with the logo + form, so the page heading is screen-reader-only. */}
        <h1 className="sr-only">Sign in</h1>
        <Suspense fallback={null}>
          <LoginGate searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function LoginGate({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    const role = session.user.role;
    const isBackOffice =
      role === "STAFF" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN";
    // Dual-access back-office users (those with a customerProfile) go via
    // the portal selector so they can choose; everyone else short-circuits
    // straight to their single landing page.
    if (isBackOffice && session.hasCustomerProfile === true) redirect("/portal-select");
    if (role === "ADMIN" || role === "SUPER_ADMIN") redirect("/admin/dashboard");
    if (role === "STAFF" || role === "MANAGER") redirect("/staff/dashboard");
    const { callbackUrl } = await searchParams;
    redirect(callbackUrl ?? "/dashboard");
  }

  const enabledProviders = getEnabledOAuthProviders();
  // Mirror the SystemSetting that gates OAuth for back-office users into
  // the form. We render an inline note so back-office users don't have
  // to attempt OAuth, get bounced, then read the error.
  const oauthAllowedForBackOffice = await getSetting<boolean>(
    "auth.oauthAllowedForBackOffice",
    SETTING_DEFAULTS["auth.oauthAllowedForBackOffice"],
  );

  return (
    <LoginForm
      allProviders={[...OAUTH_PROVIDER_IDS]}
      enabledProviders={enabledProviders}
      oauthAllowedForBackOffice={oauthAllowedForBackOffice}
    />
  );
}
