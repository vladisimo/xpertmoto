"use client";

import { useState } from "react";
import {
  Webhook,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCcw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils";

type WebhookRow = {
  id: string;
  receivedAt: Date;
  livemode: boolean;
  type: string;
  status: string;
  attempts: number;
  errorReason: string | null;
};

export default function AdminWebhookHealthPage() {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const summary = trpc.webhookHealth.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const recent = trpc.webhookHealth.recent.useQuery(
    {
      take: 100,
      status:
        statusFilter === "ALL"
          ? undefined
          : (statusFilter as "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED"),
    },
    { refetchInterval: 30_000 },
  );
  const utils = trpc.useUtils();
  const reset = trpc.webhookHealth.reset.useMutation({
    onSuccess: () => {
      utils.webhookHealth.recent.invalidate();
      utils.webhookHealth.summary.invalidate();
    },
  });

  const columns: DataTableColumn<WebhookRow>[] = [
    {
      id: "type",
      header: "Type",
      primary: true,
      cell: (r) => <span className="font-medium">{r.type}</span>,
    },
    {
      id: "received",
      header: "Received",
      secondary: true,
      cell: (r) => (
        <span className="whitespace-nowrap">
          {formatDateTime(r.receivedAt)}
          {r.livemode ? (
            <span className="ml-1 text-xs text-destructive">LIVE</span>
          ) : (
            <span className="ml-1 text-xs text-muted-foreground">test</span>
          )}
        </span>
      ),
    },
    {
      id: "eventId",
      header: "Event ID",
      mobileHidden: true,
      cell: (r) => <span className="font-mono text-xs">{r.id.slice(-14)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
    },
    {
      id: "attempts",
      header: "Attempts",
      align: "right",
      mobileHidden: true,
      cell: (r) => <span className="tabular-nums">{r.attempts}</span>,
    },
    {
      id: "error",
      header: "Error",
      cell: (r) => (
        <span className="block max-w-sm truncate text-xs text-destructive">
          {r.errorReason ?? ""}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration · Finance"
        title="Stripe webhook health"
        description="Live status of every Stripe event we've received. Stuck rows (PROCESSING > 5min) are candidates for manual intervention; the recovery job normally clears these automatically."
      />

      <FinanceTabsBar />

      <PageSection flush>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Received in last 24h"
            value={summary.data?.received24h ?? "—"}
            icon={<Webhook className="h-4 w-4" aria-hidden />}
          />
          <StatCard
            label="Processed in last 24h"
            value={summary.data?.processed ?? "—"}
            icon={<CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />}
          />
          <StatCard
            label="Failed in last 24h"
            value={summary.data?.failed ?? "—"}
            tone={summary.data?.failed && summary.data.failed > 0 ? "FAILED" : undefined}
            icon={<AlertCircle className="h-4 w-4 text-destructive" aria-hidden />}
          />
          <StatCard
            label="Stuck (PROCESSING > 5min)"
            value={summary.data?.stuck ?? "—"}
            tone={summary.data?.stuck && summary.data.stuck > 0 ? "PENDING" : undefined}
            icon={<Clock className="h-4 w-4 text-accent" aria-hidden />}
          />
        </div>
      </PageSection>

      <PageSection
        title="Recent events"
        description="Most recent 100 webhook events, most recent first."
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm text-muted-foreground">Filter by status:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="RECEIVED">Received</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="PROCESSED">Processed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DataTable<WebhookRow>
          columns={columns}
          data={recent.data as WebhookRow[] | undefined}
          isLoading={recent.isLoading}
          getRowId={(r) => r.id}
          empty="No events matching the filter."
          mobileMode="cards"
          rowActions={(row) => (
            <div className="flex items-center gap-1">
              {(row.status === "FAILED" || row.status === "PROCESSING") && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={reset.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    reset.mutate({ eventId: row.id });
                  }}
                  title="Reset to RECEIVED — then click 'Resend' in Stripe dashboard"
                  aria-label="Reset webhook"
                >
                  {reset.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              )}
              <a
                href={`https://dashboard.stripe.com/${row.livemode ? "" : "test/"}events/${row.id}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                Stripe
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          )}
        />
      </PageSection>
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  tone?: StatusKey;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          <span>{icon}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="text-lg font-semibold tabular-nums">{value}</div>
          {tone && <StatusBadge status={tone} />}
        </div>
      </CardContent>
    </Card>
  );
}
