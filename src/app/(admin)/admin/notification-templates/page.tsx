"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
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
  updatedAt: string;
};

export default function NotificationTemplatesPage() {
  const { data, isLoading } = trpc.communication.templateList.useQuery({ includeArchived: false });

  const rows: Row[] = (data ?? []).map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    type: t.type,
    category: t.category,
    channels: t.channels,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toString(),
  }));

  const columns: DataTableColumn<Row>[] = [
    {
      id: "name",
      header: "Template",
      sortable: true,
      accessor: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.name}</div>
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
        r.isActive ? <StatusBadge status="ACTIVE" label="Active" /> : <StatusBadge status="CANCELLED" label="Inactive" />,
    },
    {
      id: "updated",
      header: "Updated",
      width: "9rem",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.updatedAt).toLocaleDateString("en-AU")}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Notification templates"
        description="Central library of templates driving every outbound email, SMS, push, and in-app notification."
        actions={
          <Button asChild>
            <Link href="/admin/notification-templates/new">
              <Plus className="h-4 w-4" />
              New template
            </Link>
          </Button>
        }
      />

      <PageSection flush>
        <DataTable<Row>
          columns={columns}
          data={isLoading ? undefined : rows}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/admin/notification-templates/${r.id}`}
          empty="No templates yet. Create one to start using it in compose and campaigns."
        />
      </PageSection>
    </PageShell>
  );
}
