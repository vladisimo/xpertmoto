"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { X } from "lucide-react";
import { SessionDetailSheet } from "./session-detail-sheet";

type OutcomeFilter = "ALL" | "BOUNCED" | "ABANDONED_WIZARD" | "CONVERTED" | "LEFT";
type StaffFilter = "ALL" | "YES" | "NO";

type SessionRow = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  totalPageViews: number;
  wizardHighestStep: number | null;
  outcome: "BOUNCED" | "ABANDONED_WIZARD" | "CONVERTED" | "LEFT" | null;
  country: string | null;
  conversationId: string | null;
  landingPath: string | null;
  user: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  convertedBooking: { id: string; bookingReference: string; totalAmount: number } | null;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SessionsTab({ active }: { active: boolean }) {
  const [outcome, setOutcome] = React.useState<OutcomeFilter>("ALL");
  const [staffFilter, setStaffFilter] = React.useState<StaffFilter>("ALL");
  const [countryLocal, setCountryLocal] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const { filters, setFilters, hasDrilldown, clearDrilldown } = useAnalyticsFilters();

  // Drill-down filters from URL take precedence over the local country
  // input; if the URL is empty, fall back to local. Resetting the page
  // when any drill-down changes keeps the table in a predictable state.
  const effectiveCountry =
    filters.country ?? (countryLocal.trim().length === 2 ? countryLocal.trim().toUpperCase() : undefined);

  // Reset pagination when a URL-driven drill-down changes. Uses the
  // canonical "adjusting state on prop change" pattern (compare last
  // stored value during render) rather than an effect — the
  // react-hooks lint rule objects to both setState-in-effect and
  // ref-writes-during-render, so we store the key in state instead.
  const drillKey = [
    filters.country,
    filters.landing,
    filters.source,
    filters.medium,
    filters.campaign,
    filters.referrer,
    filters.step,
    filters.dow,
    filters.hour,
    filters.depot,
    filters.category,
    filters.vehicle,
    filters.code,
  ].join("|");
  const [lastDrillKey, setLastDrillKey] = React.useState(drillKey);
  if (lastDrillKey !== drillKey) {
    setLastDrillKey(drillKey);
    if (page !== 1) setPage(1);
  }

  const query = trpc.liveAnalytics.sessionsList.useQuery(
    {
      outcome: outcome === "ALL" ? undefined : outcome,
      staffInteracted: staffFilter === "ALL" ? undefined : staffFilter === "YES",
      country: effectiveCountry,
      landingPath: filters.landing ?? undefined,
      utmSource: filters.source ?? undefined,
      utmMedium: filters.medium ?? undefined,
      utmCampaign: filters.campaign ?? undefined,
      referrerDomain: filters.referrer ?? undefined,
      wizardStepEq: filters.step ?? undefined,
      hour: filters.hour ?? undefined,
      dow: filters.dow ?? undefined,
      pickupDepotId: filters.depot ?? undefined,
      categoryId: filters.category ?? undefined,
      vehicleId: filters.vehicle ?? undefined,
      discountCode: filters.code ?? undefined,
      segment: filters.segment,
      page,
      pageSize,
    },
    { enabled: active, refetchOnWindowFocus: false, staleTime: 30_000 },
  );

  const columns: DataTableColumn<SessionRow>[] = [
    {
      id: "visitor",
      header: "Visitor",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {r.user ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") || r.user.email : "Guest"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {r.country ?? "—"} · {r.landingPath ?? "/"}
          </p>
        </div>
      ),
    },
    {
      id: "started",
      header: "Started",
      cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.startedAt)}</span>,
      align: "left",
    },
    {
      id: "pages",
      header: "Pages",
      cell: (r) => <span className="tabular-nums text-sm">{r.totalPageViews}</span>,
      align: "right",
    },
    {
      id: "duration",
      header: "Duration",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.durationSeconds != null ? formatDuration(r.durationSeconds) : r.endedAt ? "—" : "live"}
        </span>
      ),
      align: "right",
    },
    {
      id: "step",
      header: "Highest step",
      cell: (r) => (
        <span className="text-sm">
          {r.wizardHighestStep ? `Step ${r.wizardHighestStep}` : <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: (r) =>
        r.outcome ? (
          <StatusBadge status={r.outcome === "BOUNCED" ? "VISITOR_BOUNCED" : r.outcome} />
        ) : (
          <span className="text-xs text-muted-foreground">pending</span>
        ),
    },
    {
      id: "staff",
      header: "Staff",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.conversationId ? "Chatted" : "—"}</span>
      ),
    },
    {
      id: "booking",
      header: "Booking",
      cell: (r) =>
        r.convertedBooking ? (
          <span className="font-mono text-xs text-primary">{r.convertedBooking.bookingReference}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Outcome</span>
          <Select value={outcome} onValueChange={(v) => { setOutcome(v as OutcomeFilter); setPage(1); }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="CONVERTED">Converted</SelectItem>
              <SelectItem value="ABANDONED_WIZARD">Abandoned wizard</SelectItem>
              <SelectItem value="BOUNCED">Bounced</SelectItem>
              <SelectItem value="LEFT">Left</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Staff chat</span>
          <Select value={staffFilter} onValueChange={(v) => { setStaffFilter(v as StaffFilter); setPage(1); }}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any</SelectItem>
              <SelectItem value="YES">Yes</SelectItem>
              <SelectItem value="NO">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Country</span>
          <Input
            value={filters.country ?? countryLocal}
            onChange={(e) => {
              const v = e.target.value;
              if (filters.country) setFilters({ country: null });
              setCountryLocal(v);
              setPage(1);
            }}
            placeholder="AU"
            maxLength={2}
            className="w-20"
          />
        </div>
        <div className="ml-auto">
          <Button type="button" variant="ghost" size="sm" onClick={() => query.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {hasDrilldown && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
          <span className="font-medium text-primary">Drill-down:</span>
          {filters.country && <FilterChip label={`Country: ${filters.country}`} onClear={() => setFilters({ country: null })} />}
          {filters.landing && <FilterChip label={`Landing: ${filters.landing}`} onClear={() => setFilters({ landing: null })} />}
          {filters.source && <FilterChip label={`UTM source: ${filters.source}`} onClear={() => setFilters({ source: null })} />}
          {filters.medium && <FilterChip label={`UTM medium: ${filters.medium}`} onClear={() => setFilters({ medium: null })} />}
          {filters.campaign && <FilterChip label={`UTM campaign: ${filters.campaign}`} onClear={() => setFilters({ campaign: null })} />}
          {filters.referrer && <FilterChip label={`Referrer: ${filters.referrer}`} onClear={() => setFilters({ referrer: null })} />}
          {filters.step != null && <FilterChip label={`Reached step ${filters.step}`} onClear={() => setFilters({ step: null })} />}
          {filters.dow != null && <FilterChip label={DOW_LABELS[filters.dow]!} onClear={() => setFilters({ dow: null })} />}
          {filters.hour != null && <FilterChip label={`${String(filters.hour).padStart(2, "0")}:00`} onClear={() => setFilters({ hour: null })} />}
          {filters.depot && <FilterChip label={`Depot: ${filters.depot}`} onClear={() => setFilters({ depot: null })} />}
          {filters.category && <FilterChip label={`Category: ${filters.category}`} onClear={() => setFilters({ category: null })} />}
          {filters.vehicle && <FilterChip label={`Vehicle: ${filters.vehicle}`} onClear={() => setFilters({ vehicle: null })} />}
          {filters.code && <FilterChip label={`Code: ${filters.code}`} onClear={() => setFilters({ code: null })} />}
          <Button type="button" variant="ghost" size="sm" onClick={clearDrilldown} className="ml-auto h-6 px-2 text-xs">
            Clear all
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable<SessionRow>
          columns={columns}
          data={query.isLoading ? undefined : ((query.data?.items ?? []) as SessionRow[])}
          isLoading={query.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => setSelectedId(r.id)}
          empty={<p className="py-4 text-sm text-muted-foreground">No sessions in range.</p>}
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? pageSize}
            totalCount={query.data?.totalCount ?? 0}
            pageCount={query.data?.pageCount ?? 1}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      </div>

      <SessionDetailSheet id={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/20">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="rounded-full hover:bg-primary/20"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
