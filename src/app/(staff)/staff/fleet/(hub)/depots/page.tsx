import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FleetDepotsTab } from "@/components/fleet/fleet-depots-tab";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

/** Depots wraps the admin-gated depot management surface. */
export default async function FleetDepotsPage() {
  const session = await auth();
  if (!ADMIN_ROLES.has(session?.user?.role ?? "")) {
    redirect("/staff/fleet");
  }
  return <FleetDepotsTab />;
}
