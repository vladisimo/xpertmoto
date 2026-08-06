import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-section";
import { PageHeader } from "@/components/layout/page-header";
import { TasksClient } from "@/components/staff/tasks/tasks-client";

// Sync page + async gate behind Suspense: the depot-scoped session read
// stays fenced so prefetch/navigation validation never sees an unfenced
// runtime read. The header text depends on depotId, so it lives in the gate.
export default function StaffTasksPage() {
  return (
    <PageShell full>
      <Suspense
        fallback={
          <div aria-busy="true" className="space-y-4">
            <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-80 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-72 animate-pulse rounded-lg bg-muted/60" />
          </div>
        }
      >
        <TasksGate />
      </Suspense>
    </PageShell>
  );
}

async function TasksGate() {
  const session = await auth();
  const depotId = session?.user?.depotId ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Priority Tasks"
        description={
          depotId
            ? "Your depot's live queue and team resolution history."
            : "Live queue and team resolution history across all depots."
        }
      />
      <TasksClient depotId={depotId} />
    </>
  );
}
