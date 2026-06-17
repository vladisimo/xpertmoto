import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SectionShell } from "@/components/layout/section-shell";

/** Platform is SUPER_ADMIN only; guard the whole section here. */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (session?.user?.role !== "SUPER_ADMIN") redirect("/admin/dashboard");

  return <SectionShell section="platform">{children}</SectionShell>;
}
