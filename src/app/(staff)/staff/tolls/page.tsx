import { redirect } from "next/navigation";

export default function TollsIndexRedirect() {
  redirect("/staff/fleet?tab=tolls");
}
