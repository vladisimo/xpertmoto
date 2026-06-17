"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { Input } from "@/components/ui/input";
import { REPORT_CONFIGS } from "@/components/admin/report-configs";
import { ReportPreviewDialog } from "@/components/admin/report-preview-dialog";
import { ReportsTabsBar } from "@/components/admin/reports-tabs-bar";
import { SearchResults } from "@/components/admin/report-launcher";

/**
 * Reports section shell. The cross-category search box and the report preview
 * dialog are layout-level so they persist across the category tab routes; when
 * a search is active it replaces the active category's grid.
 */
export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openReport = searchParams.get("report");

  const [query, setQuery] = React.useState("");
  const trimmed = query.trim().toLowerCase();
  const searchResults = React.useMemo(() => {
    if (!trimmed) return null;
    return REPORT_CONFIGS.filter(
      (c) =>
        c.title.toLowerCase().includes(trimmed) ||
        c.description.toLowerCase().includes(trimmed),
    );
  }, [trimmed]);

  const handleDialogChange = (open: boolean) => {
    if (open) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("report");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <SectionShell section="reports">
      <PageShell>
        <PageHeader
          eyebrow="Administration"
          title="Reports"
          description="Preview any booking, fleet, customer, financial, or operational report in-browser, then export as CSV, Excel, or PDF."
          breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Reports" }]}
        />

        <ReportsTabsBar />

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

        {searchResults ? <SearchResults results={searchResults} /> : children}
      </PageShell>

      <ReportPreviewDialog reportKey={openReport} onOpenChange={handleDialogChange} />
    </SectionShell>
  );
}
