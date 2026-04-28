"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { PAYMENT_TYPE_LABELS_STAFF } from "@/lib/payment-labels";

const GREYED_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);

function StatTile({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "destructive";
  sub?: string;
}) {
  const toneClass = tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function CustomerTabBilling({ customerId }: { customerId: string }) {
  const { data, isLoading } = trpc.staffCustomer.billingSummary.useQuery({ customerId });

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Loading billing...</div>;
  }
  if (!data) {
    return <div className="py-8 text-center text-muted-foreground">No billing data.</div>;
  }

  const { summary, bookings, transactions } = data;
  const hasBookings = bookings.length > 0;
  const hasTransactions = transactions.length > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Billing</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Lifetime Spend" value={formatCurrency(summary.lifetimeSpend)} />
        <StatTile
          label="Outstanding"
          value={formatCurrency(summary.totalOutstanding)}
          tone={summary.totalOutstanding > 0 ? "destructive" : "default"}
        />
        <StatTile label="Active Rentals" value={summary.activeRentalCount} />
        <StatTile
          label="Overdue"
          value={summary.overdueCount}
          tone={summary.overdueCount > 0 ? "destructive" : "default"}
          sub={summary.overdueCount > 0 ? formatCurrency(summary.overdueBalance) : undefined}
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Rental Costings</h3>
        {!hasBookings ? (
          <div className="py-8 text-center text-muted-foreground">No rentals yet.</div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Reference
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Vehicle
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Pickup → Return
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Total
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Paid
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Balance
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {bookings.map((b) => {
                  const isOverdue = b.status === "OVERDUE";
                  const isGreyed = GREYED_STATUSES.has(b.status);
                  const rowClass = isOverdue
                    ? "bg-destructive/5"
                    : isGreyed
                      ? "opacity-60"
                      : "";
                  const balance = b.balanceDue;
                  return (
                    <tr
                      key={b.id}
                      className={`border-b transition-colors last:border-0 hover:bg-muted/30 ${rowClass}`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/staff/bookings/${b.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {b.bookingReference}
                        </Link>
                        {b.extensionOf && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            ↳ extension of{" "}
                            <Link
                              href={`/staff/bookings/${b.extensionOf.id}`}
                              className="hover:underline"
                            >
                              {b.extensionOf.bookingReference}
                            </Link>
                          </div>
                        )}
                        {b.extensions.length > 0 && (
                          <div className="mt-0.5">
                            <Badge variant="outline">+{b.extensions.length} extension{b.extensions.length === 1 ? "" : "s"}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {b.vehicle
                          ? `${b.vehicle.make} ${b.vehicle.model} (${b.vehicle.rego})`
                          : "Unallocated"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{formatDateTime(b.pickupDateTime)}</div>
                        <div className="text-xs">{formatDateTime(b.returnDateTime)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={b.status as StatusKey} />
                          {isOverdue && b.overdueStage > 0 && (
                            <StatusBadge
                              status="OVERDUE"
                              label={`Stage ${b.overdueStage}/4`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(b.totalAmount)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatCurrency(b.amountPaid)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right ${
                          balance > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/staff/bookings/${b.id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Transactions</h3>
        {!hasTransactions ? (
          <div className="py-8 text-center text-muted-foreground">No transactions.</div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Reference
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Type
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Method
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Booking
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {transactions.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{t.reference}</td>
                    <td className="px-4 py-3">{PAYMENT_TYPE_LABELS_STAFF[t.type] ?? t.type}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.method}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.booking?.bookingReference ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status as StatusKey} />
                    </td>
                    <td className="px-4 py-3">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(t.amount)}
                    </td>
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
