"use client";

import { useState } from "react";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkOrderSheet } from "@/components/fleet/work-order-sheet";
import { formatDate } from "@/lib/utils";
import type { TyreAlert } from "@/server/services/staff-ops-signals";

function TyreWorkOrderAction({ vehicleId }: { vehicleId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Wrench className="mr-1 h-3.5 w-3.5" aria-hidden />
        Work order
      </Button>
      <WorkOrderSheet
        open={open}
        onOpenChange={setOpen}
        vehicleId={vehicleId}
        defaultType="TYRE_REPLACEMENT"
      />
    </>
  );
}

const REASON_LABEL: Record<TyreAlert["reason"], string> = {
  LOW_TREAD: "Tread below 2mm",
  STALE_INSPECTION: "Inspection overdue",
  HIGH_KM_SINCE_REPLACEMENT: "High km since last change",
};

export function TyreAlerts({ rows }: { rows: TyreAlert[] }) {
  const columns: DataTableColumn<TyreAlert>[] = [
    {
      id: "vehicle",
      header: "Vehicle",
      cell: (r) => (
        <div>
          <div className="font-medium">{r.internalCode}</div>
          <div className="text-xs text-muted-foreground">
            {r.make} {r.model}
          </div>
        </div>
      ),
    },
    {
      id: "tread",
      header: "Tread (F / R)",
      cell: (r) => (
        <div className="tabular-nums">
          {r.frontDepthMm != null ? `${r.frontDepthMm.toFixed(1)}mm` : "—"} /{" "}
          {r.rearDepthMm != null ? `${r.rearDepthMm.toFixed(1)}mm` : "—"}
        </div>
      ),
    },
    {
      id: "km",
      header: "Km since last replacement",
      cell: (r) => (
        <span className="tabular-nums">
          {r.kmSinceLastTyreWorkOrder != null
            ? r.kmSinceLastTyreWorkOrder.toLocaleString("en-AU")
            : r.currentOdometerKm.toLocaleString("en-AU")}
        </span>
      ),
    },
    {
      id: "inspected",
      header: "Last inspected",
      cell: (r) =>
        r.lastInspectedAt ? (
          formatDate(r.lastInspectedAt)
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: (r) => <StatusBadge status="OVERDUE" label={REASON_LABEL[r.reason]} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.vehicleId}
      empty={<p className="py-4 text-center text-sm">All tyres are within tolerance.</p>}
      rowActions={(r) => <TyreWorkOrderAction vehicleId={r.vehicleId} />}
    />
  );
}
