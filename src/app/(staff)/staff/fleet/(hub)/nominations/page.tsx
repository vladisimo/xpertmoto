import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FleetNominationsTab } from "@/components/fleet/fleet-nominations-tab";

const MANAGER_ROLES = new Set(["MANAGER", "ADMIN", "SUPER_ADMIN"]);

/**
 * The nomination.* procedures are manager-gated, so a STAFF visit here used
 * to render the tab and immediately 403 on its queries (same class as the
 * FTF #13 campaigns finding). Bounce non-managers back to the fleet index
 * instead; the check sits behind Suspense so the route stays prerenderable.
 */
export default function FleetNominationsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <Suspense fallback={null}>
        <NominationsGate />
      </Suspense>
    </div>
  );
}

async function NominationsGate() {
  const session = await auth();
  if (!MANAGER_ROLES.has(session?.user?.role ?? "")) redirect("/staff/fleet");
  return <FleetNominationsTab />;
}
