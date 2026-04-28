"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";

type Props = {
  bookingId: string;
};

/**
 * Swap history for a booking — surfaces vehicle changes, the paired
 * inspections, and any linked work order / incident / payment.
 * Shown under the booking detail's Activity tab.
 */
export function BookingSwapHistory({ bookingId }: Props) {
  const { data, isLoading } = trpc.bookingSwap.listForBooking.useQuery({ bookingId });

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vehicle swaps ({data.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data.map((s) => (
          <div
            key={s.id}
            className="rounded-md border px-3 py-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">
                  {s.outgoingVehicle.internalCode} → {s.incomingVehicle?.internalCode ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(s.swappedAt)} ·{" "}
                  {s.swappedBy.firstName} {s.swappedBy.lastName} ·{" "}
                  {s.reason.replace(/_/g, " ").toLowerCase()}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {s.workOrder && (
                <span>
                  Work order{" "}
                  <Link
                    href={`/staff/maintenance/${s.workOrder.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {s.workOrder.workOrderNumber}
                  </Link>
                </span>
              )}
              {s.incident && (
                <span>
                  Incident{" "}
                  <Link
                    href={`/staff/incidents/${s.incident.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {s.incident.incidentNumber}
                  </Link>
                </span>
              )}
              {s.payment && (
                <span>
                  {s.payment.type.replace(/_/g, " ")}: A$
                  {Number(s.payment.amount).toFixed(2)} ({s.payment.status.toLowerCase()})
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
