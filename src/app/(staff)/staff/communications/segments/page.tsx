"use client";

import Link from "next/link";
import { Archive, Eye, Plus } from "lucide-react";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { trpc } from "@/lib/trpc/client";

type SegmentRow = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
};

export default function SegmentsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.communication.segmentList.useQuery();
  const archive = trpc.communication.segmentArchive.useMutation({
    onSuccess: () => utils.communication.segmentList.invalidate(),
  });

  const rows: SegmentRow[] = (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    updatedAt: s.updatedAt.toString(),
  }));

  const columns: DataTableColumn<SegmentRow>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      accessor: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.name}</div>
          {r.description && (
            <div className="truncate text-xs text-muted-foreground">{r.description}</div>
          )}
        </div>
      ),
    },
    {
      id: "updatedAt",
      header: "Updated",
      width: "10rem",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.updatedAt).toLocaleDateString("en-AU")}
        </span>
      ),
    },
  ];

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Operations"
        title="Communications"
        description="Customer segments — saved audience filters you can reuse across campaigns."
        actions={
          <Button asChild>
            <Link href="/staff/communications/segments/new">
              <Plus className="h-4 w-4" />
              New segment
            </Link>
          </Button>
        }
      />

      <CommsTabs />

      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable<SegmentRow>
          columns={columns}
          data={isLoading ? undefined : rows}
          isLoading={isLoading}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/staff/communications/segments/${r.id}`}
          empty="No segments yet. Create one to start targeting campaigns."
          fillHeight
          pageSize={25}
          pageSizeOptions={[25, 50, 100]}
          paginationEmptyLabel="No segments"
          rowActions={(r) => (
            <div className="flex gap-1">
              <Button asChild size="sm" variant="ghost">
                <Link href={`/staff/communications/segments/${r.id}`}>
                  <Eye className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  archive.mutate({ id: r.id, archived: true });
                }}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        />
      </div>
    </PageShell>
  );
}
