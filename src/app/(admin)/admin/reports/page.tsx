"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Bike,
  Users,
  Banknote,
  AlertTriangle,
  Eye,
  Search,
  FileDown,
} from "lucide-react";
import { PageShell } from "@/components/layout/page-section";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  REPORT_CONFIGS,
  type AnyReportConfig,
  type ReportCategory,
} from "@/components/admin/report-configs";
import { ReportPreviewDialog } from "@/components/admin/report-preview-dialog";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<ReportCategory, React.ComponentType<{ className?: string }>> = {
  bookings: ArrowLeftRight,
  fleet: Bike,
  customers: Users,
  financial: Banknote,
  operational: AlertTriangle,
};

export default function ReportsLauncherPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlTab = searchParams.get("tab") as ReportCategory | null;
  const openReport = searchParams.get("report");

  const tab: ReportCategory =
    urlTab && CATEGORY_ORDER.includes(urlTab) ? urlTab : "bookings";

  const [query, setQuery] = React.useState("");

  const updateUrl = React.useCallback(
    (nextTab: ReportCategory, nextReport: string | null) => {
      const params = new URLSearchParams();
      params.set("tab", nextTab);
      if (nextReport) params.set("report", nextReport);
      router.replace(`/admin/reports?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  const handleTabChange = (value: string) => {
    updateUrl(value as ReportCategory, openReport);
  };

  const handleOpenReport = (key: string) => {
    const config = REPORT_CONFIGS.find((c) => c.key === key);
    const nextTab = config?.category ?? tab;
    updateUrl(nextTab, key);
  };

  const handleDialogChange = (open: boolean) => {
    if (!open) updateUrl(tab, null);
  };

  const trimmed = query.trim().toLowerCase();
  const searchResults = React.useMemo(() => {
    if (!trimmed) return null;
    return REPORT_CONFIGS.filter(
      (c) =>
        c.title.toLowerCase().includes(trimmed) ||
        c.description.toLowerCase().includes(trimmed),
    );
  }, [trimmed]);

  return (
    <>
      <PageShell>
        <PageHeader
          eyebrow="Administration"
          title="Reports"
          description="Preview any booking, fleet, customer, financial, or operational report in-browser, then export as CSV, Excel, or PDF."
          breadcrumbs={[
            { label: "Admin", href: "/admin" },
            { label: "Reports" },
          ]}
        />

        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports…"
            className="pl-9"
          />
        </div>

        {searchResults ? (
          <SearchResults
            results={searchResults}
            onOpen={handleOpenReport}
          />
        ) : (
          <Tabs value={tab} onValueChange={handleTabChange}>
            <MobileScrollTabs className="w-full justify-start sm:w-full">
              {CATEGORY_ORDER.map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                return (
                  <TabsTrigger key={cat} value={cat} className="gap-1.5">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {CATEGORY_LABELS[cat]}
                  </TabsTrigger>
                );
              })}
            </MobileScrollTabs>

            {CATEGORY_ORDER.map((cat) => {
              const reports = REPORT_CONFIGS.filter((c) => c.category === cat);
              return (
                <TabsContent key={cat} value={cat}>
                  <ReportGrid reports={reports} onOpen={handleOpenReport} />
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </PageShell>

      <ReportPreviewDialog reportKey={openReport} onOpenChange={handleDialogChange} />
    </>
  );
}

function SearchResults({
  results,
  onOpen,
}: {
  results: AnyReportConfig[];
  onOpen: (key: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
        No reports match your search.
      </div>
    );
  }
  return <ReportGrid reports={results} onOpen={onOpen} />;
}

function ReportGrid({
  reports,
  onOpen,
}: {
  reports: AnyReportConfig[];
  onOpen: (key: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {reports.map((r) => (
        <ReportCard key={r.key} config={r} onOpen={onOpen} />
      ))}
    </div>
  );
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
