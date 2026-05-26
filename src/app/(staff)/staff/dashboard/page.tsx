import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { StaffTodayTab } from "@/components/staff/staff-today-tab";

function TabPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="min-h-[20rem] flex-1 animate-pulse rounded-md bg-muted" />
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
