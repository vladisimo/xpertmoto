"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CalendarClock, Repeat, TrendingUp, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import {
  LegendDot,
  LoadingBlock,
  MiniStackedBar,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";

const ForecastChart = dynamic(
  () => import("./recurring-charts").then((m) => m.RecurringForecastChart),
  { ssr: false, loading: () => <LoadingBlock className="h-full w-full" /> },
);
const TrendChart = dynamic(
  () => import("./recurring-charts").then((m) => m.RecurringTrendChart),
  { ssr: false, loading: () => <LoadingBlock className="h-full w-full" /> },
);
const StatusDonut = dynamic(
  () => import("./recurring-charts").then((m) => m.RecurringStatusDonut),
  { ssr: false, loading: () => <LoadingBlock className="h-28 w-28 rounded-full" /> },
);

const FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};
const PER_LABEL: Record<string, string> = { WEEKLY: "wk", FORTNIGHTLY: "fn", MONTHLY: "mo" };

const STATUS_COLORS: Array<{ key: string; name: string; colorVar: string }> = [
  { key: "ACTIVE", name: "Active", colorVar: "--admin-accent" },
  { key: "PAUSED", name: "Paused", colorVar: "--secondary" },
  { key: "COMPLETED", name: "Completed", colorVar: "--muted-foreground" },
  { key: "CANCELLED", name: "Cancelled", colorVar: "--destructive" },
];

type PlanRow = {
  id: string;
  bookingId: string | null;
  bookingReference: string | null;
  customerId: string | null;
  customer: string | null;
  frequency: string;
  amountPerPeriod: number;
  periodsCompleted: number;
  periodsTotal: number;
  nextChargeAt: string | Date;
  status: string;
};

