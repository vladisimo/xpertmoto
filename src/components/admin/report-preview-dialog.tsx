"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/admin/export-menu";
import {
  ReportFilters,
  buildExportParams,
  isFilterInvalid,
  useReportFilters,
} from "@/components/admin/report-filters";
import {
  getReportConfig,
  type AnyReportConfig,
} from "@/components/admin/report-configs";

export function ReportPreviewDialog({
  reportKey,
  onOpenChange,
}: {
  reportKey: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const config = getReportConfig(reportKey);
  const open = Boolean(config);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,1200px)] max-w-none overflow-hidden p-0 sm:max-w-none">
        {config ? <PreviewBody key={config.key} config={config} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ config, onClose }: { config: AnyReportConfig; onClose: () => void }) {
  const [filters, setFilters] = useReportFilters();
  const invalid = isFilterInvalid(filters, config.filterFields);

  const { data, isLoading } = config.useQuery(filters);
  const rows = (data ?? []) as unknown[];
  const isEmpty = !isLoading && rows.length === 0;

  const exportParams = buildExportParams(filters, config.filterFields);

  return (
    <div className="flex max-h-[90vh] flex-col">
      <DialogHeader className="border-b px-6 py-4 pr-12">
        <DialogTitle>{config.title}</DialogTitle>
        <DialogDescription>{config.description}</DialogDescription>
      </DialogHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {config.filterFields.length > 0 && (
          <ReportFilters
            fields={config.filterFields}
            idPrefix={`dlg-${config.key}`}
            filters={filters}
            onFilterChange={setFilters}
          />
        )}

        {config.statWidgets && !invalid && !isLoading && rows.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {config.statWidgets(rows)}
          </div>
        )}

        {invalid ? (
          <div className="flex h-40 items-center justify-center rounded-md border bg-card text-sm text-destructive shadow-sm">
            From date must be before To date.
          </div>
        ) : isLoading ? (
          <div className="flex h-40 items-center justify-center rounded-md border bg-card shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : isEmpty ? (
          <div className="flex h-40 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground shadow-sm">
            {config.emptyMessage ?? "No data for this period."}
          </div>
        ) : (
          <DataTable
            columns={config.columns}
            data={rows}
            getRowId={config.getRowId}
            empty={config.emptyMessage ?? "No data."}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-6 py-3">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <ExportMenu
          report={config.key}
          params={exportParams}
          disabled={invalid || isLoading || rows.length === 0}
        />
      </div>
    </div>
  );
}
