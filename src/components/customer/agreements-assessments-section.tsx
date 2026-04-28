"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type DocKind = "AGREEMENT" | "ASSESSMENT";

type DocRow = {
  id: string;
  kind: DocKind;
  bookingId: string;
  bookingReference: string;
  documentNumber: string;
  signedAt: Date | null;
  href: string | null;
};

const KIND_LABEL: Record<DocKind, string> = {
  AGREEMENT: "Rental agreement",
  ASSESSMENT: "Return assessment",
};

function DocMobileCard({ row }: { row: DocRow }) {
  return (
    <div className="rounded-md border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-caption text-muted-foreground">
            {KIND_LABEL[row.kind]}
          </div>
          <div className="font-semibold truncate">{row.bookingReference}</div>
          <div className="font-mono text-xs text-muted-foreground truncate">
            {row.documentNumber}
          </div>
        </div>
        <div className="text-sm text-muted-foreground shrink-0">
          {row.signedAt ? formatDate(row.signedAt) : "Unsigned"}
        </div>
      </div>
      {row.href ? (
        <Button asChild variant="secondary" size="sm" className="w-full">
          <Link href={row.href}>
            <Download className="h-4 w-4" />
            Download PDF
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function AgreementsAndAssessmentsSection() {
  const { data: agreementsRaw, isLoading: loadingAgreements } =
    trpc.agreement.forCustomer.useQuery();
  const { data: assessmentsRaw, isLoading: loadingAssessments } =
    trpc.return.forCustomer.useQuery();

  const loading = loadingAgreements || loadingAssessments;

  const rows: DocRow[] = [
    ...(agreementsRaw ?? []).map<DocRow>((a) => ({
      id: `A-${a.id}`,
      kind: "AGREEMENT",
      bookingId: a.bookingId,
      bookingReference: a.booking.bookingReference,
      documentNumber: a.agreementNumber,
      signedAt: a.signedAt ?? null,
      href: a.pdfUrl
        ? `/api/bookings/${a.bookingId}/rental-agreement?version=${a.version}`
        : null,
    })),
    ...(assessmentsRaw ?? []).map<DocRow>((a) => ({
      id: `R-${a.id}`,
      kind: "ASSESSMENT",
      bookingId: a.bookingId,
      bookingReference: a.booking.bookingReference,
      documentNumber: a.assessmentNumber,
      signedAt: a.signedAt ?? null,
      href: a.pdfUrl ? `/api/bookings/${a.bookingId}/return-assessment` : null,
    })),
  ].sort((a, b) => {
    const ta = a.signedAt ? a.signedAt.getTime() : 0;
    const tb = b.signedAt ? b.signedAt.getTime() : 0;
    return tb - ta;
  });

  const columns: DataTableColumn<DocRow>[] = [
    {
      id: "kind",
      header: "Type",
      cell: (r) => KIND_LABEL[r.kind],
    },
    {
      id: "reference",
      header: "Booking",
      cell: (r) => <span className="font-medium">{r.bookingReference}</span>,
    },
    {
      id: "documentNumber",
      header: "Document",
      cell: (r) => <span className="font-mono text-xs">{r.documentNumber}</span>,
    },
    {
      id: "signed",
      header: "Signed",
      accessor: (r) => r.signedAt,
      sortable: true,
      cell: (r) => (r.signedAt ? formatDate(r.signedAt) : "—"),
    },
    {
      id: "download",
      header: "Download",
      align: "right",
      cell: (r) =>
        r.href ? (
          <Link className="text-primary underline" href={r.href}>
            PDF
          </Link>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <PageSection title="Booking documents" collapsible name="customer-docs" className="p-4">
      {loading ? (
        <LoadingBlock padded="sm" />
      ) : rows.length === 0 ? (
        <p className="caption">
          No rental agreements or return assessments yet.
        </p>
      ) : (
        <>
          <div className="md:hidden space-y-2">
            {rows.map((r) => (
              <DocMobileCard key={r.id} row={r} />
            ))}
          </div>
          <div className="hidden md:block">
            <DataTable<DocRow>
              columns={columns}
              data={rows}
              getRowId={(r) => r.id}
            />
          </div>
        </>
      )}
    </PageSection>
  );
}
