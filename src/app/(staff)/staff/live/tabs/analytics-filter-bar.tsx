"use client";

import * as React from "react";
import { Bookmark, Check, Download, Printer, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc/client";
import type { SegmentFilter } from "@/lib/analytics/segments";
import {
  ANALYTICS_RANGE_LABEL,
  ANALYTICS_SEGMENT_LABEL,
  useAnalyticsFilters,
  type AnalyticsRange,
  type AnalyticsSegment,
} from "@/hooks/use-analytics-filters";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Global filter bar shown above every analytics tab. Controls map to
 * URL params so drill-downs and range changes survive reloads and can
 * be shared via URL. An optional `onExport` surfaces a CSV download
 * for the tab's data when wired up.
 */
export function AnalyticsFilterBar({
  description,
  onExport,
  exportLabel = "Export CSV",
}: {
  description: string;
  onExport?: () => void;
  exportLabel?: string;
}) {
  const { filters, setFilters, clearDrilldown, hasDrilldown } = useAnalyticsFilters();

  // Print-to-PDF: the @media print stylesheet in globals.css hides
  // chrome when `body.printing-analytics` is set. We set it before
  // calling print() and clear it on the matching `afterprint` event
  // (or an afterprint-less fallback timer for browsers that skip it).
  const handlePrint = React.useCallback(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("printing-analytics");
    const cleanup = () => {
      document.body.classList.remove("printing-analytics");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 30_000);
    window.print();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex flex-wrap items-center gap-2" data-analytics-print-hide>
          <SavedSegmentsMenu />
          <Select
            value={filters.segment}
            onValueChange={(v) => setFilters({ segment: v as AnalyticsSegment })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ANALYTICS_SEGMENT_LABEL) as AnalyticsSegment[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {ANALYTICS_SEGMENT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant={filters.compare ? "default" : "secondary"}
            onClick={() => setFilters({ compare: !filters.compare })}
            title="Compare to the previous period of the same length"
          >
            {filters.compare ? "Comparing" : "Compare"}
          </Button>
          <Select
            value={filters.range}
            onValueChange={(v) => setFilters({ range: v as AnalyticsRange })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ANALYTICS_RANGE_LABEL) as AnalyticsRange[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {ANALYTICS_RANGE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onExport && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onExport}
              className="gap-1"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {exportLabel}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handlePrint}
            className="gap-1"
            title="Opens the browser print dialog — pick 'Save as PDF' for a clean report"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Print
          </Button>
        </div>
      </div>
      {hasDrilldown && (
        <div
          data-analytics-print-hide
          className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs"
        >
          <span className="font-medium text-primary">Filtered:</span>
          {filters.country && (
            <FilterChip
              label={`Country: ${filters.country}`}
              onClear={() => setFilters({ country: null })}
            />
          )}
          {filters.landing && (
            <FilterChip
              label={`Landing: ${filters.landing}`}
              onClear={() => setFilters({ landing: null })}
            />
          )}
          {filters.source && (
            <FilterChip
              label={`UTM source: ${filters.source}`}
              onClear={() => setFilters({ source: null })}
            />
          )}
          {filters.medium && (
            <FilterChip
              label={`UTM medium: ${filters.medium}`}
              onClear={() => setFilters({ medium: null })}
            />
          )}
          {filters.campaign && (
            <FilterChip
              label={`UTM campaign: ${filters.campaign}`}
              onClear={() => setFilters({ campaign: null })}
            />
          )}
          {filters.referrer && (
            <FilterChip
              label={`Referrer: ${filters.referrer}`}
              onClear={() => setFilters({ referrer: null })}
            />
          )}
          {filters.step != null && (
            <FilterChip
              label={`Step ${filters.step}`}
              onClear={() => setFilters({ step: null })}
            />
          )}
          {filters.dow != null && (
            <FilterChip
              label={DOW_LABELS[filters.dow]!}
              onClear={() => setFilters({ dow: null })}
            />
          )}
          {filters.hour != null && (
            <FilterChip
              label={`${String(filters.hour).padStart(2, "0")}:00`}
              onClear={() => setFilters({ hour: null })}
            />
          )}
          {filters.depot && (
            <FilterChip
              label={`Depot: ${filters.depot}`}
              onClear={() => setFilters({ depot: null })}
            />
          )}
          {filters.category && (
            <FilterChip
              label={`Category: ${filters.category}`}
              onClear={() => setFilters({ category: null })}
            />
          )}
          {filters.vehicle && (
            <FilterChip
              label={`Vehicle: ${filters.vehicle}`}
              onClear={() => setFilters({ vehicle: null })}
            />
          )}
          {filters.code && (
            <FilterChip
              label={`Code: ${filters.code}`}
              onClear={() => setFilters({ code: null })}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearDrilldown}
            className="ml-auto h-6 px-2 text-xs"
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/20">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="rounded-full hover:bg-primary/20"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/**
 * Saved-segments dropdown + save-as dialog. Loads the list via tRPC,
 * applies a segment by writing its filter blob onto the URL via
 * `setFilters`, and lets staff save the current filter shape as a
 * new named segment. Segment owners + managers can delete.
 */
function SavedSegmentsMenu() {
  const { filters, setFilters } = useAnalyticsFilters();
  const utils = trpc.useUtils();
  const list = trpc.analyticsConfig.segmentsList.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const createSegment = trpc.analyticsConfig.segmentCreate.useMutation({
    onSuccess: () => utils.analyticsConfig.segmentsList.invalidate(),
  });
  const deleteSegment = trpc.analyticsConfig.segmentDelete.useMutation({
    onSuccess: () => utils.analyticsConfig.segmentsList.invalidate(),
  });
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  const handleApply = (segment: SegmentFilter) => {
    // Apply a saved segment by resetting the drill-down keys to null
    // and writing the segment's filter over the top. Range stays as
    // the user had it — saved segments don't override range.
    setFilters({
      country: segment.country ?? null,
      landing: segment.landingPath ?? null,
      source: segment.utmSource ?? null,
      medium: segment.utmMedium ?? null,
      campaign: segment.utmCampaign ?? null,
      referrer: segment.referrerDomain ?? null,
      step: segment.wizardStepEq ?? null,
      dow: segment.dow ?? null,
      hour: segment.hour ?? null,
      depot: segment.pickupDepotId ?? null,
      category: segment.categoryId ?? null,
      vehicle: segment.vehicleId ?? null,
      code: segment.discountCode ?? null,
      segment: segment.segment ?? "ALL",
    });
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Snapshot only the drill-down + segment fields; range intentionally
    // excluded so "Returning QLD users" isn't tied to a given window.
    await createSegment.mutateAsync({
      name: trimmed,
      filter: {
        segment: filters.segment,
        country: filters.country ?? undefined,
        landingPath: filters.landing ?? undefined,
        utmSource: filters.source ?? undefined,
        utmMedium: filters.medium ?? undefined,
        utmCampaign: filters.campaign ?? undefined,
        referrerDomain: filters.referrer ?? undefined,
        wizardStepEq: filters.step ?? undefined,
        dow: filters.dow ?? undefined,
        hour: filters.hour ?? undefined,
        pickupDepotId: filters.depot ?? undefined,
        categoryId: filters.category ?? undefined,
        vehicleId: filters.vehicle ?? undefined,
        discountCode: filters.code ?? undefined,
      },
      isShared: true,
    });
    setName("");
    setDialogOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary" size="sm" className="gap-1">
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
            Segments
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Saved segments</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {list.data && list.data.length > 0 ? (
            list.data.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => handleApply(s.filter)}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.name}</p>
                  {s.createdByName && (
                    <p className="truncate text-[10px] text-muted-foreground">
                      by {s.createdByName}
                    </p>
                  )}
                </div>
                {s.mine && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm(`Delete segment "${s.name}"?`)) {
                        deleteSegment.mutate({ id: s.id });
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              No saved segments yet.
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              setDialogOpen(true);
            }}
          >
            <Check className="mr-2 h-3.5 w-3.5" aria-hidden />
            Save current as segment…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save segment</DialogTitle>
            <DialogDescription>
              Captures the currently-applied filters so anyone on the team can reopen this
              view with one click. Range is not saved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm" htmlFor="segment-name">
              Segment name
            </label>
            <Input
              id="segment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VIP returning QLD mobile"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || createSegment.isPending}>
              {createSegment.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
