"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/**
 * Tolls tab on the staff fleet vehicle detail page.
 *
 * Tolls are stored as `Infringement` rows with `type = TOLL` (the platform
 * has no separate toll-charge model). This tab lists every toll identified
 * for the vehicle and joins each to its `INFRINGEMENT_RECOVERY` Payment so
 * the displayed status reflects whether the renter has actually paid — not
 * just the intermediate "CUSTOMER_CHARGED" lifecycle flag on the
 * Infringement. Mirrors the customer-scoped tolls tab.
 */

type PaymentSummary = {
  status: string;
  amount: number;
  processedAt: Date | null;
};

function statusFor(
  infringementStatus: string,
  payment: PaymentSummary | null,
): { status: StatusKey; label: string } {
  // Fully resolved: the recovery payment has captured.
  if (payment?.status === "SUCCEEDED" || infringementStatus === "PAID") {
    return { status: "PAID", label: "Paid" };
  }
  if (payment?.status === "FAILED") {
    return { status: "FAILED", label: "Charge failed" };
  }
  if (payment?.status === "PENDING") {
    return { status: "CUSTOMER_CHARGED", label: "Charged — pending capture" };
  }
  if (infringementStatus === "DISPUTED") {
    return { status: "DISPUTED", label: "Disputed" };
  }
  if (infringementStatus === "WRITTEN_OFF") {
    return { status: "WRITTEN_OFF", label: "Written off" };
  }
  if (infringementStatus === "NOMINATED") {
    return { status: "NOMINATED", label: "Nominated" };
  }
  // Default — toll exists but renter not yet charged.
  return { status: "RECEIVED", label: "Awaiting allocation" };
}

export function VehicleTabTolls({ vehicle }: { vehicle: { id: string } }) {
  const { data: tolls, isLoading } = trpc.fleet.vehicleTolls.useQuery({
    vehicleId: vehicle.id,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Loading tolls...
      </div>
    );
  }

  if (!tolls || tolls.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Tolls</h2>
        <div className="py-8 text-center text-muted-foreground">
          No tolls identified for this vehicle. Tolls are synced automatically
          from linked toll accounts and matched to the vehicle by plate.
        </div>
      </div>
    );
  }

  const totalUnpaid = tolls.reduce((sum, t) => {
    const paid = t.payment?.status === "SUCCEEDED";
    return paid ? sum : sum + (t.payment ? t.payment.amount : t.amount);
  }, 0);
  const totalPaid = tolls.reduce(
    (sum, t) => (t.payment?.status === "SUCCEEDED" ? sum + t.payment.amount : sum),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Tolls</h2>
        <div className="text-sm text-muted-foreground">
          <span className="tabular-nums">{formatCurrency(totalPaid)}</span> paid
          {" · "}
          <span className="tabular-nums">{formatCurrency(totalUnpaid)}</span>{" "}
          outstanding
        </div>
      </div>
      <div className="rounded-md border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr className="border-b border-primary/40 text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                Travelled
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                Toll point
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                Issuer
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                Customer
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                Booking
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                Status
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {tolls.map((t) => {
              const { status, label } = statusFor(t.status, t.payment);
              const amount = t.payment ? t.payment.amount : t.amount;
              return (
                <tr
                  key={t.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDateTime(t.offenceDate)}
                  </td>
                  <td className="px-4 py-3">
                    {t.location ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{t.issuer}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.customer ? (
                      <Link
                        href={`/staff/customers/${t.customer.id}`}
                        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >
                        {t.customer.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.booking ? (
                      <Link
                        href={`/staff/bookings/${t.booking.id}`}
                        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >
                        {t.booking.bookingReference}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} label={label} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatCurrency(amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
