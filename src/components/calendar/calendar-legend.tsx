"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { STATUS_COLORS, LEGEND_STATUSES } from "./calendar-utils";

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <ArrowUpFromLine className="h-3 w-3" />
        <span>Pickup</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ArrowDownToLine className="h-3 w-3" />
        <span>Return</span>
      </div>
      <span className="text-muted-foreground/50">·</span>
      {LEGEND_STATUSES.map((status) => {
        const style = STATUS_COLORS[status];
        return (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: style.bg }}
            />
            <span>{style.label}</span>
          </div>
        );
      })}
    </div>
  );
}
