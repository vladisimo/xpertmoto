import { redirect } from "next/navigation";

/** Alias for the Fleet → Tolls tab route. */
export default function TollsIndexRedirect() {
  redirect("/staff/fleet/tolls");
}
