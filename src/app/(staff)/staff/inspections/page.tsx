import { redirect } from "next/navigation";

export default function InspectionsIndexRedirect() {
  redirect("/staff/fleet?tab=inspections");
}
