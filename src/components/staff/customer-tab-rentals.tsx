"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function CustomerTabRentals({ customerId }: { customerId: string }) {
  const { data: bookings, isLoading } = trpc.staffCustomer.bookings.useQuery({ customerId });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading rental history...</div>;

  if (!bookings || bookings.length === 0) {
    return <div className="py-8 text-center text-muted-foreground">No rental history.</div>;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Rental History</h2>
      <div className="rounded-md border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr className="border-b border-primary/40 text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Reference</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Vehicle</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Category</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Pickup</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Return</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Days</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {bookings.map((b) => (
              <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/staff/bookings/${b.id}`} className="text-brand-green hover:underline font-medium">
                    {b.bookingReference}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {b.vehicle ? `${b.vehicle.make} ${b.vehicle.model} (${b.vehicle.rego})` : "Unallocated"}
                </td>
                <td className="px-4 py-3">{b.category.name}</td>
                <td className="px-4 py-3">{formatDateTime(b.pickupDateTime)}</td>
                <td className="px-4 py-3">{formatDateTime(b.returnDateTime)}</td>
                <td className="px-4 py-3">{b.durationDays}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={b.status as StatusKey} />
                </td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(Number(b.totalAmount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
