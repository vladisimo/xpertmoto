"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Download, Eye, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useRouter } from "next/navigation";
import { PageSection } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { expiryTone } from "./expiry";
import { VehicleDocumentUploadSheet } from "./vehicle-document-upload-sheet";
import { VehicleDocumentViewer } from "./vehicle-document-viewer";
import type { VehicleWithRelations } from "./vehicle-detail-types";

type Doc = VehicleWithRelations["documents"][number];

const TYPE_LABEL: Record<Doc["type"], string> = {
  CTP: "CTP",
  REGO_CERT: "Registration",
  INSURANCE: "Insurance",
  WARRANTY: "Warranty",
  PURCHASE_RECEIPT: "Purchase receipt",
  INFRINGEMENT: "Infringement",
  REPAIR_BILL: "Repair bill",
  PARTS_PURCHASE: "Parts",
  SERVICE_FEE: "Service",
  TYRE_REPLACEMENT: "Tyres",
  OTHER: "Other",
};

function PreviewThumb({ doc, onOpen }: { doc: Doc; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Preview ${TYPE_LABEL[doc.type]}`}
      className="group relative h-14 w-11 overflow-hidden rounded-md border bg-muted/30 hover:ring-2 hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {doc.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={doc.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <FileText className="h-5 w-5" />
        </span>
      )}
    </button>
  );
}

function StatusCell({ doc }: { doc: Doc }) {
  if (doc.deletedAt) {
    return <StatusBadge status="VOIDED" label="Deleted" />;
  }
  if (doc.expiryDate) {
    const tone = expiryTone(doc.expiryDate, 30);
    if (tone === "expired") return <StatusBadge status="EXPIRED" />;
    if (tone === "soon") return <StatusBadge status="EXPIRES_SOON" />;
    return <StatusBadge status="VALID" />;
  }
  return <span className="text-xs text-muted-foreground">{TYPE_LABEL[doc.type]}</span>;
}

function ReferenceCell({ doc }: { doc: Doc }) {
  if (doc.relatedWorkOrder) {
    return (
      <Link
        href={`/staff/fleet/maintenance/work-orders/${doc.relatedWorkOrder.id}`}
        className="text-primary hover:underline"
      >
        {doc.relatedWorkOrder.workOrderNumber}
      </Link>
    );
  }
  if (doc.relatedInfringement) {
    return (
      <span className="font-mono text-xs">{doc.relatedInfringement.referenceNumber}</span>
    );
  }
  if (doc.referenceNumber) {
    return <span className="font-mono text-xs">{doc.referenceNumber}</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

export function VehicleTabDocuments({ vehicle }: { vehicle: VehicleWithRelations }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const del = trpc.fleet.deleteVehicleDocument.useMutation();

  const rows = useMemo(() => {
    const weight = (d: Doc) => {
      if (d.deletedAt) return 4;
      if (!d.expiryDate) return 3;
      const t = expiryTone(d.expiryDate, 30);
      if (t === "expired") return 0;
      if (t === "soon") return 1;
      return 2;
    };
    return [...vehicle.documents].sort((a, b) => {
      const w = weight(a) - weight(b);
      if (w !== 0) return w;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [vehicle.documents]);

  const deletedCount = vehicle.documents.filter((d) => d.deletedAt).length;

  async function handleDelete(id: string) {
    if (!confirm("Delete this document? Linked work orders and infringements are kept.")) return;
    await del.mutateAsync({ id });
    await utils.fleet.vehicleDetail.invalidate({ id: vehicle.id });
    router.refresh();
  }

  const columns: DataTableColumn<Doc>[] = [
    {
      id: "preview",
      header: "",
      width: "4rem",
      cell: (d) => <PreviewThumb doc={d} onOpen={() => setViewing(d)} />,
    },
    {
      id: "type",
      header: "Type",
      cell: (d) => <span className="font-medium">{TYPE_LABEL[d.type]}</span>,
    },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (d) => (
        <span className="text-muted-foreground">{formatDate(d.createdAt)}</span>
      ),
    },
    {
      id: "expiry",
      header: "Expiry / issue",
      cell: (d) =>
        d.expiryDate
          ? formatDate(d.expiryDate)
          : d.issueDate
            ? formatDate(d.issueDate)
            : "—",
    },
    {
      id: "cost",
      header: "Cost",
      align: "right",
      cell: (d) => (d.cost ? formatCurrency(Number(d.cost)) : "—"),
    },
    {
      id: "reference",
      header: "Reference",
      cell: (d) => <ReferenceCell doc={d} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (d) => <StatusCell doc={d} />,
    },
  ];

  const viewerTitle = viewing ? `${TYPE_LABEL[viewing.type]} — ${formatDate(viewing.createdAt)}` : "";
  const viewerDescription = viewing
    ? [
        viewing.referenceNumber,
        viewing.expiryDate ? `Expires ${formatDate(viewing.expiryDate)}` : null,
        viewing.cost ? formatCurrency(Number(viewing.cost)) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <>
      <PageSection
        title="Documents"
        description={
          deletedCount > 0
            ? `Compliance certificates, repair bills, parts purchases, tyres, service fees, and infringement notices. ${deletedCount} deleted document${deletedCount === 1 ? "" : "s"} shown (super-admin view — files are retained).`
            : "Compliance certificates, repair bills, parts purchases, tyres, service fees, and infringement notices."
        }
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Upload document
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(d) => d.id}
          empty={
            <div className="text-center text-muted-foreground py-6">
              No documents on file. Upload one to keep the vehicle&apos;s compliance record up to date.
            </div>
          }
          rowActions={(d) => (
            <div className="flex items-center gap-1 justify-end">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Preview document"
                onClick={() => setViewing(d)}
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button asChild variant="ghost" size="sm" aria-label="Download file">
                <a href={d.fileUrl} download>
                  <Download className="h-4 w-4" />
                </a>
              </Button>
              {!d.deletedAt && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Delete document"
                  onClick={() => handleDelete(d.id)}
                  disabled={del.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        />
      </PageSection>
      <VehicleDocumentUploadSheet
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        vehicleId={vehicle.id}
      />
      <VehicleDocumentViewer
        open={Boolean(viewing)}
        onOpenChange={(open) => !open && setViewing(null)}
        fileUrl={viewing?.fileUrl ?? null}
        title={viewerTitle}
        description={viewerDescription}
      />
    </>
  );
}
