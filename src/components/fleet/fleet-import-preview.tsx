"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  ValidationResult,
  ValidationRow,
} from "@/lib/fleet/import-validate";

const STATUS_KEY: Record<ValidationRow["status"], "READY" | "ERROR" | "DUPLICATE"> = {
  ok: "READY",
  error: "ERROR",
  duplicate: "DUPLICATE",
};

const COLUMNS: DataTableColumn<ValidationRow>[] = [
  {
    id: "rowNumber",
    header: "Row",
    cell: (r) => r.rowNumber,
    accessor: (r) => r.rowNumber,
    sortable: true,
    width: "4rem",
    align: "right",
  },
  {
    id: "status",
    header: "Status",
    cell: (r) => <StatusBadge status={STATUS_KEY[r.status]} />,
    accessor: (r) => r.status,
    sortable: true,
    width: "7rem",
  },
  {
    id: "internalCode",
    header: "Internal code",
    cell: (r) => r.internalCode ?? <span className="text-muted-foreground">—</span>,
    accessor: (r) => r.internalCode ?? "",
    sortable: true,
    width: "10rem",
  },
  {
    id: "rego",
    header: "Rego",
    cell: (r) => r.rego ?? <span className="text-muted-foreground">—</span>,
    accessor: (r) => r.rego ?? "",
    width: "7rem",
  },
  {
    id: "issues",
    header: "Issues",
    cell: (r) =>
      r.issues.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {r.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ),
  },
];

export function FleetImportPreview({
  result,
  importing,
  onConfirm,
  onReset,
}: {
  result: ValidationResult;
  importing: boolean;
  onConfirm: () => void;
  onReset: () => void;
}) {
  if (result.topErrors.length > 0) {
    return (
      <div className="space-y-3">
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            File structure doesn't match the template
          </div>
          <ul className="list-inside list-disc space-y-0.5 pl-1 text-xs">
            {result.topErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onReset}>
            Clear
          </Button>
        </div>
      </div>
    );
  }

  const { summary } = result;
  const canImport = summary.ok > 0 && summary.error === 0 && summary.duplicate === 0 && !importing;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile status="READY" value={summary.ok} />
        <StatTile status="ERROR" value={summary.error} />
        <StatTile status="DUPLICATE" value={summary.duplicate} />
      </div>

      <DataTable
        columns={COLUMNS}
        data={result.rows}
        getRowId={(r) => `r-${r.rowNumber}`}
        empty="No data rows found."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {canImport
            ? `Ready to import ${summary.ok} vehicle${summary.ok === 1 ? "" : "s"}.`
            : summary.error + summary.duplicate > 0
              ? "Fix the flagged rows in your spreadsheet and re-upload — imports are all-or-nothing."
              : "No valid rows to import."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onReset} disabled={importing}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!canImport}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              `Import ${summary.ok} vehicle${summary.ok === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ status, value }: { status: "READY" | "ERROR" | "DUPLICATE"; value: number }) {
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <StatusBadge status={status} />
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
