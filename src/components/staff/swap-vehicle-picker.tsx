"use client";

import * as React from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingBlock } from "@/components/ui/spinner";
import {
  VehicleFilterBar,
  DEFAULT_FILTERS,
  type VehicleFilters,
} from "@/components/booking/vehicle-filter-bar";
import { VehicleCard, type VehicleCardVehicle } from "@/components/booking/vehicle-card";

type SwapCandidate =
  inferRouterOutputs<AppRouter>["bookingSwap"]["listCandidates"]["vehicles"][number];

type ConditionFilter = "all" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR";

const CONDITION_LABELS: Record<Exclude<ConditionFilter, "all">, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
};

// Make/model in the imported inventory has case drift (`HONDA` vs `Honda`).
// Normalise to a lowercased key for both dedupe and matching, mirroring the
// public VehiclePicker.
const normKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function dedupeByKey(values: string[]) {
  const seen = new Map<string, string>();
  for (const v of values) {
    const k = normKey(v);
    if (!seen.has(k)) seen.set(k, v);
  }
  return Array.from(seen.values()).sort();
}

export function SwapVehiclePicker({
  vehicles,
  currentCategoryId,
  selectedId,
  onSelect,
  includeCrossCategory,
  onIncludeCrossCategoryChange,
  showCrossCategoryToggle,
  isLoading,
}: {
  vehicles: SwapCandidate[];
  currentCategoryId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  includeCrossCategory: boolean;
  onIncludeCrossCategoryChange: (value: boolean) => void;
  showCrossCategoryToggle: boolean;
  isLoading: boolean;
}) {
  const [filters, setFilters] = React.useState<VehicleFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = React.useState("");
  const [condition, setCondition] = React.useState<ConditionFilter>("all");
  const [hideDocExpiry, setHideDocExpiry] = React.useState(false);

  // Only physically available units are selectable.
  const free = React.useMemo(() => vehicles.filter((v) => v.free), [vehicles]);

  const makeOptions = React.useMemo(() => dedupeByKey(free.map((v) => v.make)), [free]);
  const modelOptions = React.useMemo(() => {
    const pool =
      filters.make === "all"
        ? free
        : free.filter((v) => normKey(v.make) === normKey(filters.make));
    return dedupeByKey(pool.map((v) => v.model));
  }, [free, filters.make]);
  const colourOptions = React.useMemo(() => dedupeByKey(free.map((v) => v.colour)), [free]);

  const filtered = React.useMemo(() => {
    const q = normKey(search);
    const list = free.filter((v) => {
      if (filters.make !== "all" && normKey(v.make) !== normKey(filters.make)) return false;
      if (filters.model !== "all" && normKey(v.model) !== normKey(filters.model)) return false;
      if (filters.colour !== "all" && normKey(v.colour) !== normKey(filters.colour)) return false;
      if (condition !== "all" && v.condition !== condition) return false;
      if (hideDocExpiry && v.docsExpiringDuringRental.length > 0) return false;
      if (q) {
        const haystack = normKey(
          `${v.internalCode} ${v.rego} ${v.make} ${v.model} ${v.colour}`,
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // One card per physical unit — no make/model grouping.
    const sorted = [...list];
    switch (filters.sort) {
      case "year-desc":
        sorted.sort(
          (a, b) =>
            b.year - a.year ||
            a.currentOdometerKm - b.currentOdometerKm ||
            a.internalCode.localeCompare(b.internalCode),
        );
        break;
      case "make-asc":
        sorted.sort(
          (a, b) =>
            `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`) ||
            a.internalCode.localeCompare(b.internalCode),
        );
        break;
      default:
        sorted.sort(
          (a, b) =>
            a.currentOdometerKm - b.currentOdometerKm ||
            a.internalCode.localeCompare(b.internalCode),
        );
    }
    return sorted;
  }, [free, filters, search, condition, hideDocExpiry]);

  const isFiltered =
    search.trim() !== "" || condition !== "all" || hideDocExpiry;

  const clearAll = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    setCondition("all");
    setHideDocExpiry(false);
  };

  if (isLoading) return <LoadingBlock padded="md" />;

  if (free.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No candidate vehicles found for the remaining rental window.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <VehicleFilterBar
        filters={filters}
        onChange={setFilters}
        makeOptions={makeOptions}
        modelOptions={modelOptions}
        colourOptions={colourOptions}
        resultCount={filtered.length}
        onClear={clearAll}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search code, rego, make, model…"
      />

      {/* Staff-specific controls — condition, cross-category, doc-expiry. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Condition</span>
          <Select
            value={condition}
            onValueChange={(v) => setCondition(v as ConditionFilter)}
          >
            <SelectTrigger className="h-8 w-[130px]" aria-label="Filter by condition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any condition</SelectItem>
              {(Object.keys(CONDITION_LABELS) as Array<keyof typeof CONDITION_LABELS>).map(
                (c) => (
                  <SelectItem key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hideDocExpiry}
            onChange={(e) => setHideDocExpiry(e.target.checked)}
          />
          Hide doc-expiry risk
        </label>

        {showCrossCategoryToggle && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeCrossCategory}
              onChange={(e) => onIncludeCrossCategoryChange(e.target.checked)}
            />
            Include other categories
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No vehicles match these filters.
          {isFiltered && (
            <button
              type="button"
              onClick={clearAll}
              className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="md:max-h-[60vh] md:overflow-y-auto md:rounded-md md:border md:border-border md:bg-muted/20 md:p-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {filtered.map((v) => {
              const card: VehicleCardVehicle = {
                id: v.id,
                make: v.make,
                model: v.model,
                year: v.year,
                colour: v.colour,
                condition: v.condition as VehicleCardVehicle["condition"],
                currentOdometerKm: v.currentOdometerKm,
                internalCode: v.internalCode,
                category: { name: v.categoryName, engineCapacity: v.engineCapacity },
                depot: { name: v.depotName },
                images: v.images,
              };
              const differentCategory = v.categoryId !== currentCategoryId;
              return (
                <VehicleCard
                  key={v.id}
                  vehicle={card}
                  selected={selectedId === v.id}
                  onSelect={() => onSelect(v.id)}
                  subtitle={`${v.internalCode} · ${v.rego}`}
                  secondaryBadge={
                    differentCategory ? (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {v.categoryName}
                      </span>
                    ) : undefined
                  }
                  notice={
                    v.docsExpiringDuringRental.length > 0
                      ? `⚠️ ${v.docsExpiringDuringRental.join(", ")} expires during rental`
                      : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
