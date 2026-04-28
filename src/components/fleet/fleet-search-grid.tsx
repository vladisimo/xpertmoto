"use client";

import * as React from "react";
import { X } from "lucide-react";
import { FleetUseCase } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { VehicleMakeLogo } from "@/components/booking/vehicle-make-logo";
import { ModelCard } from "@/components/fleet/model-card";

export interface FleetSearchModel {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  tagline: string | null;
  useCases: FleetUseCase[];
  colours: string[];
  primaryImageUrl: string | null;
  availableCount: number;
  category: {
    id: string;
    licenceRequired: string;
    baseDailyRate: number;
  };
}

type SortKey = "available-desc" | "price-asc" | "year-desc" | "make-asc";

type Filters = {
  make: string;
  model: string;
  colour: string;
  sort: SortKey;
};

const DEFAULT_FILTERS: Filters = {
  make: "all",
  model: "all",
  colour: "all",
  sort: "available-desc",
};

export function FleetSearchGrid({ models }: { models: FleetSearchModel[] }) {
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);

  const makeOptions = React.useMemo(
    () => Array.from(new Set(models.map((m) => m.make))).sort(),
    [models],
  );
  const modelOptions = React.useMemo(() => {
    const pool =
      filters.make === "all" ? models : models.filter((m) => m.make === filters.make);
    return Array.from(new Set(pool.map((m) => m.model))).sort();
  }, [models, filters.make]);
  const colourOptions = React.useMemo(
    () => Array.from(new Set(models.flatMap((m) => m.colours))).sort(),
    [models],
  );

  const filtered = React.useMemo(() => {
    const base = models.filter((m) => {
      if (filters.make !== "all" && m.make !== filters.make) return false;
      if (filters.model !== "all" && m.model !== filters.model) return false;
      if (filters.colour !== "all" && !m.colours.includes(filters.colour)) return false;
      return true;
    });
    const sorted = [...base];
    switch (filters.sort) {
      case "price-asc":
        sorted.sort(
          (a, b) =>
            a.category.baseDailyRate - b.category.baseDailyRate ||
            a.make.localeCompare(b.make),
        );
        break;
      case "year-desc":
        sorted.sort((a, b) => b.year - a.year || a.make.localeCompare(b.make));
        break;
      case "make-asc":
        sorted.sort((a, b) =>
          `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`),
        );
        break;
      default:
        sorted.sort(
          (a, b) =>
            b.availableCount - a.availableCount ||
            a.make.localeCompare(b.make) ||
            a.model.localeCompare(b.model),
        );
    }
    return sorted;
  }, [models, filters]);

  const isFiltered =
    filters.make !== "all" ||
    filters.model !== "all" ||
    filters.colour !== "all" ||
    filters.sort !== DEFAULT_FILTERS.sort;

  const onClear = () => setFilters(DEFAULT_FILTERS);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-row items-center gap-2">
          <Select
            value={filters.make}
            onValueChange={(value) =>
              setFilters({ ...filters, make: value, model: "all" })
            }
          >
            <SelectTrigger className="min-w-0 flex-1" aria-label="Filter by make">
              <SelectValue>
                {filters.make === "all" ? (
                  <span className="text-muted-foreground">Make</span>
                ) : (
                  <span className="inline-flex items-center gap-2 truncate">
                    <VehicleMakeLogo make={filters.make} size={16} />
                    <span className="truncate">{filters.make}</span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any make</SelectItem>
              {makeOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  <span className="inline-flex items-center gap-2">
                    <VehicleMakeLogo make={m} size={16} />
                    {m}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.model}
            onValueChange={(value) => setFilters({ ...filters, model: value })}
          >
            <SelectTrigger className="min-w-0 flex-1" aria-label="Filter by model">
              <SelectValue>
                {filters.model === "all" ? (
                  <span className="text-muted-foreground">Model</span>
                ) : (
                  <span className="truncate">{filters.model}</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any model</SelectItem>
              {modelOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.colour}
            onValueChange={(value) => setFilters({ ...filters, colour: value })}
          >
            <SelectTrigger className="min-w-0 flex-1" aria-label="Filter by colour">
              <SelectValue>
                {filters.colour === "all" ? (
                  <span className="text-muted-foreground">Colour</span>
                ) : (
                  <span className="truncate">{filters.colour}</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any colour</SelectItem>
              {colourOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.sort}
            onValueChange={(value) =>
              setFilters({ ...filters, sort: value as SortKey })
            }
          >
            <SelectTrigger className="min-w-0 flex-1" aria-label="Sort fleet">
              <SelectValue>
                {filters.sort === "available-desc" ? (
                  <span className="text-muted-foreground">Sort</span>
                ) : filters.sort === "price-asc" ? (
                  <span className="truncate">Price</span>
                ) : filters.sort === "year-desc" ? (
                  <span className="truncate">Newest</span>
                ) : (
                  <span className="truncate">A–Z</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available-desc">Most available</SelectItem>
              <SelectItem value="price-asc">Price: low to high</SelectItem>
              <SelectItem value="year-desc">Newest first</SelectItem>
              <SelectItem value="make-asc">Make A–Z</SelectItem>
            </SelectContent>
          </Select>

          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="shrink-0"
              aria-label="Clear filters"
            >
              <X className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>
        <div className="mt-1.5 text-xs tabular-nums text-muted-foreground">
          {filtered.length === models.length
            ? `${models.length} ${models.length === 1 ? "bike" : "bikes"}`
            : `${filtered.length} of ${models.length} ${
                models.length === 1 ? "bike" : "bikes"
              } shown`}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 p-10 text-center">
          <p className="text-lg font-medium">No bikes match these filters.</p>
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((m) => (
            <ModelCard
              key={m.id}
              slug={m.slug}
              make={m.make}
              model={m.model}
              year={m.year}
              tagline={m.tagline}
              imageSrc={m.primaryImageUrl}
              licenceBadge={m.category.licenceRequired || null}
              lamsApproved={m.useCases.includes("LEARNER_APPROVED")}
              useCases={m.useCases}
              dailyRate={m.category.baseDailyRate}
              availableCount={m.availableCount}
              bookHref={`/booking?categoryId=${m.category.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
