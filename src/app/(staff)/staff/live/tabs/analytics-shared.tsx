"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Inline ±X% delta used next to summary stats on the Overview tab when
 * compare-to-previous is enabled. Positive is green for "more is better"
 * metrics (sessions, conversion) and red for negatives like bounce.
 * Opt-in via `betterWhen` — defaults to "up".
 */
export function DeltaBadge({
  current,
  previous,
  betterWhen = "up",
  format = "pct-change",
}: {
  current: number;
  previous: number | null | undefined;
  betterWhen?: "up" | "down";
  format?: "pct-change" | "pp-delta";
}) {
  if (previous == null) return null;
  let display: string;
  let direction: "up" | "down" | "flat";
  if (format === "pp-delta") {
    const delta = (current - previous) * 100;
    display = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`;
    direction = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  } else {
    if (previous === 0) {
      display = current > 0 ? "new" : "—";
      direction = current > 0 ? "up" : "flat";
    } else {
      const change = (current - previous) / Math.abs(previous);
      display = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
      direction = change > 0.005 ? "up" : change < -0.005 ? "down" : "flat";
    }
  }
  const good =
    direction === "flat" ? "neutral" : (direction === "up") === (betterWhen === "up") ? "good" : "bad";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        good === "good" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        good === "bad" && "bg-red-500/10 text-red-700 dark:text-red-300",
        good === "neutral" && "bg-muted text-muted-foreground",
      )}
      title={`vs previous period${previous != null ? ` (was ${previous.toLocaleString("en-AU")})` : ""}`}
    >
      {direction === "up" ? (
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      ) : direction === "down" ? (
        <ArrowDownRight className="h-3 w-3" aria-hidden />
      ) : (
        <Minus className="h-3 w-3" aria-hidden />
      )}
      {display}
    </span>
  );
}

/**
 * Day-of-week × hour-of-day heatmap. Clicking a cell drills into the
 * Sessions tab filtered to that DoW + hour combination.
 */
export function DayHourHeatmap({
  matrix,
  onCellClick,
}: {
  matrix: Array<{ dow: number; hour: number; count: number }>;
  onCellClick?: (dow: number, hour: number) => void;
}) {
  const max = Math.max(1, ...matrix.map((c) => c.count));
  const grouped: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const c of matrix) {
    if (grouped[c.dow]) grouped[c.dow]![c.hour] = c.count;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="w-10 text-left text-[10px] font-normal text-muted-foreground" />
            {Array.from({ length: 24 }, (_, h) => (
              <th
                key={h}
                className="h-6 text-center text-[9px] font-normal text-muted-foreground"
                style={{ width: 18 }}
              >
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map((row, d) => (
            <tr key={d}>
              <td className="pr-2 text-[10px] text-muted-foreground">{DOW_LABELS[d]}</td>
              {row.map((v, h) => {
                const intensity = v / max;
                const hasValue = v > 0;
                const clickable = !!onCellClick;
                return (
                  <td key={h} style={{ width: 18 }}>
                    <button
                      type="button"
                      onClick={clickable && hasValue ? () => onCellClick(d, h) : undefined}
                      disabled={!clickable || !hasValue}
                      className={cn(
                        "h-4 w-full rounded-sm transition",
                        clickable && hasValue && "hover:ring-1 hover:ring-primary",
                        !hasValue && "bg-muted",
                      )}
                      style={
                        hasValue
                          ? { backgroundColor: `hsl(var(--primary) / ${0.1 + intensity * 0.9})` }
                          : undefined
                      }
                      aria-label={`${DOW_LABELS[d]} ${String(h).padStart(2, "0")}:00 — ${v}`}
                      title={`${DOW_LABELS[d]} ${String(h).padStart(2, "0")}:00 · ${v.toLocaleString("en-AU")}`}
                    />
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

/** Thin row showing a label + count + bar. Reused across all tabs. */
export function RankedRow({
  label,
  value,
  total,
  colorVar = "--primary",
  hint,
  onClick,
}: {
  label: React.ReactNode;
  value: number;
  total: number;
  colorVar?: string;
  hint?: string;
  onClick?: () => void;
}) {
  const share = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-foreground">
          {label}
          {hint && <span className="ml-1 text-muted-foreground/80">· {hint}</span>}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {value.toLocaleString("en-AU")}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${share}%`, backgroundColor: `hsl(var(${colorVar}))` }}
          aria-hidden
        />
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full rounded p-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {body}
      </button>
    );
  }
  return <div className="p-1">{body}</div>;
}

/**
 * Helper for drill-down: returns a click handler that jumps the Sessions
 * tab with URL-encoded filters applied. Used by every ranked list and
 * chart on the analytics tabs.
 */
export function useDrilldown() {
  const { setFilters } = useAnalyticsFilters();
  const router = useRouter();
  return React.useCallback(
    (
      patch: Parameters<ReturnType<typeof useAnalyticsFilters>["setFilters"]>[0],
      opts: { jumpToSessions?: boolean } = { jumpToSessions: true },
    ) => {
      setFilters(patch);
      if (opts.jumpToSessions && typeof window !== "undefined") {
        // setFilters has already written the drill-down params; we just
        // flip the `tab` param to "sessions" without wiping the others.
        const next = new URL(window.location.href);
        next.searchParams.set("tab", "sessions");
        router.replace(next.pathname + (next.search || ""), { scroll: false });
      }
    },
    [setFilters, router],
  );
}

export { DOW_LABELS };
