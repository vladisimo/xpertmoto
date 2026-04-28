"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useVehicleActions } from "./vehicle-action-sheets";
import type { VehicleWithRelations } from "./vehicle-detail-types";

export function VehicleTabMaintenance({ vehicle }: { vehicle: VehicleWithRelations }) {
  const workOrders = vehicle.workOrders;
  const schedules = vehicle.maintenanceSchedules;
  const { open } = useVehicleActions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Maintenance</h2>
        <Button size="sm" onClick={() => open("workOrder")}>+ Work order</Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Work orders</h3>
        {workOrders.length === 0 ? (
          <div className="rounded-lg border py-8 text-center text-muted-foreground">No work orders yet.</div>
        ) : (
          <div className="rounded-md border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">WO#</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Type</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Title</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Priority</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Created</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Actual cost</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {workOrders.map((w) => (
                  <tr key={w.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/staff/maintenance/${w.id}`} className="text-brand-green hover:underline font-medium">
                        {w.workOrderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{w.type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">{w.title}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={w.priority as StatusKey} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={w.status as StatusKey} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(w.createdAt)}</td>
                    <td className="px-4 py-3 text-right">{w.actualCost ? formatCurrency(Number(w.actualCost)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Schedules</h3>
        {schedules.length === 0 ? (
          <div className="rounded-lg border py-8 text-center text-muted-foreground">No scheduled maintenance.</div>
        ) : (
          <div className="rounded-md border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Type</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Interval</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Last completed</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Next due</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Active</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-3">{s.type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.intervalKm ? `${s.intervalKm.toLocaleString()} km` : ""}
                      {s.intervalKm && s.intervalDays ? " / " : ""}
                      {s.intervalDays ? `${s.intervalDays} days` : ""}
                      {!s.intervalKm && !s.intervalDays ? "—" : ""}
                    </td>
                    <td className="px-4 py-3">{s.lastCompletedDate ? formatDate(s.lastCompletedDate) : "—"}</td>
                    <td className="px-4 py-3">
                      {s.nextDueDate ? formatDate(s.nextDueDate) : s.nextDueKm ? `${s.nextDueKm.toLocaleString()} km` : "—"}
                    </td>
                    <td className="px-4 py-3">{s.isActive ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
