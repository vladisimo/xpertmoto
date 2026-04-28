"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RangeKey = "7D" | "30D" | "QTD";

type Row = {
  staffId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  interactions: number;
  avgResponseSeconds: number | null;
  conversionRate: number;
  revenueAud: number;
};

function rangeBounds(r: RangeKey): { from: Date } {
  const from = new Date();
  if (r === "7D") from.setDate(from.getDate() - 7);
  else if (r === "30D") from.setDate(from.getDate() - 30);
  else from.setDate(from.getDate() - 90);
  return { from };
}

export function SalesPerformanceTab({ active }: { active: boolean }) {
  const [range, setRange] = React.useState<RangeKey>("30D");
  const { from } = rangeBounds(range);
  const query = trpc.liveAnalytics.salesPerformance.useQuery(
    { from },
    { enabled: active, refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  const rows = (query.data?.rows ?? []) as Row[];

  const columns: DataTableColumn<Row>[] = [
    {
      id: "staff",
      header: "Staff",
      cell: (r) => (
        <div>
          <p className="text-sm font-medium">
            {[r.firstName, r.lastName].filter(Boolean).join(" ") || r.email}
          </p>
          <p className="text-xs text-muted-foreground">{r.email}</p>
        </div>
      ),
    },
    {
      id: "interactions",
      header: "Interactions",
      cell: (r) => <span className="tabular-nums text-sm">{r.interactions}</span>,
      align: "right",
    },
    {
      id: "avgResponse",
      header: "Avg first response",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.avgResponseSeconds != null ? formatSeconds(r.avgResponseSeconds) : <span className="text-muted-foreground">—</span>}
        </span>
      ),
      align: "right",
    },
    {
      id: "conversion",
      header: "Conversion",
      cell: (r) => <span className="tabular-nums text-sm">{(r.conversionRate * 100).toFixed(1)}%</span>,
      align: "right",
    },
    {
      id: "revenue",
      header: "Revenue attributed",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">
          ${r.revenueAud.toLocaleString("en-AU", { minimumFractionDigits: 2 })}
        </span>
      ),
      align: "right",
    },
  ];

  const totals = rows.reduce(
    (acc, r) => ({
      interactions: acc.interactions + r.interactions,
      revenue: acc.revenue + r.revenueAud,
      converted: acc.converted + r.conversionRate * r.interactions,
    }),
    { interactions: 0, revenue: 0, converted: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Range</span>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7D">Last 7 days</SelectItem>
              <SelectItem value="30D">Last 30 days</SelectItem>
              <SelectItem value="QTD">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Total interactions: <span className="tabular-nums text-foreground">{totals.interactions}</span>
          </span>
          <span className="text-muted-foreground">
            Team conversion:{" "}
            <span className="tabular-nums text-foreground">
              {totals.interactions > 0 ? `${((totals.converted / totals.interactions) * 100).toFixed(1)}%` : "—"}
            </span>
          </span>
          <span className="text-muted-foreground">
            Revenue attributed:{" "}
            <span className="tabular-nums font-semibold text-foreground">
              ${totals.revenue.toLocaleString("en-AU", { minimumFractionDigits: 2 })}
            </span>
          </span>
        </div>
      </div>

      <DataTable<Row>
        columns={columns}
        data={query.isLoading ? undefined : rows}
        isLoading={query.isLoading}
        getRowId={(r) => r.staffId}
        empty={<p className="py-4 text-sm text-muted-foreground">No staff activity in this range.</p>}
      />
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
