"use client";

import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";
import { useVehicleActions } from "./vehicle-action-sheets";
import type { VehicleWithRelations } from "./vehicle-detail-types";

export function VehicleTabInspections({ vehicle }: { vehicle: VehicleWithRelations }) {
  const inspections = vehicle.inspections;
  const { open } = useVehicleActions();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Inspections</h2>
        <Button size="sm" onClick={() => open("inspection")}>+ Inspection</Button>
      </div>

      {inspections.length === 0 ? (
        <div className="rounded-lg border py-8 text-center text-muted-foreground">No inspections yet.</div>
      ) : (
        <div className="rounded-md border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-primary text-primary-foreground">
              <tr className="border-b border-primary/40 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Type</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Date</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Odometer</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Fuel</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Condition</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {inspections.map((i) => (
                <tr key={i.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">{i.type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(i.dateTime)}</td>
                  <td className="px-4 py-3">{i.odometerKm.toLocaleString()} km</td>
                  <td className="px-4 py-3">{i.fuelLevel}%</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={i.overallCondition as StatusKey} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={i.status as StatusKey} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
