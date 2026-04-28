import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import {
  StaffDashboardTabsBar,
  type StaffDashboardTabValue,
} from "@/components/staff/staff-dashboard-tabs-bar";
import { StaffTodayTab } from "@/components/staff/staff-today-tab";
import { StaffOverdueTab } from "@/components/staff/staff-overdue-tab";
import { StaffFleetTab } from "@/components/staff/staff-fleet-tab";
import { StaffMistakesTab } from "@/components/staff/staff-mistakes-tab";
import { StaffTyresTab } from "@/components/staff/staff-tyres-tab";
import { StaffSupportTab } from "@/components/staff/staff-support-tab";
import {
  getCalendarMistakes,
  getTyreAlerts,
} from "@/server/queries/cached";

const VALID_TABS: readonly StaffDashboardTabValue[] = [
  "today",
  "overdue",
  "fleet",
  "mistakes",
  "tyres",
  "support",
];

function parseTab(raw: string | undefined): StaffDashboardTabValue {
  return VALID_TABS.includes(raw as StaffDashboardTabValue)
    ? (raw as StaffDashboardTabValue)
    : "today";
}

async function StaffDashboardTabsBarAsync({
  activeTab,
  depotId,
}: {
  activeTab: StaffDashboardTabValue;
  depotId?: string;
}) {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const in14 = new Date(now.getTime() + 14 * 86_400_000);

  const [overdueCount, mistakes, tyreAlerts, fleetAttentionCount] = await Promise.all([
    prisma.booking.count({
      where: {
        status: { in: ["ACTIVE", "OVERDUE", "CHECKED_OUT"] },
        returnDateTime: { lt: now },
        ...(depotId ? { returnDepotId: depotId } : {}),
      },
    }),
    getCalendarMistakes(depotId),
    getTyreAlerts(depotId),
    prisma.vehicle.count({
      where: {
        isActive: true,
        ...(depotId ? { depotId } : {}),
        OR: [
          { regoExpiry: { lt: in30 } },
          { ctpExpiry: { lt: in30 } },
          { insuranceExpiry: { lt: in30 } },
          { nextServiceDueDate: { lt: in14 } },
        ],
      },
    }),
  ]);

  return (
    <StaffDashboardTabsBar
      activeTab={activeTab}
      badges={{
        overdue: overdueCount,
        fleet: fleetAttentionCount,
        mistakes: mistakes.total,
        tyres: tyreAlerts.length,
      }}
    />
  );
}

function TabPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="min-h-[20rem] flex-1 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

export default async function StaffDashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);
  const session = await auth();
  const depotId = session?.user?.depotId ?? undefined;
  const today = new Date().toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Operations"
        title="Staff dashboard"
        description={`${depotId ? "Your depot" : "All depots"} · ${today}`}
        actions={
          <Button asChild>
            <Link href="/staff/calendar">All bookings</Link>
          </Button>
        }
      />
      <Suspense fallback={<StaffDashboardTabsBar activeTab={activeTab} badges={{}} />}>
        <StaffDashboardTabsBarAsync activeTab={activeTab} depotId={depotId} />
      </Suspense>

      <Suspense fallback={<TabPlaceholder />}>
        {activeTab === "today" && <StaffTodayTab depotId={depotId} />}
        {activeTab === "overdue" && <StaffOverdueTab depotId={depotId} />}
        {activeTab === "fleet" && <StaffFleetTab depotId={depotId} />}
        {activeTab === "mistakes" && <StaffMistakesTab depotId={depotId} />}
        {activeTab === "tyres" && <StaffTyresTab depotId={depotId} />}
        {activeTab === "support" && <StaffSupportTab />}
      </Suspense>
    </PageShell>
  );
}
