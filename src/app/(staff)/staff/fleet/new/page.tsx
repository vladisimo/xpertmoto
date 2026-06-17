import { redirect } from "next/navigation";

export default function OnboardVehicleRedirect() {
  redirect("/staff/fleet/vehicles");
}
