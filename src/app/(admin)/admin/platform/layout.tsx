import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SectionShell } from "@/components/layout/section-shell";

/**
 * Platform is SUPER_ADMIN only; guard the whole section here. The role check
 * runs in an async child behind Suspense so the shell stays prerenderable —
 * children only ever render after the check passes.
 */
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="platform">
      <Suspense fallback={null}>
        <PlatformGate>{children}</PlatformGate>
      </Suspense>
    </SectionShell>
  );
}

async function PlatformGate({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user?.role !== "SUPER_ADMIN") redirect("/admin/dashboard");
  return <>{children}</>;
}
