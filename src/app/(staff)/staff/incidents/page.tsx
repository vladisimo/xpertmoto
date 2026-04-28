import { redirect } from "next/navigation";

export default function IncidentsIndexRedirect() {
  redirect("/staff/fleet?tab=incidents");
}
