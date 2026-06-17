import { redirect } from "next/navigation";

/** Alias for the Fleet → Inspections tab route. */
export default function InspectionsIndexRedirect() {
  redirect("/staff/fleet/inspections");
}
