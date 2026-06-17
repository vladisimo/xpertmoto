import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CustomerUsersTab } from "@/components/staff/customer-users-tab";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Users & Roles is admin-only (the underlying tRPC procedures are admin-gated).
 * The section bar already hides this tab for non-admins; guard the route too so
 * a hand-typed URL bounces back to the section root.
 */
export default async function CustomersUsersPage() {
  const session = await auth();
  if (!ADMIN_ROLES.has(session?.user?.role ?? "")) {
    redirect("/staff/customers");
  }
  return <CustomerUsersTab />;
}
