"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useVehicleActions } from "./vehicle-action-sheets";
import type { VehicleWithRelations } from "./vehicle-detail-types";

export function VehicleTabIncidents({ vehicle }: { vehicle: VehicleWithRelations }) {
  const incidents = vehicle.incidents;
  const { open } = useVehicleActions();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Incidents</h2>
        <Button size="sm" onClick={() => open("incident")}>+ Incident</Button>
      </div>

      {incidents.length === 0 ? (
        <div className="rounded-lg border py-8 text-center text-muted-foreground">No incidents reported.</div>
      ) : (
        <div className="rounded-md border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-primary text-primary-foreground">
              <tr className="border-b border-primary/40 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Incident #</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Type</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Severity</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Date</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Damage cost</th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {incidents.map((i) => (
                <tr key={i.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/staff/incidents/${i.id}`} className="text-brand-green hover:underline font-medium">
                      {i.incidentNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{i.type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={i.severity as StatusKey} />
                  </td>
                  <td className="px-4 py-3">{formatDateTime(i.dateTime)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={i.status as StatusKey} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {i.actualDamageCost
                      ? formatCurrency(Number(i.actualDamageCost))
                      : i.estimatedDamageCost
                      ? `~${formatCurrency(Number(i.estimatedDamageCost))}`
                      : "—"}
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
