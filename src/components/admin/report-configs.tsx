"use client";

import * as React from "react";
import { DollarSign, Percent, TrendingUp, Layers, Wrench, Bike, CalendarDays, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import type { DataTableColumn } from "@/components/ui/data-table";
import { StatShell, MiniStackedBar, PipelineRow, LegendDot } from "@/components/ui/stat-shell";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import type { ReportFilterField, ReportFilterState } from "./report-filters";

// ---------------------------------------------------------------------------
// Categories (single source of truth — kept in sync with export registry ids)
// ---------------------------------------------------------------------------

export type ReportCategory =
  | "bookings"
  | "fleet"
  | "customers"
  | "financial"
  | "operational";

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  bookings: "Bookings",
  fleet: "Fleet",
  customers: "Customers",
  financial: "Financial",
  operational: "Operational",
};

export const CATEGORY_ORDER: readonly ReportCategory[] = [
  "bookings",
  "fleet",
  "customers",
  "financial",
  "operational",
] as const;

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface ReportQueryResult<TRow> {
  data: TRow[] | undefined;
  isLoading: boolean;
}

export interface ReportConfig<TRow> {
  key: string;
  category: ReportCategory;
  title: string;
  description: string;
  filterFields: readonly ReportFilterField[];
  useQuery: (filters: ReportFilterState) => ReportQueryResult<TRow>;
  columns: DataTableColumn<TRow>[];
  getRowId: (row: TRow) => string;
  emptyMessage?: string;
  statWidgets?: (rows: TRow[]) => React.ReactNode;
}

// A value that can be stored heterogeneously in the registry while preserving
// that each entry's TRow flows through its own columns / query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyReportConfig = ReportConfig<any>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateRange(filters: ReportFilterState) {
  return {
    from: new Date(filters.from),
    to: new Date(filters.to + "T23:59:59"),
  };
}

function sum<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((a, r) => a + (Number(pick(r)) || 0), 0);
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

