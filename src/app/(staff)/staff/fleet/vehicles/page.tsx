import { auth } from "@/lib/auth";
import { FleetSectionShell } from "@/components/fleet/fleet-section-shell";
import { FleetVehiclesTab } from "@/components/fleet/fleet-vehicles-tab";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Vehicles tab. Lives outside the `(hub)` group (alongside `[id]` and `new`)
 * and self-wraps the Fleet section chrome so the vehicle-detail route doesn't
 * inherit the section bar.
 */
export default async function FleetVehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; depotId?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const isAdmin = ADMIN_ROLES.has(session?.user?.role ?? "");

  return (
    <FleetSectionShell isAdmin={isAdmin}>
      <FleetVehiclesTab q={sp.q} status={sp.status} depotId={sp.depotId} />
    </FleetSectionShell>
  );
}
