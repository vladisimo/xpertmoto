import { redirect } from "next/navigation";

export default function AdminBackupsRedirect() {
  redirect("/admin/platform?tab=database");
}
