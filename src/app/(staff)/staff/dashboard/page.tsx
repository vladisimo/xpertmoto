import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { StaffTodayTab } from "@/components/staff/staff-today-tab";

function TabPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="min-h-[14rem] flex-1 animate-pulse rounded-lg bg-muted" />
      <div className="min-h-[12rem] flex-1 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export default async function StaffDashboard() {
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

      <Suspense fallback={<TabPlaceholder />}>
        <StaffTodayTab depotId={depotId} />
      </Suspense>
    </PageShell>
  );
}
