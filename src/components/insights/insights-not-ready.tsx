"use client";

import * as React from "react";
import { Database } from "lucide-react";
import type { DataReadiness } from "@/server/services/insights/readiness";

interface Props {
  readiness: DataReadiness;
}

export function InsightsNotReady({ readiness }: Props) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Database className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="h3 mt-4">Not enough data yet to generate insights</h3>
      <p className="mx-auto mt-2 max-w-md text-caption text-muted-foreground">
        Insights only render once there is enough booking, customer and fleet
        history to be meaningful. The thresholds below still need to be met.
      </p>

      {readiness.missing.length > 0 && (
        <ul className="mx-auto mt-6 grid max-w-md gap-2 text-left">
          {readiness.missing.map((gap) => (
            <li
              key={gap.key}
              className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
            >
              <span className="text-caption text-foreground">{gap.label}</span>
              <span className="font-mono text-caption tabular-nums text-muted-foreground">
                {gap.have} / {gap.need}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-caption text-muted-foreground">
        Use <span className="font-medium text-foreground">Refresh insights</span>{" "}
        above to re-check once more data is recorded.
      </p>
    </div>
  );
}
