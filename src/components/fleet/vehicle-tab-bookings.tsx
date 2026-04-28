"use client";

import Link from "next/link";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { VehicleWithRelations } from "./vehicle-detail-types";

export function VehicleTabBookings({ vehicle, totalCount }: { vehicle: VehicleWithRelations; totalCount: number }) {
  const bookings = vehicle.bookings;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Booking history</h2>
        <span className="text-sm text-muted-foreground">{totalCount} total</span>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-lg border py-8 text-center text-muted-foreground">No bookings yet.</div>
      ) : (
        <div className="rounded-md border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-primary text-primary-foreground">
              <tr className="border-b border-primary/40 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Reference</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Customer</th>
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
                  <td className="px-4 py-3">{b.customer.firstName} {b.customer.lastName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.category.name}</td>
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
      )}
    </div>
  );
}
