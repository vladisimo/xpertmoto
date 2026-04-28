"use client";

import { trpc } from "@/lib/trpc/client";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";

export function CustomerTabInfringements({ customerId }: { customerId: string }) {
  const { data: infringements, isLoading } = trpc.staffCustomer.infringements.useQuery({ customerId });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading infringements...</div>;

  if (!infringements || infringements.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Infringements</h2>
        <div className="py-8 text-center text-muted-foreground">No infringements found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Infringements</h2>
      <div className="rounded-md border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr className="border-b border-primary/40 text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Ref #</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Type</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Issuer</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Vehicle</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Booking</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Offence Date</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Due Date</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {infringements.map((inf) => (
              <tr key={inf.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{inf.referenceNumber}</td>
                <td className="px-4 py-3">{inf.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">{inf.issuer}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {inf.vehicle.internalCode} ({inf.vehicle.rego})
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {inf.booking?.bookingReference ?? "—"}
                </td>
                <td className="px-4 py-3">{formatDate(inf.offenceDate)}</td>
                <td className="px-4 py-3">{inf.dueDate ? formatDate(inf.dueDate) : "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={inf.status as StatusKey} />
                </td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(Number(inf.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
