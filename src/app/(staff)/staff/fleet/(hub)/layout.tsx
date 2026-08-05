import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { FleetSectionShell } from "@/components/fleet/fleet-section-shell";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Fleet section shell for the in-page tab routes (everything except Vehicles,
 * whose list/detail/new routes live in the sibling `vehicles/` folder so they
 * don't inherit this section bar on the vehicle-detail page).
 *
 * The session read lives in an async child behind Suspense so the layout
 * itself stays prerenderable — an unfenced `auth()` here blocks instant
 * navigation for every fleet tab ("uncached data during prerendering or a
 * navigation") and trips the e2e browser guard.
 */
export default function FleetHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<FleetSectionShell isAdmin={false}>{null}</FleetSectionShell>}>
      <FleetHubWithRole>{children}</FleetHubWithRole>
    </Suspense>
  );
}

async function FleetHubWithRole({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = ADMIN_ROLES.has(session?.user?.role ?? "");
  return <FleetSectionShell isAdmin={isAdmin}>{children}</FleetSectionShell>;
}
