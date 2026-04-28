"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function StatShell({
  children,
  title,
  icon,
}: {
  children: React.ReactNode;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function LoadingBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

export function LegendDot({
  colorVar,
  opacity = 1,
  children,
}: {
  colorVar: string;
  opacity?: number;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: `hsl(var(${colorVar}) / ${opacity})` }}
      />
      {children}
    </span>
  );
}

export function PipelineRow({
  label,
  value,
  total,
  colorVar,
  hint,
  formatValue,
}: {
  label: string;
  value: number;
  total: number;
  colorVar: string;
  hint?: string;
  formatValue?: (n: number) => string;
}) {
  const share = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const display = formatValue ? formatValue(value) : value.toLocaleString("en-AU");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">
          {label}
          {hint && <span className="ml-1 text-muted-foreground/70">· {hint}</span>}
        </span>
        <span className="font-display text-sm font-semibold tabular-nums text-foreground">
          {display}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${share}%`, backgroundColor: `hsl(var(${colorVar}))` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

export interface StackedBarSegment {
  value: number;
  colorVar: string;
  opacity?: number;
  label?: string;
}

export function MiniStackedBar({
  segments,
  height = "h-1.5",
}: {
  segments: StackedBarSegment[];
  height?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return (
      <div className={cn("w-full overflow-hidden rounded-full bg-muted", height)} aria-hidden />
    );
  }
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-muted", height)}>
      {segments.map((s, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: `${(s.value / total) * 100}%`,
            backgroundColor: `hsl(var(${s.colorVar}) / ${s.opacity ?? 1})`,
          }}
          aria-hidden
        />
      ))}
    </div>
  );
}
