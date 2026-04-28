"use client";

import Link from "next/link";
import { Download } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { LoadingBlock } from "@/components/ui/spinner";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";

type DocKind =
  | "TAX_INVOICE"
  | "ADJUSTMENT_INCREASE"
  | "ADJUSTMENT_DECREASE"
  | "RECEIPT";

type DocRow = {
  id: string;
  kind: DocKind;
  title: string;
  number: string;
  issuedAt: Date;
  totalAud: number;
  pdfUrl: string | null;
  bookingId: string | null;
  bookingReference: string | null;
};

/**
 * Cross-booking list of every tax invoice, adjustment note, and
 * branded payment receipt issued to the signed-in customer. Embedded
 * inside the `/dashboard/documents` page as a collapsible section.
 *
 * Each row links its booking reference back to the booking detail
 * page, so the customer can always trace from an isolated tax doc
 * back to the booking it relates to.
 */
export function TaxDocumentsSection() {
  const { data, isLoading } = trpc.customer.listAllTaxDocuments.useQuery({});
  if (isLoading) return <LoadingBlock padded="sm" />;
  const rows: DocRow[] = (data?.documents ?? []).map((d) => ({
    ...d,
    issuedAt: new Date(d.issuedAt),
  }));

  if (rows.length === 0) {
    return (
      <p className="caption">
        No tax invoices or receipts yet. They will appear here as soon as
        you complete a booking.
      </p>
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
          <div className="font-mono text-xs text-muted-foreground">{r.number}</div>
        </div>
      ),
    },
    {
      id: "booking",
      header: "Booking",
      cell: (r) =>
        r.bookingReference ? (
          <Link
            className="text-primary underline"
            href={`/dashboard/bookings/${r.bookingId}`}
          >
            {r.bookingReference}
          </Link>
        ) : (
          <span className="caption text-muted-foreground">—</span>
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
        const decrease = r.kind === "ADJUSTMENT_DECREASE";
        return (
          <span className={decrease ? "text-destructive" : undefined}>
            {decrease
              ? `(${formatCurrency(r.totalAud)})`
              : formatCurrency(r.totalAud)}
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

  return <DataTable<DocRow> columns={columns} data={rows} getRowId={(r) => r.id} />;
}
