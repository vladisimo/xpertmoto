"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  DollarSign,
  FileText,
  Gauge,
  Sigma,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { CalloutCard } from "@/components/ui/callout-card";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
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
import { ObservabilityTrend } from "./observability-trend";

const METRIC_ICONS: Record<string, typeof Activity> = {
  error: AlertTriangle,
  transaction: Activity,
  replay: Gauge,
  attachment: FileText,
};

function deltaLabel(deltaPct: number | null): string | undefined {
  if (deltaPct === null) return undefined;
  const arrow = deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "▬";
  return `${arrow} ${Math.abs(deltaPct).toFixed(0)}% vs prev day`;
}

export function ObservabilityTab() {
  const q = trpc.platform.observabilityUsage.useQuery({ days: 30 });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);

  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;
  const hasData = d.chartSeries.length > 0;

  // Newest day first; paginate client-side (≤90 rows, no need to round-trip).
  const rows = [...d.chartSeries].reverse();
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Fixed top block — KPIs and chart don't scroll */}
      <div className="shrink-0 space-y-6">
        <p className="text-caption text-muted-foreground">
          Daily Sentry quotas pulled by src/server/jobs/platform-sentry-stats.ts.
          {d.pricingIsEstimate
            ? " Cost is an estimate — set SENTRY_PRICE_* env to your plan's per-event rate."
            : " Cost uses your configured SENTRY_PRICE_* rates."}
        </p>

        {d.source === "placeholder" && d.reason && (
          <CalloutCard
            tone="warning"
            title="No observability snapshots yet"
            description={d.reason}
          />
        )}

        {/* Headline rollup across the window */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={`Total events · ${d.totals.daysWithData}d`}
            primary={d.totals.events.toLocaleString("en-AU")}
            secondary={hasData ? `across ${d.totals.daysWithData} days of data` : "No data"}
            icon={Sigma}
          />
          <KpiCard
            title={`Est. spend · ${d.totals.daysWithData}d`}
            primary={formatCurrency(d.totals.costAud)}
            secondary={d.pricingIsEstimate ? "estimate" : "configured rates"}
            icon={DollarSign}
          />
          <KpiCard
            title="Projected / month"
            primary={formatCurrency(d.totals.projectedMonthlyCostAud)}
            secondary="normalised to 30 days"
            icon={CalendarClock}
          />
          <KpiCard
            title="Peak day"
            primary={d.peak ? d.peak.total.toLocaleString("en-AU") : "—"}
            secondary={d.peak ? d.peak.date : "No data"}
            icon={Activity}
          />
        </div>

        {hasData && (
          <div>
            <div className="mb-2 text-sm font-medium">Events per day</div>
            <ObservabilityTrend data={d.chartSeries} height={220} />
          </div>
        )}

        {/* Per-metric breakdown with day-over-day momentum */}
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
                  secondary={[
                    m.costAud > 0 ? formatCurrency(m.costAud) : null,
                    `~${Math.round(m.avgPerDay).toLocaleString("en-AU")}/day`,
                    deltaLabel(m.deltaPct),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  icon={METRIC_ICONS[m.metric] ?? Activity}
                />
              ))}
        </div>
      </div>

      {/* Daily series — flex-1 region: header is fixed, body scrolls */}
      {hasData && (
        <div className="flex min-h-0 flex-1 flex-col rounded-md border">
          <div className="border-b px-4 py-2 text-sm font-medium">Daily series</div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10">

                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Replays</TableHead>
                  <TableHead className="text-right">Attachments</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-mono text-xs">{row.date}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.error.toLocaleString("en-AU")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.transaction.toLocaleString("en-AU")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.replay.toLocaleString("en-AU")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.attachment.toLocaleString("en-AU")}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.total.toLocaleString("en-AU")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.costAud > 0 ? formatCurrency(row.costAud) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="border-t p-3">
            <DataTablePagination
              page={safePage}
              pageSize={pageSize}
              totalCount={rows.length}
              pageCount={pageCount}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              emptyLabel="No days"
            />
          </div>
        </div>
      )}

      <div className="shrink-0 rounded-md border bg-muted/50 p-4 text-sm">
        <div className="mb-1 font-semibold">
          {d.source === "placeholder" ? "Next step" : "How it works"}
        </div>
        <p className="text-muted-foreground">{d.enableHint}</p>
      </div>
    </div>
  );
}
