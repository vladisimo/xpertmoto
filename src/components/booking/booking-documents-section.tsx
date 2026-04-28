"use client";

import Link from "next/link";
import { Download, FileWarning } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency, formatDate } from "@/lib/utils";

type DocKind =
  | "TAX_INVOICE"
  | "ADJUSTMENT_INCREASE"
  | "ADJUSTMENT_DECREASE"
  | "RECEIPT"
  | "AGREEMENT"
  | "ASSESSMENT"
  | "SWAP_AGREEMENT";

type DocRow = {
  id: string;
  kind: DocKind;
  title: string;
  number: string | null;
  issuedAt: Date;
  totalAud: number | null;
  pdfUrl: string | null;
  meta: Record<string, string | null>;
};

/**
 * Lists every PDF document persisted for a single booking — tax
 * invoices, adjustment notes, receipts, rental agreements, return
 * assessments, swap agreements. Reads from the booking's tRPC
 * `listDocuments` procedure; both staff and customer pages render the
 * same component with `mode` controlling which extra columns appear.
 */
export function BookingDocumentsSection({
  bookingId,
  mode,
}: {
  bookingId: string;
  mode: "staff" | "customer";
}) {
  const { data, isLoading } = trpc.booking.listDocuments.useQuery({ bookingId });

  if (isLoading) return <LoadingBlock padded="sm" />;
  const rows = (data?.documents ?? []).map((d) => ({
    ...d,
    issuedAt: new Date(d.issuedAt),
  }));

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <FileWarning className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="caption mt-2">
          No documents yet. The tax invoice will be issued automatically
          when the booking is confirmed.
        </p>
      </div>
    );
  }

  const columns: DataTableColumn<DocRow>[] = [
    {
      id: "kind",
      header: "Type",
      cell: (r) => <StatusBadge status={r.kind as StatusKey} />,
    },
    {
      id: "title",
      header: "Document",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.title}</div>
          {r.number ? (
            <div className="font-mono text-xs text-muted-foreground">{r.number}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "issuedAt",
      header: "Issued",
      accessor: (r) => r.issuedAt,
      sortable: true,
      cell: (r) => formatDate(r.issuedAt),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => {
        if (r.totalAud == null) return "—";
        const decrease = r.kind === "ADJUSTMENT_DECREASE";
        return (
          <span className={decrease ? "text-destructive" : undefined}>
            {decrease ? `(${formatCurrency(r.totalAud)})` : formatCurrency(r.totalAud)}
          </span>
        );
      },
    },
    {
      id: "download",
      header: "",
      align: "right",
      width: "9rem",
      cell: (r) =>
        r.pdfUrl ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={r.pdfUrl} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" />
              PDF
            </Link>
          </Button>
        ) : (
          <span className="caption text-muted-foreground">Pending</span>
        ),
    },
  ];

  // Staff get an extra "Reason / status" column for adjustment notes.
  if (mode === "staff") {
    columns.splice(2, 0, {
      id: "reason",
      header: "Detail",
      cell: (r) => {
        const meta = r.meta;
        const bits: string[] = [];
        if (meta.reason) bits.push(meta.reason.toLowerCase().replace(/_/g, " "));
        if (meta.status && meta.status !== "ISSUED") bits.push(meta.status.toLowerCase());
        if (meta.paymentType) bits.push(meta.paymentType.toLowerCase().replace(/_/g, " "));
        return bits.length ? (
          <span className="caption text-muted-foreground">{bits.join(" · ")}</span>
        ) : (
          <span className="caption text-muted-foreground">—</span>
        );
      },
    });
  }

  return (
    <DataTable<DocRow>
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
    />
  );
}
