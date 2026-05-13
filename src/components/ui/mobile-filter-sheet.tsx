"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileDetailSheet } from "@/components/ui/mobile-detail-sheet";
import { cn } from "@/lib/utils";

export interface MobileFilterSheetProps {
  /** Filter form fields — `Select`, `Input`, etc. Receives no props. */
  children: React.ReactNode;
  /** Number of active filters; renders as a count badge on the trigger. */
  activeCount?: number;
  /** Trigger button label. Defaults to "Filters". */
  triggerLabel?: string;
  /** Sheet title. Defaults to "Filters". */
  title?: string;
  /** Apply handler — called when the user taps Apply. */
  onApply?: () => void;
  /** Reset handler — clears all filters. */
  onReset?: () => void;
  /** Apply button label. Defaults to "Apply". */
  applyLabel?: string;
  className?: string;
}

/**
 * Mobile-only filter trigger + Sheet. Use to collapse a desktop inline
 * filter bar (multiple selects + search) into a single tap target.
 *
 * Render alongside the desktop filter bar wrapped in `md:hidden` /
 * `hidden md:flex` to keep the desktop UX unchanged.
 */
export function MobileFilterSheet({
  children,
  activeCount = 0,
  triggerLabel = "Filters",
  title = "Filters",
  onApply,
  onReset,
  applyLabel = "Apply",
  className,
}: MobileFilterSheetProps) {
  const [open, setOpen] = React.useState(false);

  function handleApply() {
    onApply?.();
    setOpen(false);
  }

  function handleReset() {
    onReset?.();
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={cn("md:hidden", className)}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden />
        {triggerLabel}
        {activeCount > 0 ? (
          <Badge variant="secondary" className="ml-2 h-5 min-w-[1.25rem] px-1.5">
            {activeCount}
          </Badge>
        ) : null}
      </Button>
      <MobileDetailSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={activeCount === 0}
            >
              Reset
            </Button>
            <Button type="button" className="flex-1" onClick={handleApply}>
              {applyLabel}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">{children}</div>
      </MobileDetailSheet>
    </>
  );
}
