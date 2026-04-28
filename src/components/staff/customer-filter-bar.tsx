"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StatusFilter } from "@/lib/customers/filters";

export interface StatusPreset {
  value: StatusFilter;
  label: string;
  count?: number;
}

export const DEFAULT_STATUS_PRESETS: StatusPreset[] = [
  { value: "PENDING_HIRE", label: "Pending hire" },
  { value: "ACTIVE_RENTAL", label: "Active rental" },
  { value: "UNVERIFIED", label: "Unverified" },
  { value: "LICENCE_EXPIRED", label: "Licence expired" },
  { value: "HIGH_RISK", label: "High risk" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "ALL", label: "All" },
];

export interface CustomerFilterBarProps {
  status: StatusFilter;
  search: string;
  onStatusChange: (next: StatusFilter) => void;
  onSearchChange: (next: string) => void;
  presets?: StatusPreset[];
  isFetching?: boolean;
}

export function CustomerFilterBar({
  status,
  search,
  onStatusChange,
  onSearchChange,
  presets = DEFAULT_STATUS_PRESETS,
  isFetching,
}: CustomerFilterBarProps) {
  const [draft, setDraft] = React.useState(search);
  const [lastPropSearch, setLastPropSearch] = React.useState(search);
  if (lastPropSearch !== search) {
    setLastPropSearch(search);
    setDraft(search);
  }

  React.useEffect(() => {
    if (draft === search) return;
    const id = window.setTimeout(() => onSearchChange(draft), 300);
    return () => window.clearTimeout(id);
  }, [draft, search, onSearchChange]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Customer status filter">
        {presets.map((preset) => {
          const active = preset.value === status;
          return (
            <button
              key={preset.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onStatusChange(preset.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {preset.label}
              {preset.count !== undefined && (
                <span
                  className={cn(
                    "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-background text-muted-foreground",
                  )}
                >
                  {preset.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="relative ml-auto min-w-[16rem] flex-1 md:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search name, email, phone…"
          className="pl-9 pr-9"
          aria-label="Search customers"
        />
        {draft && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setDraft("");
              onSearchChange("");
            }}
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        {isFetching && (
          <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            …
          </span>
        )}
      </div>
    </div>
  );
}
