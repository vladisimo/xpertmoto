"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import type { Debtor } from "@/server/services/admin-risk-signals";

function relativeTime(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDateTime(d);
}

export function DebtorsPanel({ debtors }: { debtors: Debtor[] }) {
  const [optimistic, setOptimistic] = React.useState<Record<string, Date>>({});
  const send = trpc.admin.sendDebtReminder.useMutation();

  async function handleSend(customerId: string) {
    try {
      const res = await send.mutateAsync({ customerId, channels: ["EMAIL", "SMS"] });
      setOptimistic((prev) => ({ ...prev, [customerId]: res.sentAt }));
    } catch {
      // TRPC error is surfaced via send.error on the row.
    }
  }

  const columns: DataTableColumn<Debtor>[] = [
    {
      id: "customer",
      header: "Customer",
      cell: (r) => (
        <Link
          href={`/admin/users/${r.customerId}`}
          className="block hover:underline"
        >
          <div className="font-medium">
            {r.firstName} {r.lastName}
          </div>
          <div className="text-xs text-muted-foreground">{r.email}</div>
        </Link>
      ),
    },
    {
      id: "booking",
      header: "Bookings",
      align: "right",
      cell: (r) => <span className="tabular-nums">{formatCurrency(r.bookingDebt)}</span>,
      accessor: (r) => r.bookingDebt,
      sortable: true,
    },
    {
      id: "infringement",
      header: "Infringements",
      align: "right",
      cell: (r) => <span className="tabular-nums">{formatCurrency(r.infringementDebt)}</span>,
      accessor: (r) => r.infringementDebt,
      sortable: true,
    },
    {
      id: "invoice",
      header: "Invoices",
      align: "right",
      cell: (r) => <span className="tabular-nums">{formatCurrency(r.invoiceDebt)}</span>,
      accessor: (r) => r.invoiceDebt,
      sortable: true,
    },
    {
      id: "total",
      header: "Total owed",
      align: "right",
      cell: (r) => (
        <span className="font-display font-semibold tabular-nums">
          {formatCurrency(r.totalOwed)}
        </span>
      ),
      accessor: (r) => r.totalOwed,
      sortable: true,
    },
    {
      id: "reminder",
      header: "Last reminder",
      cell: (r) => {
        const latest = optimistic[r.customerId] ?? r.lastReminderAt;
        return (
          <span className="text-xs text-muted-foreground">
            {relativeTime(latest)}
          </span>
        );
      },
      accessor: (r) => optimistic[r.customerId] ?? r.lastReminderAt ?? new Date(0),
      sortable: true,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={debtors}
      getRowId={(r) => r.customerId}
      empty={
        <div className="py-6 text-center text-sm">No customers currently owe money.</div>
      }
      rowActions={(r) => {
        const justSent = !!optimistic[r.customerId];
        const pending = send.isPending && send.variables?.customerId === r.customerId;
        return (
          <Button
            size="sm"
            variant={justSent ? "secondary" : "default"}
            disabled={pending || justSent}
            onClick={() => handleSend(r.customerId)}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> Sending
              </>
            ) : justSent ? (
              <>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Sent
              </>
            ) : (
              <>
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> Send reminder
              </>
            )}
          </Button>
        );
      }}
    />
  );
}
