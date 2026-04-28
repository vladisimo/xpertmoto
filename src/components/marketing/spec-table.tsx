import { cn } from "@/lib/utils";

export interface SpecRow {
  label: string;
  value: React.ReactNode;
}

export interface SpecTableProps {
  rows: SpecRow[];
  className?: string;
}

/**
 * Dense label:value table for fleet cards, insurance details, depot cards.
 * Styled to read at a glance — muted caption on the left, body value on the right.
 */
export function SpecTable({ rows, className }: SpecTableProps) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 py-2">
          <dt className="caption uppercase tracking-[0.06em]">{r.label}</dt>
          <dd className="text-sm font-medium text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
