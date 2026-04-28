import { auth } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-section";
import { PageHeader } from "@/components/layout/page-header";
import { TasksClient } from "@/components/staff/tasks/tasks-client";

export default async function StaffTasksPage() {
  const session = await auth();
  const depotId = session?.user?.depotId ?? null;

  return (
    <PageShell full>
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
    </PageShell>
  );
}
