import { CustomerAuditCard } from "./customer-audit-card";
import { CustomerImportExportTab } from "./customer-import-export";

/**
 * Settings tab for /staff/customers. Mirrors `fleet-settings-tab.tsx`:
 * audit card on top (flex-grow), import/export side-by-side underneath.
 */
export function CustomerSettingsTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
      <section className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
        <header className="shrink-0 space-y-1 border-b px-6 py-4">
          <h2 className="h3">Customer audit</h2>
          <p className="text-caption text-muted-foreground">
            Live worklist of compliance, identity and consent issues across active customers. Click Fix on any row to open the customer&apos;s record and remedy the issue — it clears once the underlying data is saved.
          </p>
        </header>
        <CustomerAuditCard />
      </section>

      <div className="min-h-0 shrink-0 flex-[1] overflow-auto">
        <CustomerImportExportTab />
      </div>
    </div>
  );
}