export function FinanceRecurring({ depotId }: { depotId?: string }) {
  const { data, isLoading } = trpc.admin.financeRecurring.useQuery({ depotId });

  const totalPlans = data
    ? Object.values(data.statusCounts).reduce((a, n) => a + n, 0)
    : 0;
  const capturePct = data ? Math.round(data.kpis.captureRate * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* KPI row */}
      <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        <StatShell title="Active plans" icon={<Repeat className="h-4 w-4" aria-hidden />}>
          {isLoading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {data.kpis.activePlans}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {data.kpis.pausedPlans} paused ·{" "}
                <span className="tabular-nums text-foreground">{totalPlans}</span> total
              </div>
            </>
          )}
        </StatShell>

        <StatShell title="Committed upcoming" icon={<Wallet className="h-4 w-4" aria-hidden />}>
          {isLoading || !data ? (
            <LoadingBlock className="h-10 w-32" />
          ) : (
            <>
              <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(data.kpis.committedRevenue)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                contracted across {data.kpis.activePlans} active plan
                {data.kpis.activePlans === 1 ? "" : "s"}
              </div>
            </>
          )}
        </StatShell>

        <StatShell title="Collected (30d)" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          {isLoading || !data ? (
            <LoadingBlock className="h-10 w-32" />
          ) : (
            <>
              <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(data.kpis.collected30d)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                all-time{" "}
                <span className="tabular-nums text-foreground">
                  {formatCurrency(data.kpis.collectedAllTime)}
                </span>
              </div>
            </>
          )}
        </StatShell>

        <StatShell title="Capture health" icon={<CalendarClock className="h-4 w-4" aria-hidden />}>
          {isLoading || !data ? (
            <LoadingBlock className="h-12 w-full" />
          ) : (
            <>
              <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {capturePct}%
              </div>
              <MiniStackedBar
                height="h-2"
                segments={[
                  { value: data.kpis.captureSucceeded, colorVar: "--admin-accent" },
                  { value: data.kpis.captureFailed, colorVar: "--destructive" },
                  { value: data.kpis.capturePending, colorVar: "--secondary" },
                ]}
              />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <LegendDot colorVar="--admin-accent">
                  <span className="tabular-nums text-foreground">{data.kpis.captureSucceeded}</span> ok
                </LegendDot>
                <LegendDot colorVar="--destructive">
                  <span className="tabular-nums text-foreground">{data.kpis.captureFailed}</span> failed
                </LegendDot>
                <LegendDot colorVar="--secondary">
                  <span className="tabular-nums text-foreground">{data.kpis.capturePending}</span> pending
                </LegendDot>
              </div>
            </>
          )}
        </StatShell>
      </div>

      {/* 3-wide grid filling the remaining viewport: Active plans (left 2/3)
          scrolls internally with a sticky header; the charts + portfolio +
          cadence stack down the right 1/3, scrolling there if they overflow. */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3 lg:grid-rows-1">
        <div className="flex min-h-0 flex-col gap-2 lg:col-span-2">
          <div className="shrink-0">
            <h2 className="h3">Active plans</h2>
            <p className="text-xs text-muted-foreground">
              Live recurring schedules, soonest charge first.
            </p>
          </div>
          <DataTable<PlanRow>
            className="min-h-0 flex-1"
            columns={planColumns}
            data={(data?.plans ?? undefined) as PlanRow[] | undefined}
            isLoading={isLoading}
            getRowId={(r) => r.id}
            empty="No active recurring plans."
            mobileMode="cards"
            stickyHeader
          />
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <section className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div>
                <h2 className="h3">Expected recurring income</h2>
                <p className="text-xs text-muted-foreground">
                  Scheduled charges across active plans — next 14 days.
                </p>
              </div>
              {data && (
                <div className="text-right">
                  <div className="font-display text-lg font-semibold tabular-nums text-foreground">
                    {formatCurrency(data.forecastTotal)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {data.forecastCount} charge{data.forecastCount === 1 ? "" : "s"} upcoming
                  </div>
                </div>
              )}
            </div>
            <div className="h-40">
              {isLoading || !data ? (
                <LoadingBlock className="h-full w-full" />
              ) : (
                <ForecastChart data={data.forecast} />
              )}
            </div>
          </section>

          <section className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-2">
              <h2 className="h3">Recurring revenue collected</h2>
              <p className="text-xs text-muted-foreground">
                Captured subscription charges by month — last 6 months.
              </p>
            </div>
            <div className="h-32">
              {isLoading || !data ? (
                <LoadingBlock className="h-full w-full" />
              ) : (
                <TrendChart data={data.trend} />
              )}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="h3">Portfolio</h2>
              <p className="text-xs text-muted-foreground">Plans by status.</p>
              <div className="mt-2 flex flex-col items-center gap-3">
                {isLoading || !data ? (
                  <LoadingBlock className="h-28 w-28 rounded-full" />
                ) : (
                  <StatusDonut
                    data={STATUS_COLORS.map((s) => ({
                      name: s.name,
                      value: data.statusCounts[s.key] ?? 0,
                      colorVar: s.colorVar,
                    }))}
                  />
                )}
                <div className="w-full space-y-1.5 text-[11px]">
                  {STATUS_COLORS.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2">
                      <LegendDot colorVar={s.colorVar}>
                        <span className="text-muted-foreground">{s.name}</span>
                      </LegendDot>
                      <span className="font-display text-sm font-semibold tabular-nums text-foreground">
                        {data ? (data.statusCounts[s.key] ?? 0) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="h3">Billing cadence</h2>
              <p className="text-xs text-muted-foreground">Active plans by frequency.</p>
              <div className="mt-3 space-y-3">
                {isLoading || !data ? (
                  <LoadingBlock className="h-20 w-full" />
                ) : data.frequencyMix.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active recurring plans.</p>
                ) : (
                  (() => {
                    const maxCount = Math.max(...data.frequencyMix.map((f) => f.count), 1);
                    return data.frequencyMix.map((f) => (
                      <PipelineRow
                        key={f.frequency}
                        label={FREQUENCY_LABEL[f.frequency] ?? f.frequency}
                        value={f.count}
                        total={maxCount}
                        colorVar="--admin-accent"
                        hint={`${formatCurrency(f.perPeriod)}/${PER_LABEL[f.frequency] ?? "period"}`}
                      />
                    ));
                  })()
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressCell({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums text-foreground">
        {completed}/{total}
      </span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: "hsl(var(--admin-accent))" }}
        />
      </span>
    </div>
  );
}

const planColumns: DataTableColumn<PlanRow>[] = [
  {
    id: "booking",
    header: "Booking",
    cell: (r) =>
      r.bookingId && r.bookingReference ? (
        <Link
          href={`/staff/bookings/${r.bookingId}`}
          className="font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {r.bookingReference}
        </Link>
      ) : (
        <span className="font-medium">{r.bookingReference ?? "—"}</span>
      ),
    accessor: (r) => r.bookingReference,
    primary: true,
  },
  {
    id: "customer",
    header: "Customer",
    cell: (r) =>
      r.customerId && r.customer ? (
        <Link
          href={`/staff/customers/${r.customerId}`}
          className="text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {r.customer}
        </Link>
      ) : (
        (r.customer ?? "—")
      ),
    accessor: (r) => r.customer,
    secondary: true,
  },
  {
    id: "cadence",
    header: "Cadence",
    cell: (r) => FREQUENCY_LABEL[r.frequency] ?? r.frequency,
  },
  {
    id: "amount",
    header: "Per period",
    align: "right",
    cell: (r) => <span className="tabular-nums">{formatCurrency(r.amountPerPeriod)}</span>,
    accessor: (r) => r.amountPerPeriod,
  },
  {
    id: "progress",
    header: "Progress",
    cell: (r) => <ProgressCell completed={r.periodsCompleted} total={r.periodsTotal} />,
    accessor: (r) => r.periodsCompleted,
  },
  {
    id: "next",
    header: "Next charge",
    cell: (r) => <span className="tabular-nums">{formatDateTime(r.nextChargeAt)}</span>,
    accessor: (r) => new Date(r.nextChargeAt),
    sortable: true,
  },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status as StatusKey} /> },
];
