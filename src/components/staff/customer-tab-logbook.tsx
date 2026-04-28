"use client";

import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  PRE_HIRE: "Pre-Hire",
  POST_HIRE: "Post-Hire",
  ROUTINE: "Routine",
  INCIDENT: "Incident",
};

export function CustomerTabLogbook({ customerId }: { customerId: string }) {
  const { data: inspections, isLoading } = trpc.staffCustomer.inspections.useQuery({ customerId });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading logbook...</div>;

  if (!inspections || inspections.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Logbook</h2>
        <div className="py-8 text-center text-muted-foreground">No inspection records found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Logbook</h2>
      <p className="text-sm text-muted-foreground">Inspection and condition reports from this customer's bookings.</p>
      <div className="rounded-md border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr className="border-b border-primary/40 text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Date</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Type</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Vehicle</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Booking</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Inspector</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Odometer</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Fuel</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Condition</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {inspections.map((ins) => (
              <tr key={ins.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">{formatDateTime(ins.dateTime)}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{TYPE_LABELS[ins.type] ?? ins.type}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {ins.vehicle.internalCode} ({ins.vehicle.rego})
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {ins.booking?.bookingReference ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {ins.inspector ? `${ins.inspector.firstName} ${ins.inspector.lastName}` : "—"}
                </td>
                <td className="px-4 py-3">{ins.odometerKm?.toLocaleString() ?? "—"} km</td>
                <td className="px-4 py-3">{ins.fuelLevel != null ? `${ins.fuelLevel}%` : "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={ins.overallCondition as StatusKey} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={ins.status as StatusKey} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
