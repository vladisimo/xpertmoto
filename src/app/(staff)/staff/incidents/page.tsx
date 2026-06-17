import { redirect } from "next/navigation";

/** Alias for the Fleet → Incidents tab route. */
export default function IncidentsIndexRedirect() {
  redirect("/staff/fleet/incidents");
}