type BookingsByPeriodRow = { key: string; count: number; revenue: number };
const bookingsByPeriod: ReportConfig<BookingsByPeriodRow> = {
  key: "bookings.byPeriod",
  category: "bookings",
  title: "Bookings by period",
  description: "Count and revenue bucketed by day, week, or month.",
  filterFields: ["dateRange", "period"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.bookingsByPeriod.useQuery({ from, to, period: filters.period });
  },
  columns: [
    { id: "period", header: "Period", cell: (r) => r.key },
    { id: "bookings", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", accessor: (r) => r.count, sortable: true },
    { id: "revenue", header: "Revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", accessor: (r) => r.revenue, sortable: true },
  ],
  getRowId: (r) => r.key,
  emptyMessage: "No bookings in this period.",
  statWidgets: (rows) => {
    const totalBookings = sum(rows, (r) => r.count);
    const totalRevenue = sum(rows, (r) => r.revenue);
    const avgBooking = totalBookings > 0 ? totalRevenue / totalBookings : 0;
    const peak = rows.reduce<BookingsByPeriodRow | null>((acc, r) => (!acc || r.revenue > acc.revenue ? r : acc), null);
    return (
      <>
        <StatShell title="Total bookings" icon={<CalendarDays className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{totalBookings.toLocaleString("en-AU")}</div>
          <div className="mt-1 text-xs text-muted-foreground">Across {rows.length} {rows.length === 1 ? "bucket" : "buckets"}</div>
        </StatShell>
        <StatShell title="Total revenue" icon={<DollarSign className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{formatCurrency(totalRevenue)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Inc. GST</div>
        </StatShell>
        <StatShell title="Avg per booking" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{formatCurrency(avgBooking)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Revenue ÷ bookings</div>
        </StatShell>
        <StatShell title="Peak bucket" icon={<BarChart3 className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-sm font-semibold">{peak?.key ?? "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">{peak ? formatCurrency(peak.revenue) : "—"}</div>
        </StatShell>
      </>
    );
  },
};

type BookingsBySourceRow = { source: string; count: number; revenue: number; share: number };
const bookingsBySource: ReportConfig<BookingsBySourceRow> = {
  key: "bookings.bySource",
  category: "bookings",
  title: "Bookings by source",
  description: "Website vs walk-in vs phone vs agent vs API volume and revenue.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportBookingsBySource.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "source", header: "Source", cell: (r) => r.source, sortable: true, accessor: (r) => r.source },
    { id: "count", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", sortable: true, accessor: (r) => r.count },
    { id: "revenue", header: "Revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
    { id: "share", header: "Share", cell: (r) => <span className="tabular-nums">{(r.share * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.share },
  ],
  getRowId: (r) => r.source,
  emptyMessage: "No bookings in this period.",
};

type BookingsCancellationsRow = { reason: string; count: number; lostRevenue: number; avgLeadDays: number };
const bookingsCancellations: ReportConfig<BookingsCancellationsRow> = {
  key: "bookings.cancellations",
  category: "bookings",
  title: "Cancellation analysis",
  description: "Cancellations by reason, lost revenue, and average lead time.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportBookingsCancellations.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "reason", header: "Reason", cell: (r) => r.reason },
    { id: "count", header: "Count", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", sortable: true, accessor: (r) => r.count },
    { id: "lost", header: "Lost revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.lostRevenue)}</span>, align: "right", sortable: true, accessor: (r) => r.lostRevenue },
    { id: "lead", header: "Avg lead (d)", cell: (r) => <span className="tabular-nums">{r.avgLeadDays.toFixed(1)}</span>, align: "right", sortable: true, accessor: (r) => r.avgLeadDays },
  ],
  getRowId: (r) => r.reason,
  emptyMessage: "No cancellations in this period.",
};

type BookingsLeadTimeRow = { bucket: string; count: number; share: number };
const bookingsLeadTime: ReportConfig<BookingsLeadTimeRow> = {
  key: "bookings.leadTime",
  category: "bookings",
  title: "Booking lead time",
  description: "Distribution of lead time from booking to pickup.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportBookingsLeadTime.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "bucket", header: "Lead time", cell: (r) => r.bucket },
    { id: "count", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", sortable: true, accessor: (r) => r.count },
    { id: "share", header: "Share", cell: (r) => <span className="tabular-nums">{(r.share * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.share },
  ],
  getRowId: (r) => r.bucket,
  emptyMessage: "No bookings in this period.",
};

type BookingsNoShowRow = { month: string; bookings: number; noShows: number; rate: number };
const bookingsNoShow: ReportConfig<BookingsNoShowRow> = {
  key: "bookings.noShow",
  category: "bookings",
  title: "No-show rate",
  description: "Monthly no-show count and rate.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportBookingsNoShow.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "month", header: "Month", cell: (r) => r.month },
    { id: "bookings", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.bookings}</span>, align: "right", sortable: true, accessor: (r) => r.bookings },
    { id: "noShows", header: "No-shows", cell: (r) => <span className="tabular-nums">{r.noShows}</span>, align: "right", sortable: true, accessor: (r) => r.noShows },
    { id: "rate", header: "Rate", cell: (r) => <span className="tabular-nums">{(r.rate * 100).toFixed(2)}%</span>, align: "right", sortable: true, accessor: (r) => r.rate },
  ],
  getRowId: (r) => r.month,
  emptyMessage: "No bookings in this period.",
};

type BookingsConversionRow = { step: string; count: number; share: number };
const bookingsConversion: ReportConfig<BookingsConversionRow> = {
  key: "bookings.conversion",
  category: "bookings",
  title: "Conversion funnel",
  description: "Booking pipeline from quote to completion.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportBookingsConversion.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "step", header: "Step", cell: (r) => r.step },
    { id: "count", header: "Count", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", sortable: true, accessor: (r) => r.count },
    { id: "share", header: "Share", cell: (r) => <span className="tabular-nums">{(r.share * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.share },
  ],
  getRowId: (r) => r.step,
  emptyMessage: "No bookings in this period.",
};

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

type FleetUtilisationRow = {
  id: string;
  code: string;
  category: string;
  depot: string;
  bookingCount: number;
  utilisation: number;
  revenue: number;
};
const fleetUtilisation: ReportConfig<FleetUtilisationRow> = {
  key: "fleet.utilisation",
  category: "fleet",
  title: "Fleet utilisation",
  description: "Per-vehicle bookings, days used, utilisation rate, and revenue.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.fleetUtilisation.useQuery({ from, to });
  },
  columns: [
    { id: "code", header: "Vehicle", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortable: true, accessor: (r) => r.code },
    { id: "category", header: "Category", cell: (r) => r.category, sortable: true, accessor: (r) => r.category },
    { id: "depot", header: "Depot", cell: (r) => r.depot, sortable: true, accessor: (r) => r.depot },
    { id: "count", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.bookingCount}</span>, align: "right", sortable: true, accessor: (r) => r.bookingCount },
    { id: "util", header: "Utilisation", cell: (r) => <span className="tabular-nums">{r.utilisation}%</span>, align: "right", sortable: true, accessor: (r) => r.utilisation },
    { id: "revenue", header: "Revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No vehicles matched.",
  statWidgets: (rows) => {
    const totalVehicles = rows.length;
    const totalBookings = sum(rows, (r) => r.bookingCount);
    const avgUtil = totalVehicles > 0 ? sum(rows, (r) => r.utilisation) / totalVehicles : 0;
    const totalRevenue = sum(rows, (r) => r.revenue);
    const top = [...rows].sort((a, b) => b.utilisation - a.utilisation).slice(0, 3);
    return (
      <>
        <StatShell title="Vehicles" icon={<Bike className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{totalVehicles}</div>
          <div className="mt-1 text-xs text-muted-foreground">{totalBookings} bookings total</div>
        </StatShell>
        <StatShell title="Avg utilisation" icon={<Percent className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{avgUtil.toFixed(1)}%</div>
          <div className="mt-2">
            <MiniStackedBar segments={[{ value: avgUtil, colorVar: "--admin-accent" }, { value: Math.max(0, 100 - avgUtil), colorVar: "--muted-foreground", opacity: 0.15 }]} />
          </div>
        </StatShell>
        <StatShell title="Total revenue" icon={<DollarSign className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{formatCurrency(totalRevenue)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {totalVehicles > 0 ? `${formatCurrency(totalRevenue / totalVehicles)} / vehicle` : "—"}
          </div>
        </StatShell>
        <StatShell title="Top utilisation" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          <div className="space-y-1.5">
            {top.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
            {top.map((v) => (
              <PipelineRow
                key={v.id}
                label={v.code}
                value={v.utilisation}
                total={100}
                colorVar="--admin-accent"
                formatValue={(n) => `${n}%`}
              />
            ))}
          </div>
        </StatShell>
      </>
    );
  },
};

type FleetRevenuePerVehicleRow = {
  id: string;
  code: string;
  category: string;
  depot: string;
  rentals: number;
  days: number;
  revenue: number;
  avgPerDay: number;
};
const fleetRevenuePerVehicle: ReportConfig<FleetRevenuePerVehicleRow> = {
  key: "fleet.revenuePerVehicle",
  category: "fleet",
  title: "Revenue per vehicle",
  description: "Gross revenue attributed to each vehicle in the period.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFleetRevenuePerVehicle.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "code", header: "Vehicle", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortable: true, accessor: (r) => r.code },
    { id: "category", header: "Category", cell: (r) => r.category, sortable: true, accessor: (r) => r.category },
    { id: "depot", header: "Depot", cell: (r) => r.depot, sortable: true, accessor: (r) => r.depot },
    { id: "rentals", header: "Rentals", cell: (r) => <span className="tabular-nums">{r.rentals}</span>, align: "right", sortable: true, accessor: (r) => r.rentals },
    { id: "days", header: "Days", cell: (r) => <span className="tabular-nums">{r.days}</span>, align: "right", sortable: true, accessor: (r) => r.days },
    { id: "revenue", header: "Revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
    { id: "avgDay", header: "$/day", cell: (r) => <span className="tabular-nums text-muted-foreground">{formatCurrency(r.avgPerDay)}</span>, align: "right", sortable: true, accessor: (r) => r.avgPerDay },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No revenue data.",
};

type FleetMaintenanceCostRow = {
  id: string;
  code: string;
  category: string;
  woCount: number;
  labour: number;
  parts: number;
  total: number;
  costPerKm: number;
};
const fleetMaintenanceCost: ReportConfig<FleetMaintenanceCostRow> = {
  key: "fleet.maintenanceCost",
  category: "fleet",
  title: "Maintenance cost",
  description: "Cost per vehicle, cost per km, parts vs labour.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFleetMaintenanceCost.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "code", header: "Vehicle", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortable: true, accessor: (r) => r.code },
    { id: "category", header: "Category", cell: (r) => r.category, sortable: true, accessor: (r) => r.category },
    { id: "wo", header: "Work orders", cell: (r) => <span className="tabular-nums">{r.woCount}</span>, align: "right", sortable: true, accessor: (r) => r.woCount },
    { id: "labour", header: "Labour", cell: (r) => <span className="tabular-nums">{formatCurrency(r.labour)}</span>, align: "right", sortable: true, accessor: (r) => r.labour },
    { id: "parts", header: "Parts", cell: (r) => <span className="tabular-nums">{formatCurrency(r.parts)}</span>, align: "right", sortable: true, accessor: (r) => r.parts },
    { id: "total", header: "Total", cell: (r) => <span className="tabular-nums font-semibold">{formatCurrency(r.total)}</span>, align: "right", sortable: true, accessor: (r) => r.total },
    { id: "perKm", header: "$/km", cell: (r) => <span className="tabular-nums text-muted-foreground">{r.costPerKm > 0 ? `$${r.costPerKm.toFixed(4)}` : "—"}</span>, align: "right", sortable: true, accessor: (r) => r.costPerKm },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No completed work orders in this period.",
};

type FleetDowntimeRow = {
  id: string;
  workOrderNumber: string;
  vehicle: string;
  type: string;
  days: number;
  startedAt: Date | null;
  completedAt: Date | null;
};
const fleetDowntime: ReportConfig<FleetDowntimeRow> = {
  key: "fleet.downtime",
  category: "fleet",
  title: "Vehicle downtime",
  description: "Time out of service by reason and vehicle.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFleetDowntime.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "wo", header: "WO", cell: (r) => <span className="font-mono text-xs">{r.workOrderNumber}</span>, sortable: true, accessor: (r) => r.workOrderNumber },
    { id: "vehicle", header: "Vehicle", cell: (r) => <span className="font-mono text-xs">{r.vehicle}</span>, sortable: true, accessor: (r) => r.vehicle },
    { id: "type", header: "Type", cell: (r) => r.type.replace(/_/g, " ").toLowerCase() },
    { id: "days", header: "Days out", cell: (r) => <span className="tabular-nums">{r.days}</span>, align: "right", sortable: true, accessor: (r) => r.days },
    { id: "started", header: "Started", cell: (r) => (r.startedAt ? formatDateTime(r.startedAt) : "—"), sortable: true, accessor: (r) => r.startedAt ?? undefined },
    { id: "completed", header: "Completed", cell: (r) => (r.completedAt ? formatDateTime(r.completedAt) : "in progress") },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No downtime in this period.",
};

type FleetProfitabilityRow = {
  id: string;
  code: string;
  category: string;
  revenue: number;
  maintenance: number;
  net: number;
};
const fleetProfitability: ReportConfig<FleetProfitabilityRow> = {
  key: "fleet.profitability",
  category: "fleet",
  title: "Vehicle profitability",
  description: "Revenue minus maintenance minus insurance per vehicle.",
  filterFields: ["dateRange", "depot"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFleetProfitability.useQuery({ from, to, depotId: filters.depotId });
  },
  columns: [
    { id: "code", header: "Vehicle", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortable: true, accessor: (r) => r.code },
    { id: "category", header: "Category", cell: (r) => r.category, sortable: true, accessor: (r) => r.category },
    { id: "revenue", header: "Revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
    { id: "maint", header: "Maintenance", cell: (r) => <span className="tabular-nums text-destructive">{formatCurrency(r.maintenance)}</span>, align: "right", sortable: true, accessor: (r) => r.maintenance },
    { id: "net", header: "Net", cell: (r) => <span className={"tabular-nums font-semibold " + (r.net >= 0 ? "text-foreground" : "text-destructive")}>{formatCurrency(r.net)}</span>, align: "right", sortable: true, accessor: (r) => r.net },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No data.",
};

type FleetAgeOdometerRow = {
  id: string;
  code: string;
  category: string;
  depot: string;
  year: number;
  age: number;
  odometer: number;
  rentalDays: number;
  kmPerRentalDay: number;
};
const fleetAgeOdometer: ReportConfig<FleetAgeOdometerRow> = {
  key: "fleet.ageOdometer",
  category: "fleet",
  title: "Age & odometer",
  description: "Vehicle age, current odometer, km per rental day.",
  filterFields: ["depot"],
  useQuery(filters) {
    return trpc.admin.reportFleetAgeOdometer.useQuery({ depotId: filters.depotId });
  },
  columns: [
    { id: "code", header: "Vehicle", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortable: true, accessor: (r) => r.code },
    { id: "category", header: "Category", cell: (r) => r.category, sortable: true, accessor: (r) => r.category },
    { id: "depot", header: "Depot", cell: (r) => r.depot, sortable: true, accessor: (r) => r.depot },
    { id: "year", header: "Year", cell: (r) => <span className="tabular-nums">{r.year}</span>, align: "right", sortable: true, accessor: (r) => r.year },
    { id: "age", header: "Age (yrs)", cell: (r) => <span className="tabular-nums">{r.age}</span>, align: "right", sortable: true, accessor: (r) => r.age },
    { id: "odo", header: "Odometer (km)", cell: (r) => <span className="tabular-nums">{r.odometer.toLocaleString("en-AU")}</span>, align: "right", sortable: true, accessor: (r) => r.odometer },
    { id: "days", header: "Rental days", cell: (r) => <span className="tabular-nums">{r.rentalDays}</span>, align: "right", sortable: true, accessor: (r) => r.rentalDays },
    { id: "kmPerDay", header: "km/day", cell: (r) => <span className="tabular-nums text-muted-foreground">{r.kmPerRentalDay.toFixed(1)}</span>, align: "right", sortable: true, accessor: (r) => r.kmPerRentalDay },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No vehicles.",
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

type CustomersTopRow = { id: string; name: string; email: string; bookings: number; spend: number };
const customersTop: ReportConfig<CustomersTopRow> = {
  key: "customers.top",
  category: "customers",
  title: "Top customers",
  description: "Highest lifetime-spend customers.",
  filterFields: [],
  useQuery() {
    return trpc.admin.topCustomers.useQuery();
  },
  columns: [
    { id: "name", header: "Customer", cell: (r) => r.name, sortable: true, accessor: (r) => r.name },
    { id: "email", header: "Email", cell: (r) => <span className="text-muted-foreground">{r.email}</span> },
    { id: "bookings", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.bookings}</span>, align: "right", sortable: true, accessor: (r) => r.bookings },
    { id: "spend", header: "Lifetime spend", cell: (r) => <span className="tabular-nums">{formatCurrency(r.spend)}</span>, align: "right", sortable: true, accessor: (r) => r.spend },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No customers.",
};

type CustomersNewVsReturningRow = { month: string; newCount: number; returningCount: number; ratio: number };
const customersNewVsReturning: ReportConfig<CustomersNewVsReturningRow> = {
  key: "customers.newVsReturning",
  category: "customers",
  title: "New vs returning",
  description: "Share of new versus returning customers each month.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportCustomersNewVsReturning.useQuery({ from, to });
  },
  columns: [
    { id: "month", header: "Month", cell: (r) => r.month },
    { id: "new", header: "New", cell: (r) => <span className="tabular-nums">{r.newCount}</span>, align: "right", sortable: true, accessor: (r) => r.newCount },
    { id: "returning", header: "Returning", cell: (r) => <span className="tabular-nums">{r.returningCount}</span>, align: "right", sortable: true, accessor: (r) => r.returningCount },
    { id: "ratio", header: "New share", cell: (r) => <span className="tabular-nums">{(r.ratio * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.ratio },
  ],
  getRowId: (r) => r.month,
  emptyMessage: "No bookings in this period.",
};

type CustomersLtvRow = { metric: string; value: number; format: "number" | "currency" | "percent" };
function renderLtvValue(r: CustomersLtvRow): string {
  if (r.format === "currency") return formatCurrency(r.value);
  if (r.format === "percent") return `${(r.value * 100).toFixed(1)}%`;
  return r.value.toLocaleString("en-AU", { maximumFractionDigits: 2 });
}
const customersLtv: ReportConfig<CustomersLtvRow> = {
  key: "customers.ltv",
  category: "customers",
  title: "Customer LTV",
  description: "Average lifetime value and repeat-booking rate.",
  filterFields: [],
  useQuery() {
    return trpc.admin.reportCustomersLtv.useQuery();
  },
  columns: [
    { id: "metric", header: "Metric", cell: (r) => r.metric },
    { id: "value", header: "Value", cell: (r) => <span className="tabular-nums font-semibold">{renderLtvValue(r)}</span>, align: "right" },
  ],
  getRowId: (r) => r.metric,
  emptyMessage: "No customer data.",
};

type CustomersAcquisitionRow = { source: string; customers: number; revenue: number };
const customersAcquisition: ReportConfig<CustomersAcquisitionRow> = {
  key: "customers.acquisition",
  category: "customers",
  title: "Acquisition by source",
  description: "New customers attributed to each booking source.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportCustomersAcquisition.useQuery({ from, to });
  },
  columns: [
    { id: "source", header: "Source", cell: (r) => r.source, sortable: true, accessor: (r) => r.source },
    { id: "customers", header: "New customers", cell: (r) => <span className="tabular-nums">{r.customers}</span>, align: "right", sortable: true, accessor: (r) => r.customers },
    { id: "revenue", header: "First-booking revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
  ],
  getRowId: (r) => r.source,
  emptyMessage: "No new customers in this period.",
};

type CustomersGeographicRow = {
  postcode: string;
  suburb: string;
  state: string;
  customers: number;
  bookings: number;
  revenue: number;
};
const customersGeographic: ReportConfig<CustomersGeographicRow> = {
  key: "customers.geographic",
  category: "customers",
  title: "Geographic distribution",
  description: "Customers and bookings by postcode.",
  filterFields: [],
  useQuery() {
    return trpc.admin.reportCustomersGeographic.useQuery();
  },
  columns: [
    { id: "postcode", header: "Postcode", cell: (r) => <span className="font-mono">{r.postcode}</span>, sortable: true, accessor: (r) => r.postcode },
    { id: "suburb", header: "Suburb", cell: (r) => r.suburb, sortable: true, accessor: (r) => r.suburb },
    { id: "state", header: "State", cell: (r) => r.state, sortable: true, accessor: (r) => r.state },
    { id: "customers", header: "Customers", cell: (r) => <span className="tabular-nums">{r.customers}</span>, align: "right", sortable: true, accessor: (r) => r.customers },
    { id: "bookings", header: "Bookings", cell: (r) => <span className="tabular-nums">{r.bookings}</span>, align: "right", sortable: true, accessor: (r) => r.bookings },
    { id: "revenue", header: "Revenue", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
  ],
  getRowId: (r) => `${r.postcode}-${r.state}`,
  emptyMessage: "No address data.",
};

// ---------------------------------------------------------------------------
// Financial
// ---------------------------------------------------------------------------

type FinancialAgingRow = {
  bookingReference: string;
  customer: string;
  balance: number;
  pickupDate: Date;
  ageBucket: string;
};
const financialAging: ReportConfig<FinancialAgingRow> = {
  key: "financial.aging",
  category: "financial",
  title: "Outstanding aging",
  description: "Balances owed bucketed by age (0-30, 31-60, 61-90, 90+).",
  filterFields: ["depot"],
  useQuery(filters) {
    return trpc.admin.reportFinancialAging.useQuery({ depotId: filters.depotId });
  },
  columns: [
    { id: "booking", header: "Booking", cell: (r) => <span className="font-mono text-xs">{r.bookingReference}</span>, sortable: true, accessor: (r) => r.bookingReference },
    { id: "customer", header: "Customer", cell: (r) => r.customer, sortable: true, accessor: (r) => r.customer },
    { id: "pickup", header: "Pickup", cell: (r) => formatDate(r.pickupDate), sortable: true, accessor: (r) => r.pickupDate },
    { id: "age", header: "Age bucket", cell: (r) => r.ageBucket, sortable: true, accessor: (r) => r.ageBucket },
    { id: "balance", header: "Balance", cell: (r) => <span className="tabular-nums">{formatCurrency(r.balance)}</span>, align: "right", sortable: true, accessor: (r) => r.balance },
  ],
  getRowId: (r) => r.bookingReference,
  emptyMessage: "Nothing outstanding.",
};

type FinancialRefundsRow = { month: string; count: number; amount: number; share: number };
const financialRefundAnalysis: ReportConfig<FinancialRefundsRow> = {
  key: "financial.refundAnalysis",
  category: "financial",
  title: "Refund analysis",
  description: "Monthly refund count, amount, and share of revenue.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFinancialRefunds.useQuery({ from, to });
  },
  columns: [
    { id: "month", header: "Month", cell: (r) => r.month },
    { id: "count", header: "Count", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", sortable: true, accessor: (r) => r.count },
    { id: "amount", header: "Amount", cell: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span>, align: "right", sortable: true, accessor: (r) => r.amount },
    { id: "share", header: "% of revenue", cell: (r) => <span className="tabular-nums">{(r.share * 100).toFixed(2)}%</span>, align: "right", sortable: true, accessor: (r) => r.share },
  ],
  getRowId: (r) => r.month,
  emptyMessage: "No refunds in this period.",
};

type FinancialPnlByDepotRow = {
  depot: string;
  revenue: number;
  gst: number;
  maintenance: number;
  net: number;
};
const financialPnlByDepot: ReportConfig<FinancialPnlByDepotRow> = {
  key: "financial.pnlByDepot",
  category: "financial",
  title: "P&L by depot",
  description: "Revenue, GST, damage recovery, and maintenance cost per depot.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFinancialPnlByDepot.useQuery({ from, to });
  },
  columns: [
    { id: "depot", header: "Depot", cell: (r) => r.depot, sortable: true, accessor: (r) => r.depot },
    { id: "revenue", header: "Revenue (inc GST)", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right", sortable: true, accessor: (r) => r.revenue },
    { id: "gst", header: "GST", cell: (r) => <span className="tabular-nums text-muted-foreground">{formatCurrency(r.gst)}</span>, align: "right", sortable: true, accessor: (r) => r.gst },
    { id: "maint", header: "Maintenance", cell: (r) => <span className="tabular-nums text-destructive">{formatCurrency(r.maintenance)}</span>, align: "right", sortable: true, accessor: (r) => r.maintenance },
    { id: "net", header: "Net (ex GST)", cell: (r) => <span className={"tabular-nums font-semibold " + (r.net >= 0 ? "text-foreground" : "text-destructive")}>{formatCurrency(r.net)}</span>, align: "right", sortable: true, accessor: (r) => r.net },
  ],
  getRowId: (r) => r.depot,
  emptyMessage: "No revenue data.",
  statWidgets: (rows) => {
    const totalRevenue = sum(rows, (r) => r.revenue);
    const totalGst = sum(rows, (r) => r.gst);
    const totalMaint = sum(rows, (r) => r.maintenance);
    const totalNet = sum(rows, (r) => r.net);
    return (
      <>
        <StatShell title="Revenue (inc GST)" icon={<DollarSign className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{formatCurrency(totalRevenue)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Across {rows.length} {rows.length === 1 ? "depot" : "depots"}</div>
        </StatShell>
        <StatShell title="GST vs ex-GST" icon={<Layers className="h-4 w-4" aria-hidden />}>
          <div className="mt-1">
            <MiniStackedBar
              segments={[
                { value: Math.max(0, totalRevenue - totalGst), colorVar: "--admin-accent" },
                { value: totalGst, colorVar: "--secondary" },
              ]}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">{formatCurrency(Math.max(0, totalRevenue - totalGst))} ex-GST</LegendDot>
            <LegendDot colorVar="--secondary">{formatCurrency(totalGst)} GST</LegendDot>
          </div>
        </StatShell>
        <StatShell title="Maintenance" icon={<Wrench className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums text-destructive">{formatCurrency(totalMaint)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {totalRevenue > 0 ? `${((totalMaint / totalRevenue) * 100).toFixed(1)}% of revenue` : "—"}
          </div>
        </StatShell>
        <StatShell title="Net by depot" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          <div className="space-y-1.5">
            {rows.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
            {rows.slice(0, 4).map((r) => (
              <PipelineRow
                key={r.depot}
                label={r.depot}
                value={Math.max(0, r.net)}
                total={Math.max(1, totalNet)}
                colorVar={r.net >= 0 ? "--admin-accent" : "--destructive"}
                formatValue={formatCurrency}
              />
            ))}
          </div>
        </StatShell>
      </>
    );
  },
};

type FinancialBondCaptureRow = { month: string; held: number; captured: number; released: number; captureRate: number };
const financialBondCapture: ReportConfig<FinancialBondCaptureRow> = {
  key: "financial.bondCapture",
  category: "financial",
  title: "Bond capture",
  description: "Held, captured, released and capture rate per period.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFinancialBondCapture.useQuery({ from, to });
  },
  columns: [
    { id: "month", header: "Month", cell: (r) => r.month },
    { id: "held", header: "Held", cell: (r) => <span className="tabular-nums">{formatCurrency(r.held)}</span>, align: "right", sortable: true, accessor: (r) => r.held },
    { id: "captured", header: "Captured", cell: (r) => <span className="tabular-nums text-destructive">{formatCurrency(r.captured)}</span>, align: "right", sortable: true, accessor: (r) => r.captured },
    { id: "released", header: "Released", cell: (r) => <span className="tabular-nums">{formatCurrency(r.released)}</span>, align: "right", sortable: true, accessor: (r) => r.released },
    { id: "rate", header: "Capture %", cell: (r) => <span className="tabular-nums">{(r.captureRate * 100).toFixed(2)}%</span>, align: "right", sortable: true, accessor: (r) => r.captureRate },
  ],
  getRowId: (r) => r.month,
  emptyMessage: "No bonds in this period.",
};

type FinancialDamageRecoveryRow = {
  id: string;
  booking: string;
  customer: string;
  charged: number;
  collected: number;
  status: string;
  createdAt: Date;
};
const financialDamageRecovery: ReportConfig<FinancialDamageRecoveryRow> = {
  key: "financial.damageRecovery",
  category: "financial",
  title: "Damage recovery",
  description: "Damage charges raised vs collected.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportFinancialDamageRecovery.useQuery({ from, to });
  },
  columns: [
    { id: "booking", header: "Booking", cell: (r) => <span className="font-mono text-xs">{r.booking}</span>, sortable: true, accessor: (r) => r.booking },
    { id: "customer", header: "Customer", cell: (r) => r.customer, sortable: true, accessor: (r) => r.customer },
    { id: "charged", header: "Charged", cell: (r) => <span className="tabular-nums">{formatCurrency(r.charged)}</span>, align: "right", sortable: true, accessor: (r) => r.charged },
    { id: "collected", header: "Collected", cell: (r) => <span className="tabular-nums text-foreground">{formatCurrency(r.collected)}</span>, align: "right", sortable: true, accessor: (r) => r.collected },
    { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status as StatusKey} /> },
    { id: "date", header: "Date", cell: (r) => formatDateTime(r.createdAt), sortable: true, accessor: (r) => r.createdAt },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No damage charges.",
};

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

type OperationalIncidentFrequencyRow = Record<string, string | number | undefined> & {
  month: string;
  total?: number;
};
const operationalIncidentFrequency: ReportConfig<OperationalIncidentFrequencyRow> = {
  key: "operational.incidentFrequency",
  category: "operational",
  title: "Incident frequency",
  description: "Incidents per month by severity and type.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportOperationalIncidentFrequency.useQuery({ from, to });
  },
  columns: [
    { id: "month", header: "Month", cell: (r) => r.month },
    { id: "total", header: "Total", cell: (r) => <span className="tabular-nums">{r.total ?? 0}</span>, align: "right", sortable: true, accessor: (r) => r.total ?? 0 },
    { id: "minor", header: "Minor", cell: (r) => <span className="tabular-nums">{(r.MINOR as number) ?? 0}</span>, align: "right" },
    { id: "moderate", header: "Moderate", cell: (r) => <span className="tabular-nums">{(r.MODERATE as number) ?? 0}</span>, align: "right" },
    { id: "major", header: "Major", cell: (r) => <span className="tabular-nums">{(r.MAJOR as number) ?? 0}</span>, align: "right" },
    { id: "total_loss", header: "Total loss", cell: (r) => <span className="tabular-nums">{(r.TOTAL_LOSS as number) ?? 0}</span>, align: "right" },
  ],
  getRowId: (r) => r.month,
  emptyMessage: "No incidents in this period.",
};

type OperationalInfringementsRow = { type: string; count: number; amount: number; recovered: number; recoveryRate: number };
const operationalInfringements: ReportConfig<OperationalInfringementsRow> = {
  key: "operational.infringements",
  category: "operational",
  title: "Infringement summary",
  description: "Infringements received, customer-liable, and recovered.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportOperationalInfringements.useQuery({ from, to });
  },
  columns: [
    { id: "type", header: "Type", cell: (r) => r.type, sortable: true, accessor: (r) => r.type },
    { id: "count", header: "Count", cell: (r) => <span className="tabular-nums">{r.count}</span>, align: "right", sortable: true, accessor: (r) => r.count },
    { id: "amount", header: "Total $", cell: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span>, align: "right", sortable: true, accessor: (r) => r.amount },
    { id: "recovered", header: "Recovered", cell: (r) => <span className="tabular-nums">{formatCurrency(r.recovered)}</span>, align: "right", sortable: true, accessor: (r) => r.recovered },
    { id: "rate", header: "Rate", cell: (r) => <span className="tabular-nums">{(r.recoveryRate * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.recoveryRate },
  ],
  getRowId: (r) => r.type,
  emptyMessage: "No infringements in this period.",
};

type OperationalStaffPerformanceRow = {
  id: string;
  name: string;
  checkouts: number;
  checkins: number;
  incidentsRaised: number;
};
const operationalStaffPerformance: ReportConfig<OperationalStaffPerformanceRow> = {
  key: "operational.staffPerformance",
  category: "operational",
  title: "Staff performance",
  description: "Bookings processed and inspections per staff member.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportOperationalStaffPerformance.useQuery({ from, to });
  },
  columns: [
    { id: "name", header: "Staff", cell: (r) => r.name, sortable: true, accessor: (r) => r.name },
    { id: "co", header: "Check-outs", cell: (r) => <span className="tabular-nums">{r.checkouts}</span>, align: "right", sortable: true, accessor: (r) => r.checkouts },
    { id: "ci", header: "Check-ins", cell: (r) => <span className="tabular-nums">{r.checkins}</span>, align: "right", sortable: true, accessor: (r) => r.checkins },
    { id: "incidents", header: "Incidents raised", cell: (r) => <span className="tabular-nums">{r.incidentsRaised}</span>, align: "right", sortable: true, accessor: (r) => r.incidentsRaised },
  ],
  getRowId: (r) => r.id,
  emptyMessage: "No staff activity in this period.",
};

type OperationalCheckTimesRow = {
  depot: string;
  avgCheckoutMin: number;
  avgCheckinMin: number;
  p90CheckoutMin: number;
  p90CheckinMin: number;
};
const operationalCheckTimes: ReportConfig<OperationalCheckTimesRow> = {
  key: "operational.checkTimes",
  category: "operational",
  title: "Check-in/out times",
  description: "Average and P90 check-out and check-in durations.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    return trpc.admin.reportOperationalCheckTimes.useQuery({ from, to });
  },
  columns: [
    { id: "depot", header: "Depot", cell: (r) => r.depot, sortable: true, accessor: (r) => r.depot },
    { id: "avgCo", header: "Avg checkout (min)", cell: (r) => <span className="tabular-nums">{r.avgCheckoutMin}</span>, align: "right", sortable: true, accessor: (r) => r.avgCheckoutMin },
    { id: "p90Co", header: "P90 checkout", cell: (r) => <span className="tabular-nums text-muted-foreground">{r.p90CheckoutMin}</span>, align: "right", sortable: true, accessor: (r) => r.p90CheckoutMin },
    { id: "avgCi", header: "Avg check-in (min)", cell: (r) => <span className="tabular-nums">{r.avgCheckinMin}</span>, align: "right", sortable: true, accessor: (r) => r.avgCheckinMin },
    { id: "p90Ci", header: "P90 check-in", cell: (r) => <span className="tabular-nums text-muted-foreground">{r.p90CheckinMin}</span>, align: "right", sortable: true, accessor: (r) => r.p90CheckinMin },
  ],
  getRowId: (r) => r.depot,
  emptyMessage: "No check events in this period.",
};

type StaffTasksByTypeRow = {
  taskType: string;
  total: number;
  completed: number;
  superseded: number;
  abandoned: number;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
  abandonRate: number;
  supersedeRate: number;
};

const TASK_TYPE_DISPLAY: Record<string, string> = {
  BOOKING_PICKUP: "Booking pickup",
  BOOKING_RETURN: "Booking return",
  BOOKING_OVERDUE_CHASE: "Overdue booking",
  INSPECTION_PRE_HIRE: "Pre-hire inspection",
  INSPECTION_POST_HIRE: "Post-hire inspection",
  MAINTENANCE_WORK_ORDER: "Work order",
  RENTAL_AGREEMENT_SIGN: "Rental agreement signature",
  RETURN_ASSESSMENT_FINALISE: "Return assessment finalise",
};

type StaffTasksByStaffRow = {
  staffId: string;
  staffName: string;
  total: number;
  completed: number;
  superseded: number;
  abandoned: number;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
  abandonRate: number;
  supersedeRate: number;
};

function formatDurationSec(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

const operationalStaffTasksByType: ReportConfig<StaffTasksByTypeRow> = {
  key: "operational.staffTasksByType",
  category: "operational",
  title: "Staff tasks by type",
  description:
    "Time spent per priority-task type across every staff member (pickups, returns, work orders, agreements, return assessments).",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    const res = trpc.staffTask.metrics.useQuery({ from, to });
    return {
      data: res.data?.byTaskType as StaffTasksByTypeRow[] | undefined,
      isLoading: res.isLoading,
    };
  },
  columns: [
    { id: "type", header: "Task type", cell: (r) => TASK_TYPE_DISPLAY[r.taskType] ?? r.taskType, sortable: true, accessor: (r) => TASK_TYPE_DISPLAY[r.taskType] ?? r.taskType },
    { id: "total", header: "Total", cell: (r) => <span className="tabular-nums">{r.total}</span>, align: "right", sortable: true, accessor: (r) => r.total },
    { id: "completed", header: "Completed", cell: (r) => <span className="tabular-nums">{r.completed}</span>, align: "right", sortable: true, accessor: (r) => r.completed },
    { id: "avg", header: "Avg time", cell: (r) => <span className="tabular-nums">{formatDurationSec(r.avgSeconds)}</span>, align: "right", sortable: true, accessor: (r) => r.avgSeconds },
    { id: "p50", header: "p50", cell: (r) => <span className="tabular-nums">{formatDurationSec(r.p50Seconds)}</span>, align: "right", sortable: true, accessor: (r) => r.p50Seconds },
    { id: "p95", header: "p95", cell: (r) => <span className="tabular-nums">{formatDurationSec(r.p95Seconds)}</span>, align: "right", sortable: true, accessor: (r) => r.p95Seconds },
    { id: "abandon", header: "Abandon %", cell: (r) => <span className="tabular-nums">{(r.abandonRate * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.abandonRate },
    { id: "supersede", header: "Superseded %", cell: (r) => <span className="tabular-nums">{(r.supersedeRate * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.supersedeRate },
  ],
  getRowId: (r) => r.taskType,
  emptyMessage: "No completed tasks in this period.",
};

const operationalStaffTasks: ReportConfig<StaffTasksByStaffRow> = {
  key: "operational.staffTasks",
  category: "operational",
  title: "Staff task performance",
  description:
    "Time spent per staff member across priority tasks (pickups, returns, work orders, agreements, return assessments), plus abandon and supersede rates.",
  filterFields: ["dateRange"],
  useQuery(filters) {
    const { from, to } = toDateRange(filters);
    const res = trpc.staffTask.metrics.useQuery({ from, to });
    return { data: res.data?.byStaff as StaffTasksByStaffRow[] | undefined, isLoading: res.isLoading };
  },
  columns: [
    { id: "name", header: "Staff", cell: (r) => r.staffName, sortable: true, accessor: (r) => r.staffName },
    { id: "total", header: "Total", cell: (r) => <span className="tabular-nums">{r.total}</span>, align: "right", sortable: true, accessor: (r) => r.total },
    { id: "completed", header: "Completed", cell: (r) => <span className="tabular-nums">{r.completed}</span>, align: "right", sortable: true, accessor: (r) => r.completed },
    { id: "avg", header: "Avg time", cell: (r) => <span className="tabular-nums">{formatDurationSec(r.avgSeconds)}</span>, align: "right", sortable: true, accessor: (r) => r.avgSeconds },
    { id: "p50", header: "p50", cell: (r) => <span className="tabular-nums">{formatDurationSec(r.p50Seconds)}</span>, align: "right", sortable: true, accessor: (r) => r.p50Seconds },
    { id: "p95", header: "p95", cell: (r) => <span className="tabular-nums">{formatDurationSec(r.p95Seconds)}</span>, align: "right", sortable: true, accessor: (r) => r.p95Seconds },
    { id: "abandon", header: "Abandon %", cell: (r) => <span className="tabular-nums">{(r.abandonRate * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.abandonRate },
    { id: "supersede", header: "Superseded %", cell: (r) => <span className="tabular-nums">{(r.supersedeRate * 100).toFixed(1)}%</span>, align: "right", sortable: true, accessor: (r) => r.supersedeRate },
  ],
  getRowId: (r) => r.staffId,
  emptyMessage: "No completed tasks in this period.",
  statWidgets: (rows) => {
    const totalTasks = sum(rows, (r) => r.total);
    const totalCompleted = sum(rows, (r) => r.completed);
    const totalAbandoned = sum(rows, (r) => r.abandoned);
    const totalSuperseded = sum(rows, (r) => r.superseded);
    const avgAcrossStaff = rows.length ? sum(rows, (r) => r.avgSeconds) / rows.length : 0;
    return (
      <>
        <StatShell title="Tasks logged" icon={<Layers className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{totalTasks.toLocaleString("en-AU")}</div>
          <div className="mt-1 text-xs text-muted-foreground">Across {rows.length} {rows.length === 1 ? "staff member" : "staff members"}</div>
        </StatShell>
        <StatShell title="Completed" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{totalCompleted.toLocaleString("en-AU")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {totalTasks ? `${((totalCompleted / totalTasks) * 100).toFixed(1)}% of logged tasks` : "—"}
          </div>
        </StatShell>
        <StatShell title="Avg time / task" icon={<BarChart3 className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">{formatDurationSec(Math.round(avgAcrossStaff))}</div>
          <div className="mt-1 text-xs text-muted-foreground">Mean of staff averages</div>
        </StatShell>
        <StatShell title="Abandon + superseded" icon={<Percent className="h-4 w-4" aria-hidden />}>
          <div className="font-display text-2xl font-semibold tabular-nums">
            {totalTasks ? `${(((totalAbandoned + totalSuperseded) / totalTasks) * 100).toFixed(1)}%` : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">{totalAbandoned} abandoned · {totalSuperseded} superseded</div>
        </StatShell>
      </>
    );
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const REPORT_CONFIGS: AnyReportConfig[] = [
  bookingsByPeriod,
  bookingsBySource,
  bookingsCancellations,
  bookingsLeadTime,
  bookingsNoShow,
  bookingsConversion,
  fleetUtilisation,
  fleetRevenuePerVehicle,
  fleetMaintenanceCost,
  fleetDowntime,
  fleetProfitability,
  fleetAgeOdometer,
  customersTop,
  customersNewVsReturning,
  customersLtv,
  customersAcquisition,
  customersGeographic,
  financialAging,
  financialRefundAnalysis,
  financialPnlByDepot,
  financialBondCapture,
  financialDamageRecovery,
  operationalIncidentFrequency,
  operationalInfringements,
  operationalStaffPerformance,
  operationalCheckTimes,
  operationalStaffTasks,
  operationalStaffTasksByType,
];

export const REPORT_CONFIG_BY_KEY: Record<string, AnyReportConfig> = Object.fromEntries(
  REPORT_CONFIGS.map((c) => [c.key, c]),
);

export function getReportConfig(key: string | null | undefined): AnyReportConfig | null {
  if (!key) return null;
  return REPORT_CONFIG_BY_KEY[key] ?? null;
}

export function getReportsByCategory(category: ReportCategory): AnyReportConfig[] {
  return REPORT_CONFIGS.filter((c) => c.category === category);
}
