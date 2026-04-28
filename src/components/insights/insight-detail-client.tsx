"use client";

import * as React from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  INSIGHT_META,
  PILLAR_META,
  type InsightId,
  type InsightPayload,
  type RepeatCohortPayload,
  type TopCustomersAtRiskPayload,
  type RevenuePerVehicleDayPayload,
  type MaintenanceVsRevenuePayload,
  type RevenueTrendPayload,
  type AcquisitionConversionPayload,
} from "@/server/services/insights/types";
import { CohortHeatmap } from "./charts/cohort-heatmap";
import { LeaderboardBars } from "./charts/leaderboard-bars";
import { ScatterInsight } from "./charts/scatter-insight";
import { TrendOverlay } from "./charts/trend-overlay";
import { StackedConversion } from "./charts/stacked-conversion";

/**
 * URL templates use the literal token `{id}`, e.g. "/staff/customers/{id}".
 * Strings (not functions) so the component is safe to instantiate from a
 * server page — Next.js cannot serialise function props across the
 * server → client boundary.
 */
interface Props {
  insightId: InsightId;
  basePath: string;
  customerHrefTemplate?: string;
  vehicleHrefTemplate?: string;
}

function buildHref(template: string | undefined, id: string): string | undefined {
  if (!template) return undefined;
  return template.replace("{id}", encodeURIComponent(id));
}

export function InsightDetailClient({
  insightId,
  basePath,
  customerHrefTemplate,
  vehicleHrefTemplate,
}: Props) {
  const detail = trpc.insights.detail.useQuery({ id: insightId });
  const meta = INSIGHT_META[insightId];
  const pillar = PILLAR_META[meta.pillar];
  const customerHref = React.useCallback(
    (id: string) => buildHref(customerHrefTemplate, id),
    [customerHrefTemplate],
  );
  const vehicleHref = React.useCallback(
    (id: string) => buildHref(vehicleHrefTemplate, id),
    [vehicleHrefTemplate],
  );

  return (
    <>
      <PageSection flush>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-muted-foreground">{pillar.label}</span>
          <Link
            href={basePath}
            className="text-caption text-muted-foreground hover:text-foreground"
          >
            ← Back to insights
          </Link>
        </div>
      </PageSection>

      {detail.isLoading ? (
        <div className="h-96 animate-pulse rounded-lg border bg-card" aria-hidden />
      ) : detail.error ? (
        detail.error.data?.code === "PRECONDITION_FAILED" ? (
          <div className="rounded-lg border border-dashed bg-card p-8 text-center">
            <h3 className="h3">Not enough data yet for this insight</h3>
            <p className="mx-auto mt-2 max-w-md text-caption text-muted-foreground">
              The database does not yet hold enough booking, customer or fleet
              history for this insight to be meaningful.
            </p>
            <Link
              href={basePath}
              className="mt-4 inline-block text-caption text-foreground underline"
            >
              Back to AI Insights
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-caption text-destructive">
            {detail.error.message}
          </div>
        )
      ) : detail.data ? (
        <DetailBody
          payload={detail.data.payload}
          scopeLabel={detail.data.scopeLabel}
          customerHref={customerHref}
          vehicleHref={vehicleHref}
        />
      ) : null}
    </>
  );
}

function DetailBody({
  payload,
  scopeLabel,
  customerHref,
  vehicleHref,
}: {
  payload: InsightPayload;
  scopeLabel: string;
  customerHref?: (id: string) => string | undefined;
  vehicleHref?: (id: string) => string | undefined;
}) {
  switch (payload.id) {
    case "repeat-cohort":
      return <RepeatCohortDetail payload={payload} scopeLabel={scopeLabel} />;
    case "top-customers-at-risk":
      return (
        <AtRiskDetail
          payload={payload}
          scopeLabel={scopeLabel}
          customerHref={customerHref}
        />
      );
    case "revenue-per-vehicle-day":
      return (
        <RevenuePerDayDetail
          payload={payload}
          scopeLabel={scopeLabel}
          vehicleHref={vehicleHref}
        />
      );
    case "maintenance-vs-revenue":
      return (
        <MaintenanceVsRevenueDetail
          payload={payload}
          scopeLabel={scopeLabel}
          vehicleHref={vehicleHref}
        />
      );
    case "revenue-trend":
      return <RevenueTrendDetail payload={payload} scopeLabel={scopeLabel} />;
    case "acquisition-conversion":
      return (
        <AcquisitionDetail payload={payload} scopeLabel={scopeLabel} />
      );
  }
}

// ---------------------------------------------------------------------------
// Per-insight detail layouts
// ---------------------------------------------------------------------------

function RepeatCohortDetail({
  payload,
  scopeLabel,
}: {
  payload: RepeatCohortPayload;
  scopeLabel: string;
}) {
  return (
    <>
      <PageSection
        title="Cohort retention matrix"
        description={`${scopeLabel} · cohorts are the month of each customer's first completed booking. Each cell shows how many returned N months later.`}
      >
        <CohortHeatmap payload={payload} />
      </PageSection>
      <PageSection title="Cohort totals" flush>
        <DataTable
          getRowId={(r) => r.cohortMonth}
          data={payload.cohorts}
          columns={cohortColumns}
          empty="No cohorts in window."
        />
      </PageSection>
    </>
  );
}

