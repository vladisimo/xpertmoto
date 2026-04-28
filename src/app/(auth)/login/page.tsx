import Image from "next/image";
import { redirect } from "next/navigation";
import { OAUTH_PROVIDER_IDS, getEnabledOAuthProviders } from "@/lib/auth-providers";
import { auth } from "@/lib/auth";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { LoginForm } from "./login-form";
import { LoginImageCarousel } from "./login-image-carousel";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    const role = session.user.role;
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
        <LoginForm
          allProviders={[...OAUTH_PROVIDER_IDS]}
          enabledProviders={enabledProviders}
          oauthAllowedForBackOffice={oauthAllowedForBackOffice}
        />
      </main>
    </div>
  );
}
