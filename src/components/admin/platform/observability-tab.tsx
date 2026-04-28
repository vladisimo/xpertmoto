"use client";

import { Activity, AlertTriangle, FileText, Gauge } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { CalloutCard } from "@/components/ui/callout-card";
import { LoadingBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { KpiCard } from "./kpi-card";

const METRIC_ICONS: Record<string, typeof Activity> = {
  error: AlertTriangle,
  transaction: Activity,
  replay: Gauge,
  attachment: FileText,
};

export function ObservabilityTab() {
  const q = trpc.platform.observabilityUsage.useQuery({ days: 30 });
  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        Daily Sentry quotas pulled by src/server/jobs/platform-sentry-stats.ts.
        Cost is null by default — set per-event pricing once your Sentry plan is known.
      </p>

      {d.source === "placeholder" && d.reason && (
        <CalloutCard
          tone="warning"
          title="No observability snapshots yet"
          description={d.reason}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {d.metrics.length === 0
          ? (["error", "transaction", "replay", "attachment"] as const).map((m) => (
              <KpiCard
                key={m}
                title={`${m} · ${d.days}d`}
                primary="—"
                secondary="No data"
                icon={METRIC_ICONS[m] ?? Activity}
              />
            ))
          : d.metrics.map((m) => (
              <KpiCard
                key={m.metric}
                title={`${m.metric} · ${d.days}d`}
                primary={m.quantity.toLocaleString("en-AU")}
                secondary={m.costAud > 0 ? formatCurrency(m.costAud) : undefined}
                icon={METRIC_ICONS[m.metric] ?? Activity}
              />
            ))}
      </div>

      {d.dailySeries.length > 0 && (
        <PageSection title="Daily series">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.dailySeries.map((row, i) => (
                <TableRow key={`${row.date}-${row.metric}-${i}`}>
                  <TableCell className="font-mono text-xs">{row.date}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.provider}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.metric}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.quantity.toLocaleString("en-AU")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.costAud != null ? formatCurrency(row.costAud) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PageSection>
      )}

      <div className="rounded-md border bg-muted/50 p-4 text-sm">
        <div className="mb-1 font-semibold">Next step</div>
        <p className="text-muted-foreground">{d.enableHint}</p>
      </div>
    </div>
  );
}