const cohortColumns: DataTableColumn<
  RepeatCohortPayload["cohorts"][number]
>[] = [
  {
    id: "month",
    header: "Cohort",
    cell: (r) => r.cohortMonth,
    sortable: true,
    accessor: (r) => r.cohortMonth,
  },
  {
    id: "size",
    header: "New customers",
    cell: (r) => r.newCustomers,
    align: "right",
    sortable: true,
    accessor: (r) => r.newCustomers,
  },
  {
    id: "total-returned",
    header: "Ever returned",
    cell: (r) => r.returnedByMonth.reduce((a, b) => a + b, 0),
    align: "right",
    sortable: true,
    accessor: (r) => r.returnedByMonth.reduce((a, b) => a + b, 0),
  },
  {
    id: "rate",
    header: "Rate",
    cell: (r) => {
      const total = r.returnedByMonth.reduce((a, b) => a + b, 0);
      const rate = r.newCustomers > 0 ? total / r.newCustomers : 0;
      return `${Math.round(rate * 100)}%`;
    },
    align: "right",
  },
];

function AtRiskDetail({
  payload,
  scopeLabel,
  customerHref,
}: {
  payload: TopCustomersAtRiskPayload;
  scopeLabel: string;
  customerHref?: (id: string) => string | undefined;
}) {
  const columns: DataTableColumn<TopCustomersAtRiskPayload["rows"][number]>[] = [
    {
      id: "name",
      header: "Customer",
      cell: (r) => (
        <div>
          <div className="font-medium text-foreground">{r.name}</div>
          {r.email && (
            <div className="text-caption text-muted-foreground">{r.email}</div>
          )}
        </div>
      ),
    },
    {
      id: "spend",
      header: "Lifetime spend",
      cell: (r) => formatCurrency(r.totalSpend),
      align: "right",
      sortable: true,
      accessor: (r) => r.totalSpend,
    },
    {
      id: "bookings",
      header: "Bookings",
      cell: (r) => r.totalBookings,
      align: "right",
      sortable: true,
      accessor: (r) => r.totalBookings,
    },
    {
      id: "days",
      header: "Last booking",
      cell: (r) =>
        r.daysSinceLastBooking === null
          ? "Never"
          : `${r.daysSinceLastBooking}d ago`,
      align: "right",
      sortable: true,
      accessor: (r) => r.daysSinceLastBooking ?? 9999,
    },
    {
      id: "risk",
      header: "Risk",
      cell: (r) => <StatusBadge status={r.riskRating} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) =>
        r.atRisk ? (
          <StatusBadge status="HIGH" label="At risk" />
        ) : (
          <StatusBadge status="LOW" label="Active" />
        ),
    },
  ];

  return (
    <PageSection
      title="Top 20 customers by lifetime spend"
      description={`${scopeLabel} · customers who have not booked in 90+ days are flagged as at-risk.`}
      flush
    >
      <DataTable
        getRowId={(r) => r.customerId}
        getRowHref={customerHref ? (r) => customerHref(r.customerId) : undefined}
        data={payload.rows}
        columns={columns}
        empty="No customers yet."
      />
    </PageSection>
  );
}

function RevenuePerDayDetail({
  payload,
  scopeLabel,
  vehicleHref,
}: {
  payload: RevenuePerVehicleDayPayload;
  scopeLabel: string;
  vehicleHref?: (id: string) => string | undefined;
}) {
  const columns: DataTableColumn<
    RevenuePerVehicleDayPayload["rows"][number]
  >[] = [
    {
      id: "label",
      header: "Vehicle",
      cell: (r) => r.label,
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => r.category,
    },
    {
      id: "revenue",
      header: "Revenue",
      cell: (r) => formatCurrency(r.revenue),
      align: "right",
      sortable: true,
      accessor: (r) => r.revenue,
    },
    {
      id: "days",
      header: "Days available",
      cell: (r) => r.availableDays,
      align: "right",
      sortable: true,
      accessor: (r) => r.availableDays,
    },
    {
      id: "perDay",
      header: "Revenue/day",
      cell: (r) => `$${r.revenuePerDay.toFixed(2)}`,
      align: "right",
      sortable: true,
      accessor: (r) => r.revenuePerDay,
    },
  ];
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <PageSection title="Top 10 performers">
          <LeaderboardBars
            data={payload.top}
            average={payload.fleetAverage}
            variant="top"
            formatValue={(n) => `$${Math.round(n)}/d`}
          />
        </PageSection>
        <PageSection title="Bottom 10 performers">
          <LeaderboardBars
            data={payload.bottom}
            average={payload.fleetAverage}
            variant="bottom"
            formatValue={(n) => `$${Math.round(n)}/d`}
          />
        </PageSection>
      </div>
      <PageSection title={`All vehicles · ${scopeLabel}`} flush>
        <DataTable
          getRowId={(r) => r.vehicleId}
          getRowHref={vehicleHref ? (r) => vehicleHref(r.vehicleId) : undefined}
          data={payload.rows}
          columns={columns}
          empty="No active vehicles."
        />
      </PageSection>
    </>
  );
}

