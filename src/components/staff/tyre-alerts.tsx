"use client";

import { useState } from "react";
import { CalendarClock, CircleGauge, Disc, Route, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkOrderSheet } from "@/components/fleet/work-order-sheet";
import { formatDate } from "@/lib/utils";
import type { TyreAlert } from "@/server/services/staff-ops-signals";

const REASON_LABEL: Record<TyreAlert["reason"], string> = {
  LOW_TREAD: "Tread below 2mm",
  STALE_INSPECTION: "Inspection overdue",
  HIGH_KM_SINCE_REPLACEMENT: "High km since change",
};

export function TyreAlerts({ rows }: { rows: TyreAlert[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
        <Disc className="h-5 w-5 text-muted-foreground/60" aria-hidden />
        <p className="text-sm font-medium">All tyres within tolerance</p>
        <p className="text-xs text-muted-foreground">
          No low tread or high-km alerts right now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <TyreRow key={r.vehicleId} r={r} />
      ))}
    </div>
  );
}

function TyreRow({ r }: { r: TyreAlert }) {
  const [open, setOpen] = useState(false);
  const km = r.kmSinceLastTyreWorkOrder ?? r.currentOdometerKm;
  const tread = `${r.frontDepthMm != null ? r.frontDepthMm.toFixed(1) : "—"} / ${
    r.rearDepthMm != null ? `${r.rearDepthMm.toFixed(1)}mm` : "—"
  }`;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{r.internalCode}</div>
          <div className="truncate text-xs text-muted-foreground">
            {r.make} {r.model}
          </div>
        </div>
        <StatusBadge status="OVERDUE" label={REASON_LABEL[r.reason]} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Stat icon={CircleGauge} label="Tread F/R" value={tread} />
        <Stat
          icon={Route}
          label="Km"
          value={`${km.toLocaleString("en-AU")} km`}
        />
        <Stat
          icon={CalendarClock}
          label="Inspected"
          value={r.lastInspectedAt ? formatDate(r.lastInspectedAt) : "Never"}
        />
      </div>

      <Button
        size="sm"
        variant="secondary"
        className="mt-2.5 h-7 w-full"
        onClick={() => setOpen(true)}
      >
        <Wrench className="mr-1 h-3.5 w-3.5" aria-hidden />
        Raise work order
      </Button>

      <WorkOrderSheet
        open={open}
        onOpenChange={setOpen}
        vehicleId={r.vehicleId}
        defaultType="TYRE_REPLACEMENT"
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Disc;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">{label}: </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
}
