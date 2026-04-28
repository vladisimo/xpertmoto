"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
  /** Short label shown in the pill, e.g. "Identity". */
  label: string;
  /** Optional helper shown under the label when active. */
  hint?: string;
};

export type WizardProgressProps = {
  steps: readonly WizardStep[];
  /** 1-based index of the active step. */
  current: number;
  /** Fires when a step is clicked — gated by `canNavigateTo`. */
  onStepClick?: (step: number) => void;
  /**
   * Which steps accept clicks. Defaults to already-completed steps only.
   * Pass `() => true` to allow free navigation in both directions.
   */
  canNavigateTo?: (step: number, current: number) => boolean;
};

/**
 * Generic stepper used by wizard-style flows (booking wizard, new-customer
 * wizard). Renders a horizontal row of steps with a numbered circle and a
 * label, with a tick replacing the number once the step is completed.
 */
export function WizardProgress({
  steps,
  current,
  onStepClick,
  canNavigateTo = (n, c) => n < c,
}: WizardProgressProps) {
  return (
    <ol className="flex items-start justify-between gap-1 border-b border-border text-sm md:items-center md:justify-start md:gap-0">
      {steps.map((s, i) => {
        const n = i + 1;
        const isActive = n === current;
        const done = n < current;
        const clickable =
          !!onStepClick && n !== current && canNavigateTo(n, current);
        return (
          <li
            key={s.label}
            className={cn(
              "-mb-px flex shrink-0 flex-col items-center gap-1 border-b-2 border-transparent px-1.5 py-2 transition-colors md:flex-row md:gap-2 md:px-4 md:py-3",
              isActive && "border-secondary",
              !isActive && "text-muted-foreground",
              clickable && "cursor-pointer hover:text-foreground",
            )}
            onClick={clickable ? () => onStepClick!(n) : undefined}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem] font-semibold md:h-6 md:w-6 md:text-xs",
                isActive && "border-foreground bg-foreground text-background",
                done && "border-primary bg-primary text-primary-foreground",
                !isActive && !done && "border-border",
              )}
            >
              {done ? <Check className="h-3 w-3 md:h-3.5 md:w-3.5" /> : n}
            </span>
            <span className="flex flex-col items-center md:items-start">
              <span
                className={cn(
                  "whitespace-nowrap text-[0.65rem] md:text-sm",
                  isActive && "font-medium text-foreground",
                )}
              >
                {s.label}
              </span>
              {isActive && s.hint && (
                <span className="hidden whitespace-nowrap text-caption text-muted-foreground md:inline">
                  {s.hint}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
