"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VehicleMakeLogo } from "./vehicle-make-logo";

export type SortKey = "odometer-asc" | "year-desc" | "make-asc";

export type VehicleFilters = {
  make: string;
  model: string;
  sort: SortKey;
  colour: string;
};

export const DEFAULT_FILTERS: VehicleFilters = {
  make: "all",
  model: "all",
  sort: "odometer-asc",
  colour: "all",
};

export function VehicleFilterBar({
  filters,
  onChange,
  makeOptions,
  modelOptions,
  colourOptions,
  resultCount,
  onClear,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
}: {
  filters: VehicleFilters;
  onChange: (next: VehicleFilters) => void;
  makeOptions: string[];
  modelOptions: string[];
  colourOptions: string[];
  resultCount: number;
  onClear: () => void;
  /** When provided, renders a leading free-text search input. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const hasSearch = typeof search === "string" && typeof onSearchChange === "function";
  const isFiltered =
    filters.make !== "all" ||
    filters.model !== "all" ||
    filters.colour !== "all" ||
    filters.sort !== DEFAULT_FILTERS.sort;

  return (
    <div>
      {/* Filters: make / model / colour / kms (sort) + Clear all on one
       *  row. Each select gets `min-w-0 flex-1` so they share the row
       *  evenly and truncate before pushing siblings off-screen. */}
      <div className="flex flex-row items-center gap-2">
        {hasSearch && (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange!(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search vehicles"
              className="h-9 pl-8"
            />
          </div>
        )}
        <Select
          value={filters.make}
          onValueChange={(value) => onChange({ ...filters, make: value, model: "all" })}
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
          onValueChange={(value) => onChange({ ...filters, model: value })}
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
          onValueChange={(value) => onChange({ ...filters, colour: value })}
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
          onValueChange={(value) => onChange({ ...filters, sort: value as SortKey })}
        >
          <SelectTrigger className="min-w-0 flex-1" aria-label="Sort vehicles">
            <SelectValue>
              {filters.sort === DEFAULT_FILTERS.sort ? (
                <span className="text-muted-foreground">KM&apos;s</span>
              ) : filters.sort === "year-desc" ? (
                <span className="truncate">Newest</span>
              ) : (
                <span className="truncate">A–Z</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="odometer-asc">Fewest kilometres</SelectItem>
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
        {resultCount} shown
      </div>
    </div>
  );
}
