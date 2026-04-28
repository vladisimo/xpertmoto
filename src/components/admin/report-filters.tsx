"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DepotSelect } from "@/components/admin/depot-select";

export type PeriodBucket = "day" | "week" | "month";

export interface ReportFilterState {
  from: string;
  to: string;
  depotId: string | undefined;
  period: PeriodBucket;
}

export type ReportFilterField = "dateRange" | "depot" | "period";

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(now) };
}

export function useReportFilters(
  initial?: Partial<ReportFilterState>,
): [ReportFilterState, (next: Partial<ReportFilterState>) => void] {
  const defaults = defaultDateRange();
  const [state, setState] = React.useState<ReportFilterState>({
    from: initial?.from ?? defaults.from,
    to: initial?.to ?? defaults.to,
    depotId: initial?.depotId,
    period: initial?.period ?? "day",
  });
  const update = React.useCallback(
    (next: Partial<ReportFilterState>) => setState((prev) => ({ ...prev, ...next })),
    [],
  );
  return [state, update];
}

export function ReportFilters({
  fields,
  idPrefix,
  filters,
  onFilterChange,
}: {
  fields: readonly ReportFilterField[];
  idPrefix: string;
  filters: ReportFilterState;
  onFilterChange: (next: Partial<ReportFilterState>) => void;
}) {
  const showDate = fields.includes("dateRange");
  const showDepot = fields.includes("depot");
  const showPeriod = fields.includes("period");

  if (!showDate && !showDepot && !showPeriod) return null;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4 shadow-sm [&>div]:w-full sm:[&>div]:w-auto">
      {showDate && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-from`} className="text-xs uppercase tracking-wider text-muted-foreground">
              From
            </Label>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              value={filters.from}
              onChange={(e) => onFilterChange({ from: e.target.value })}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-to`} className="text-xs uppercase tracking-wider text-muted-foreground">
              To
            </Label>
            <Input
              id={`${idPrefix}-to`}
              type="date"
              value={filters.to}
              onChange={(e) => onFilterChange({ to: e.target.value })}
              className="w-full sm:w-[160px]"
            />
          </div>
        </>
      )}
      {showDepot && (
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Depot</Label>
          <DepotSelect
            value={filters.depotId}
            onChange={(id) => onFilterChange({ depotId: id })}
          />
        </div>
      )}
      {showPeriod && (
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bucket</Label>
          <Select
            value={filters.period}
            onValueChange={(v) => onFilterChange({ period: v as PeriodBucket })}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function isFilterInvalid(filters: ReportFilterState, fields: readonly ReportFilterField[]): boolean {
  if (!fields.includes("dateRange")) return false;
  return new Date(filters.from) > new Date(filters.to);
}

export function buildExportParams(
  filters: ReportFilterState,
  fields: readonly ReportFilterField[],
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  if (fields.includes("dateRange")) {
    params.from = filters.from;
    params.to = filters.to;
  }
  if (fields.includes("depot")) {
    params.depotId = filters.depotId;
  }
  if (fields.includes("period")) {
    params.period = filters.period;
  }
  return params;
}