function MaintenanceVsRevenueDetail({
  payload,
  scopeLabel,
  vehicleHref,
}: {
  payload: MaintenanceVsRevenuePayload;
  scopeLabel: string;
  vehicleHref?: (id: string) => string | undefined;
}) {
  const columns: DataTableColumn<
    MaintenanceVsRevenuePayload["points"][number]
  >[] = [
    { id: "label", header: "Vehicle", cell: (r) => r.label },
    {
      id: "revenue",
      header: "Revenue (12m)",
      cell: (r) => formatCurrency(r.revenue),
      align: "right",
      sortable: true,
      accessor: (r) => r.revenue,
    },
    {
      id: "cost",
      header: "Maintenance",
      cell: (r) => formatCurrency(r.maintenanceCost),
      align: "right",
      sortable: true,
      accessor: (r) => r.maintenanceCost,
    },
    {
      id: "net",
      header: "Net",
      cell: (r) => formatCurrency(r.net),
      align: "right",
      sortable: true,
      accessor: (r) => r.net,
    },
    {
      id: "flag",
      header: "Flag",
      cell: (r) =>
        r.lossMaker ? <StatusBadge status="HIGH" label="Loss-maker" /> : null,
    },
  ];
  return (
    <>
      <PageSection
        title={`Maintenance vs revenue · ${scopeLabel}`}
        description="Each dot is one vehicle; points below the diagonal lose money this year."
      >
        <ScatterInsight payload={payload} />
      </PageSection>
      <PageSection title="Per-vehicle contribution" flush>
        <DataTable
          getRowId={(r) => r.vehicleId}
          getRowHref={vehicleHref ? (r) => vehicleHref(r.vehicleId) : undefined}
          data={payload.points}
          columns={columns}
          empty="No vehicles yet."
        />
      </PageSection>
    </>
  );
}

function RevenueTrendDetail({
  payload,
  scopeLabel,
}: {
  payload: RevenueTrendPayload;
  scopeLabel: string;
}) {
  const columns: DataTableColumn<
    RevenueTrendPayload["months"][number]
  >[] = [
    { id: "month", header: "Month", cell: (r) => r.month, sortable: true, accessor: (r) => r.month },
    {
      id: "current",
      header: "This year",
      cell: (r) => formatCurrency(r.currentRevenue),
      align: "right",
      sortable: true,
      accessor: (r) => r.currentRevenue,
    },
    {
      id: "prior",
      header: "Prior year",
      cell: (r) => formatCurrency(r.priorYearRevenue),
      align: "right",
      sortable: true,
      accessor: (r) => r.priorYearRevenue,
    },
    {
      id: "delta",
      header: "YoY Δ",
      cell: (r) => {
        if (r.priorYearRevenue === 0) return "—";
        const pct =
          ((r.currentRevenue - r.priorYearRevenue) / r.priorYearRevenue) * 100;
        return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
      },
      align: "right",
    },
  ];

  return (
    <>
      <PageSection
        title={`Revenue trend · ${scopeLabel}`}
        description="Monthly gross revenue with the matching month in the prior year for comparison."
      >
        <TrendOverlay payload={payload} />
      </PageSection>
      <PageSection title="Per-month breakdown" flush>
        <DataTable
          getRowId={(r) => r.month}
          data={payload.months}
          columns={columns}
          empty="No revenue data yet."
        />
      </PageSection>
    </>
  );
}

function AcquisitionDetail({
  payload,
  scopeLabel,
}: {
  payload: AcquisitionConversionPayload;
  scopeLabel: string;
}) {
  const columns: DataTableColumn<
    AcquisitionConversionPayload["sources"][number]
  >[] = [
    {
      id: "source",
      header: "Source",
      cell: (r) => r.source,
      sortable: true,
      accessor: (r) => r.source,
    },
    {
      id: "sessions",
      header: "Sessions",
      cell: (r) => r.sessions,
      align: "right",
      sortable: true,
      accessor: (r) => r.sessions,
    },
    {
      id: "bookings",
      header: "Bookings",
      cell: (r) => r.bookings,
      align: "right",
      sortable: true,
      accessor: (r) => r.bookings,
    },
    {
      id: "rate",
      header: "Conversion",
      cell: (r) => `${r.conversionRate.toFixed(2)}%`,
      align: "right",
      sortable: true,
      accessor: (r) => r.conversionRate,
    },
  ];

  return (
    <>
      <PageSection
        title={`Acquisition source conversion · ${scopeLabel}`}
        description="Visitor sessions over the last 30 days, split by UTM source."
      >
        <StackedConversion payload={payload} />
      </PageSection>
      <PageSection title="Per-source breakdown" flush>
        <DataTable
          getRowId={(r) => r.source}
          data={payload.sources}
          columns={columns}
          empty="No visitor data yet."
        />
      </PageSection>
    </>
  );
}
