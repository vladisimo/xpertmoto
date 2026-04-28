import { PageSection } from "@/components/layout/page-section";
import { FleetAuditCard } from "./fleet-audit-card";
import { FleetExportCard } from "./fleet-export-card";
import { FleetImportCard } from "./fleet-import-card";

export function FleetSettingsTab({
  q,
  status,
  depotId,
}: {
  q?: string;
  status?: string;
  depotId?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
      <section className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
        <header className="shrink-0 space-y-1 border-b px-6 py-4">
          <h2 className="h3">Fleet audit</h2>
          <p className="text-caption text-muted-foreground">
            Live worklist of compliance and data-quality issues. Click Fix on any row to remedy — the issue clears once the underlying data is saved.
          </p>
        </header>
        <FleetAuditCard />
      </section>

      <div className="grid min-h-0 shrink-0 flex-[1] gap-6 overflow-auto lg:grid-cols-2">
        <PageSection
          title="Export"
          description="Download the current fleet as XLSX, or an empty template pre-matched to the import format."
        >
          <FleetExportCard q={q} status={status} depotId={depotId} />
        </PageSection>
        <PageSection
          title="Import"
          description="Upload a filled-in template. We'll validate every row before anything is saved."
        >
          <FleetImportCard />
        </PageSection>
      </div>
    </div>
  );
}
