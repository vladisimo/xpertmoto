"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";

type Row = {
  id: string;
  key: string;
  name: string;
  type: string | null;
  category: string;
  channels: string[];
  isActive: boolean;
  updatedAt: string | null;
  source: "db" | "code";
};

export default function NotificationTemplatesPage() {
  const dbQuery = trpc.communication.templateList.useQuery({ includeArchived: false });
  const codeQuery = trpc.communication.codeTemplateList.useQuery();

  const dbRows: Row[] = (dbQuery.data ?? []).map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    type: t.type,
    category: t.category,
    channels: t.channels,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toString(),
    source: "db",
  }));

  const codeRows: Row[] = (codeQuery.data ?? []).map((t) => ({
    id: `code:${t.key}`,
    key: t.key,
    name: t.name,
    type: null,
    category: t.category,
    channels: t.channels,
    isActive: true,
    updatedAt: null,
    source: "code",
  }));

  const rows: Row[] = [...dbRows, ...codeRows];
  const isLoading = dbQuery.isLoading || codeQuery.isLoading;

  const columns: DataTableColumn<Row>[] = [
    {
      id: "name",
      header: "Template",
      sortable: true,
      accessor: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{r.name}</span>
            {r.source === "code" ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Built-in
              </span>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{r.type ?? r.key}</div>
        </div>
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => <span className="text-xs">{r.category}</span>,
    },
    {
      id: "channels",
      header: "Channels",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.channels.map((c) => (
            <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {c}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) =>
        r.source === "code" ? (
          <span className="text-xs text-muted-foreground">Code — read-only</span>
        ) : r.isActive ? (
          <StatusBadge status="ACTIVE" label="Active" />
        ) : (
          <StatusBadge status="CANCELLED" label="Inactive" />
        ),
    },
    {
      id: "updated",
      header: "Updated",
      width: "9rem",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("en-AU") : "—"}
        </span>
      ),
    },
  ];

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Operations · Templates"
        title="Notification templates"
        description="Central library of templates driving every outbound email, SMS, push, and in-app notification. Built-in templates are defined in code and previewed read-only."
        actions={
          <Button asChild>
            <Link href="/staff/communications/templates/new">
              <Plus className="h-4 w-4" />
              New template
            </Link>
          </Button>
        }
      />

      <CommsTabs />

      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable<Row>
          columns={columns}
          data={isLoading ? undefined : rows}
          isLoading={isLoading}
          getRowId={(r) => r.id}
          getRowHref={(r) =>
            r.source === "code"
              ? `/staff/communications/templates/code/${r.key}`
              : `/staff/communications/templates/${r.id}`
          }
          empty="No templates yet. Create one to start using it in compose and campaigns."
          fillHeight
          pageSize={25}
          pageSizeOptions={[25, 50, 100]}
          paginationEmptyLabel="No templates"
        />
      </div>
    </PageShell>
  );
}
