import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { StepUpForm } from "./step-up-form";

/**
 * TOTP step-up page. Reached when a user has signed in via OAuth or magic
 * link and has 2FA enrolled — the session is established but flagged
 * `pending2fa`, so every protected layout / tRPC procedure refuses to
 * serve them until they complete the step-up here.
 *
 * Server gate (in an async child behind Suspense so the route stays
 * prerenderable):
 *  - anonymous → /login
 *  - authenticated and NOT pending2fa → role-based redirect (the user
 *    landed here from the back button or stale URL)
 *  - authenticated and pending2fa → render the form
 */
export default function VerifyStepUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 sm:p-10 md:p-12">
      <Image
        src="/brand/xpert-logo-black.avif"
        alt="XPERT Moto"
        width={160}
        height={40}
        priority
        className="pointer-events-none absolute right-6 top-6 z-10 h-10 w-auto sm:right-10 sm:top-10"
        style={{ width: "auto" }}
      />
      <main className="w-full max-w-md">
        <Suspense fallback={null}>
          <StepUpGate searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function StepUpGate({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.pending2fa !== true) {
    const role = session.user.role;
    if (role === "ADMIN" || role === "SUPER_ADMIN") redirect("/admin/dashboard");
    if (role === "STAFF" || role === "MANAGER") redirect("/staff/dashboard");
    redirect("/dashboard");
  }

  const params = await searchParams;
  // Only allow same-origin paths through; ignore anything else to prevent
  // open-redirect via the next= param.
  const safeNext =
    typeof params.next === "string" && params.next.startsWith("/")
      ? params.next
      : null;

  return (
    <StepUpForm
      nextPath={safeNext}
      userRole={session.user.role}
      userEmail={session.user.email ?? null}
    />
  );
}
