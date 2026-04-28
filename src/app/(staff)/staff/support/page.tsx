"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupportStats } from "@/components/staff/support-stats";
import { AdminSupportStats } from "@/components/admin/admin-support-stats";
import { formatDistanceToNow } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Ticket = {
  id: string;
  ticketNumber: string;
  category: "ABANDONED_VEHICLE" | "BREAKDOWN" | "PAYMENT" | "GENERAL";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "ASSIGNED" | "PENDING_CUSTOMER" | "RESOLVED" | "CLOSED";
  summary: string;
  createdAt: Date;
  updatedAt: Date;
  depot: { id: string; name: string } | null;
  assignee: { id: string; firstName: string; lastName: string } | null;
  customer: { id: string; firstName: string; lastName: string; email: string } | null;
  conversation: { guestName: string | null; guestEmail: string | null };
};

const TABS = ["tickets", "insights"] as const;
type TabValue = (typeof TABS)[number];

function parseTab(v: string | null): TabValue {
  return (TABS as readonly string[]).includes(v ?? "") ? (v as TabValue) : "tickets";
}

export default function StaffSupportInbox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const me = trpc.session.whoAmI.useQuery(undefined, { staleTime: 60_000 });
  const isAdmin = me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN";

  const setTab = useCallback(
    (next: TabValue) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "tickets") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `/staff/support?${qs}` : "/staff/support", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Support inbox"
        description="Tickets raised by customers via the chat widget or structured forms."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="mt-6 space-y-6 data-[state=inactive]:hidden" forceMount>
          <TicketsTab />
        </TabsContent>

        <TabsContent value="insights" className="mt-6 space-y-6 data-[state=inactive]:hidden" forceMount>
          <InsightsTab isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function TicketsTab() {
  const [statusFilter, setStatusFilter] = useState<string>("OPEN_AND_ASSIGNED");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");

  const { data, isLoading } = trpc.support.listTickets.useQuery({
    status:
      statusFilter === "ALL" || statusFilter === "OPEN_AND_ASSIGNED"
        ? undefined
        : (statusFilter as Ticket["status"]),
    category: categoryFilter === "ALL" ? undefined : (categoryFilter as Ticket["category"]),
    priority: priorityFilter === "ALL" ? undefined : (priorityFilter as Ticket["priority"]),
    take: 50,
  });

  const rows = useMemo(
    () =>
      (data?.items ?? []).filter((t) => {
        if (statusFilter === "OPEN_AND_ASSIGNED") {
          return t.status === "OPEN" || t.status === "ASSIGNED" || t.status === "PENDING_CUSTOMER";
        }
        return true;
      }),
    [data, statusFilter],
  );

  const columns: DataTableColumn<Ticket>[] = [
    {
      id: "ticketNumber",
      header: "Ticket",
      cell: (r) => (
        <span className="font-mono text-xs font-medium text-foreground">{r.ticketNumber}</span>
      ),
      width: "10rem",
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => <StatusBadge status={r.category} />,
    },
    {
      id: "priority",
      header: "Priority",
      cell: (r) => <StatusBadge status={r.priority} />,
    },
    {
      id: "summary",
      header: "Summary",
      cell: (r) => <span className="truncate">{r.summary}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (r) =>
        r.customer
          ? `${r.customer.firstName} ${r.customer.lastName}`
          : (r.conversation.guestName ?? "Guest"),
    },
    {
      id: "depot",
      header: "Depot",
      cell: (r) => r.depot?.name ?? "—",
    },
    {
      id: "assignee",
      header: "Assignee",
      cell: (r) =>
        r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName}` : "Unassigned",
    },
    {
      id: "updatedAt",
      header: "Updated",
      accessor: (r) => r.updatedAt,
      cell: (r) => formatDistanceToNow(r.updatedAt, { addSuffix: true }),
      sortable: true,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <>
      <PageSection
        title="Filters"
        actions={
          <Link
            href="/staff/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Dashboard
          </Link>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "OPEN_AND_ASSIGNED", label: "Open + assigned" },
              { value: "OPEN", label: "Open" },
              { value: "ASSIGNED", label: "Assigned" },
              { value: "PENDING_CUSTOMER", label: "Pending customer" },
              { value: "RESOLVED", label: "Resolved" },
              { value: "CLOSED", label: "Closed" },
              { value: "ALL", label: "All" },
            ]}
          />
          <FilterSelect
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "ALL", label: "All" },
              { value: "BREAKDOWN", label: "Breakdown" },
              { value: "ABANDONED_VEHICLE", label: "Abandoned vehicle" },
              { value: "PAYMENT", label: "Payment" },
              { value: "GENERAL", label: "General" },
            ]}
          />
          <FilterSelect
            label="Priority"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { value: "ALL", label: "All" },
              { value: "URGENT", label: "Urgent" },
              { value: "HIGH", label: "High" },
              { value: "NORMAL", label: "Normal" },
              { value: "LOW", label: "Low" },
            ]}
          />
        </div>
      </PageSection>

      <PageSection flush>
        <DataTable<Ticket>
          columns={columns}
          data={rows as Ticket[]}
          isLoading={isLoading}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/staff/support/${r.id}`}
          empty="No tickets match your filters."
        />
      </PageSection>
    </>
  );
}

function InsightsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data: stats, isLoading: statsLoading } = trpc.support.stats.useQuery(undefined, {
    staleTime: 30_000,
  });

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { from, to };
  }, []);
  const adminStats = trpc.support.adminStats.useQuery(range, {
    staleTime: 30_000,
    enabled: isAdmin,
  });

  return (
    <>
      <SupportStats data={stats} loading={statsLoading} />
      {isAdmin && (
        <AdminSupportStats data={adminStats.data} loading={adminStats.isLoading} />
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
