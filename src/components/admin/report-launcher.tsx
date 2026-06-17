"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Bike,
  Users,
  Banknote,
  AlertTriangle,
  Eye,
  FileDown,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  type AnyReportConfig,
  type ReportCategory,
} from "@/components/admin/report-configs";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<ReportCategory, React.ComponentType<{ className?: string }>> = {
  bookings: ArrowLeftRight,
  fleet: Bike,
  customers: Users,
  financial: Banknote,
  operational: AlertTriangle,
};

/**
 * Opens a report preview by writing `?report=<key>` onto the current route.
 * The dialog itself lives in the Reports section layout, so it stays mounted
 * across category routes and search results.
 */
export function useOpenReport() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return React.useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("report", key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );
}

export function ReportGrid({ reports }: { reports: AnyReportConfig[] }) {
  const onOpen = useOpenReport();
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {reports.map((r) => (
        <ReportCard key={r.key} config={r} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function SearchResults({ results }: { results: AnyReportConfig[] }) {
  if (results.length === 0) {
    return (
      <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
        No reports match your search.
      </div>
    );
  }
  return <ReportGrid reports={results} />;
}

function ReportCard({
  config,
  onOpen,
}: {
  config: AnyReportConfig;
  onOpen: (key: string) => void;
}) {
  const Icon = CATEGORY_ICONS[config.category];
  return (
    <button
      type="button"
      onClick={() => onOpen(config.key)}
      className={cn(
        "group flex h-full flex-col rounded-md border bg-card p-4 text-left shadow-sm transition-colors",
        "hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="font-display text-sm font-semibold text-foreground">
            {config.title}
          </h3>
        </div>
        <Eye
          className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden
        />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{config.description}</p>
      <div className="mt-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{CATEGORY_LABELS[config.category]}</span>
        <span className="inline-flex items-center gap-1">
          <FileDown className="h-3 w-3" aria-hidden />
          CSV · XLSX · PDF
        </span>
      </div>
    </button>
  );
}
