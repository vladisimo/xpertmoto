import Image from "next/image";
import { redirect } from "next/navigation";
import { OAUTH_PROVIDER_IDS, getEnabledOAuthProviders } from "@/lib/auth-providers";
import { auth } from "@/lib/auth";
import { LoginImageCarousel } from "../login/login-image-carousel";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) {
    const role = session.user.role;
    if (role === "ADMIN" || role === "SUPER_ADMIN") redirect("/admin/dashboard");
    if (role === "STAFF" || role === "MANAGER") redirect("/staff/dashboard");
    redirect("/dashboard");
  }

  const enabledProviders = getEnabledOAuthProviders();

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
        <RegisterForm
          allProviders={[...OAUTH_PROVIDER_IDS]}
          enabledProviders={enabledProviders}
        />
      </main>
    </div>
  );
}
