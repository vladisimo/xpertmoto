import { redirect } from "next/navigation";

export default function MaintenanceIndexRedirect() {
  redirect("/staff/fleet?tab=maintenance");
}
