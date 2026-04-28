"use client";

import Link from "next/link";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FleetExportCard({
  q,
  status,
  depotId,
}: {
  q?: string;
  status?: string;
  depotId?: string;
}) {
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (status) exportParams.set("status", status);
  if (depotId) exportParams.set("depotId", depotId);
  const exportUrl =
    exportParams.size > 0 ? `/api/fleet/export?${exportParams.toString()}` : "/api/fleet/export";

  const filterLabel = summariseFilters({ q, status, depotId });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Current fleet</p>
          <p className="text-xs text-muted-foreground">
            {filterLabel
              ? `Filtered: ${filterLabel}. Switch to the Vehicles tab to change filters.`
              : "All active vehicles. Apply filters on the Vehicles tab first to scope the export."}
          </p>
        </div>
        <Button asChild>
          <a href={exportUrl} download>
            <FileSpreadsheet className="h-4 w-4" />
            Download XLSX
          </a>
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Import template</p>
          <p className="text-xs text-muted-foreground">
            Empty template. Required columns are shaded red. A{" "}
            <span className="font-medium">Lookups</span> sheet lists valid category and depot names.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/api/fleet/template" prefetch={false}>
            <Download className="h-4 w-4" />
            Download template
          </Link>
        </Button>
      </div>
    </div>
  );
}

function summariseFilters({
  q,
  status,
  depotId,
}: {
  q?: string;
  status?: string;
  depotId?: string;
}): string | null {
  const parts: string[] = [];
  if (q) parts.push(`search "${q}"`);
  if (status) parts.push(`status ${status}`);
  if (depotId) parts.push("depot");
  return parts.length > 0 ? parts.join(", ") : null;
}
