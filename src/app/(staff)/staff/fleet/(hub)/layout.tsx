import { auth } from "@/lib/auth";
import { FleetSectionShell } from "@/components/fleet/fleet-section-shell";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Fleet section shell for the in-page tab routes (everything except Vehicles,
 * whose list/detail/new routes live in the sibling `vehicles/` folder so they
 * don't inherit this section bar on the vehicle-detail page).
 */
export default async function FleetHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = ADMIN_ROLES.has(session?.user?.role ?? "");
  return <FleetSectionShell isAdmin={isAdmin}>{children}</FleetSectionShell>;
}
