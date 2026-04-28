import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import {
  PlatformTabsBar,
  type PlatformTabValue,
} from "@/components/admin/platform-tabs-bar";
import { DatabaseTab } from "@/components/admin/platform/database-tab";
import { ServerTab } from "@/components/admin/platform/server-tab";
import { StorageTab } from "@/components/admin/platform/storage-tab";
import { LlmTab } from "@/components/admin/platform/llm-tab";
import { EmailTab } from "@/components/admin/platform/email-tab";
import { SmsTab } from "@/components/admin/platform/sms-tab";
import { PaymentsTab } from "@/components/admin/platform/payments-tab";
import { ObservabilityTab } from "@/components/admin/platform/observability-tab";

const VALID_TABS: readonly PlatformTabValue[] = [
  "database",
  "server",
  "storage",
  "llm",
  "email",
  "sms",
  "payments",
  "observability",
];

function parseTab(raw: string | undefined): PlatformTabValue {
  return VALID_TABS.includes(raw as PlatformTabValue)
    ? (raw as PlatformTabValue)
    : "database";
}

function TabPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="min-h-[20rem] flex-1 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

export default async function AdminPlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "SUPER_ADMIN") redirect("/admin/dashboard");

  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Super admin"
        title="Platform"
        description="Cost-centre telemetry across database, server, storage, LLM and messaging. Numbers here drive the per-customer cost model."
        breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Platform" }]}
      />
      <PlatformTabsBar activeTab={activeTab} />

      <Suspense fallback={<TabPlaceholder />}>
        {activeTab === "database" && <DatabaseTab />}
        {activeTab === "server" && <ServerTab />}
        {activeTab === "storage" && <StorageTab />}
        {activeTab === "llm" && <LlmTab />}
        {activeTab === "email" && <EmailTab />}
        {activeTab === "sms" && <SmsTab />}
        {activeTab === "payments" && <PaymentsTab />}
        {activeTab === "observability" && <ObservabilityTab />}
      </Suspense>
    </PageShell>
  );
}
