"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { RepeatCohortPayload } from "@/server/services/insights/types";

interface Props {
  payload: RepeatCohortPayload;
  compact?: boolean;
}

/**
 * Monthly cohort retention heatmap. Rows are the cohort month (new
 * customers who took their first hire that month). Columns are M+1..M+6
 * — the share of that cohort who came back N months later. Cell colour is
 * `--insights-accent` with opacity derived from the return rate.
 */
export function CohortHeatmap({ payload, compact }: Props) {
  const cohorts = payload.cohorts.filter((c) => c.newCustomers > 0);
  if (cohorts.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-caption text-muted-foreground">
        Not enough cohort data yet.
      </div>
    );
  }

  const cellSize = compact ? "h-6 w-10" : "h-8 w-14";
  const monthLabels = Array.from({ length: 6 }, (_, i) => `M+${i + 1}`);

  return (
    <div className="w-full overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card text-left font-medium text-muted-foreground">
              Cohort
            </th>
            <th className="text-right font-medium text-muted-foreground">
              Size
            </th>
            {monthLabels.map((m) => (
              <th key={m} className="text-center font-medium text-muted-foreground">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohortMonth}>
              <td className="sticky left-0 z-10 bg-card pr-2 text-foreground tabular-nums">
                {c.cohortMonth}
              </td>
              <td className="pr-2 text-right text-muted-foreground tabular-nums">
                {c.newCustomers}
              </td>
              {c.returnedByMonth.slice(0, 6).map((v, i) => {
                const rate = c.newCustomers > 0 ? v / c.newCustomers : 0;
                return (
                  <td key={i}>
                    <div
                      className={cn(
                        "flex items-center justify-center rounded-md text-[10px] font-medium tabular-nums text-foreground",
                        cellSize,
                      )}
                      style={{
                        backgroundColor: `hsl(var(--insights-accent) / ${0.08 + rate * 0.9})`,
                      }}
                      aria-label={`${Math.round(rate * 100)}% returned in month ${i + 1}`}
                    >
                      {rate > 0.02 ? `${Math.round(rate * 100)}%` : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
