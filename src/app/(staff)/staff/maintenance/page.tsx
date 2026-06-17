import { redirect } from "next/navigation";

/** Alias for the Fleet → Maintenance tab route. */
export default function MaintenanceIndexRedirect() {
  redirect("/staff/fleet/maintenance");
}
