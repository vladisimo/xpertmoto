import { redirect } from "next/navigation";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { auth } from "@/lib/auth";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { CustomersHeaderActions } from "@/components/staff/customers-header-actions";
import { CustomersTabsBar } from "@/components/staff/customers-tabs-bar";
import {
  isCustomerTabValue,
  type CustomerTabValue,
} from "@/lib/customers/tabs";
import { CustomerCommunicationsTab } from "@/components/staff/customer-communications-tab";
import { CustomerDocumentsTab } from "@/components/staff/customer-documents-tab";
import { CustomerLoyaltyTab } from "@/components/staff/customer-loyalty-tab";
import { CustomerOverviewTab } from "@/components/staff/customer-overview-tab";
import { CustomerRiskTab } from "@/components/staff/customer-risk-tab";
import { CustomerSettingsTab } from "@/components/staff/customer-settings-tab";
import { CustomerVerificationTab } from "@/components/staff/customer-verification-tab";
import { CustomerUsersTab } from "@/components/staff/customer-users-tab";
import { CustomersClient } from "./customers-client";
import { isAdminOnlyCustomerTab } from "@/lib/customers/tabs";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/customers/filters";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

const DEFAULT_STATUS: StatusFilter = "ALL";
const DEFAULT_PAGE_SIZE = 25;

function parseTab(raw: string | undefined): CustomerTabValue {
  return isCustomerTabValue(raw) ? raw : "overview";
}

function parseStatus(value: string | undefined): StatusFilter {
  if (value && (STATUS_FILTERS as readonly string[]).includes(value)) {
    return value as StatusFilter;
  }
  return DEFAULT_STATUS;
}

function parsePageSize(value: string | undefined): number {
  const n = Number(value);
  return [25, 50, 100].includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseSort(
  value: string | undefined,
): { sortBy: "name" | "bookings" | "createdAt"; sortDir: "asc" | "desc" } {
  if (!value) return { sortBy: "createdAt", sortDir: "desc" };
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return { sortBy: "createdAt", sortDir: "desc" };
  if (!["name", "bookings", "createdAt"].includes(id)) return { sortBy: "createdAt", sortDir: "desc" };
  return { sortBy: id as "name" | "bookings" | "createdAt", sortDir: dir };
}

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // Legacy `?tab=import-export` URLs (the old standalone tab) should land
  // on the new Settings tab where Import/Export now lives.
  if (asString(sp.tab) === "import-export") {
    redirect("/staff/customers?tab=settings");
  }

  const session = await auth();
  const isAdmin = ADMIN_ROLES.has(session?.user?.role ?? "");

  const activeTab = parseTab(asString(sp.tab));

  // The Users & Roles tab wraps the admin-gated user management surface.
  // Non-admin staff can't use it, so bounce them back to the default tab.
  if (isAdminOnlyCustomerTab(activeTab) && !isAdmin) {
    redirect("/staff/customers");
  }

  // Only the Directory tab benefits from server prefetch — other tabs
  // each manage their own queries.
  let prefetched: Awaited<ReturnType<typeof getSSRHelpers>> | null = null;
  if (activeTab === "directory") {
    const status = parseStatus(asString(sp.status));
    const search = asString(sp.q) ?? "";
    const page = Math.max(1, Number(asString(sp.page)) || 1);
    const pageSize = parsePageSize(asString(sp.size));
    const { sortBy, sortDir } = parseSort(asString(sp.sort));
    const listInput = { status, search: search || undefined, page, pageSize, sortBy, sortDir };

    prefetched = await getSSRHelpers();
    await Promise.all([
      prefetched.staffCustomer.list.prefetch(listInput),
      prefetched.staffCustomer.stats.prefetch(),
    ]);
  }

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Operations"
        title="Customers"
        description="Browse, filter, and triage customers across depots."
        actions={<CustomersHeaderActions />}
      />
      <CustomersTabsBar activeTab={activeTab} isAdmin={isAdmin} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "overview" && <CustomerOverviewTab />}
        {activeTab === "directory" && prefetched && (
          <HydrationBoundary state={dehydrate(prefetched.queryClient)}>
            <CustomersClient />
          </HydrationBoundary>
        )}
        {activeTab === "verification" && <CustomerVerificationTab />}
        {activeTab === "risk" && <CustomerRiskTab />}
        {activeTab === "loyalty" && <CustomerLoyaltyTab />}
        {activeTab === "communications" && <CustomerCommunicationsTab />}
        {activeTab === "documents" && <CustomerDocumentsTab />}
        {activeTab === "settings" && <CustomerSettingsTab />}
        {activeTab === "users" && isAdmin && <CustomerUsersTab />}
      </div>
    </PageShell>
  );
}
