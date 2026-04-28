"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepDescriptor = {
  index: number;
  label: string;
};

export interface OnboardingShellProps {
  steps: readonly StepDescriptor[];
  /** 1-based current step index (matches `OnboardingStep`). */
  currentStep: number;
  title: string;
  description?: string;
  /** Step body. */
  children: React.ReactNode;
  /** Sticky bottom CTA (mobile + desktop). */
  primaryAction: {
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    pending?: boolean;
  };
  /** Optional Back button. Hidden on step 1. */
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

/**
 * Single-column wizard shell shared by every onboarding step. Mobile-first:
 * sticky bottom action row on `<lg`, inline button row on desktop. Header
 * shows brand + step pills with completed/current/upcoming states.
 */
export function OnboardingShell({
  steps,
  currentStep,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
}: OnboardingShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-4">
          <BrandLogo height={28} linked={false} />
          <p className="caption text-muted-foreground">
            Step {currentStep} of {steps.length}
          </p>
        </div>
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 overflow-x-auto px-4 pb-4">
          {steps.map((s) => {
            const completed = s.index < currentStep;
            const current = s.index === currentStep;
            return (
              <div
                key={s.index}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs",
                  completed && "border-primary/40 bg-primary/10 text-primary",
                  current && "border-primary bg-primary text-primary-foreground",
                  !completed && !current && "border-border text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                    completed && "bg-primary text-primary-foreground",
                    current && "bg-primary-foreground text-primary",
                    !completed && !current && "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {completed ? <Check className="h-3 w-3" /> : s.index}
                </span>
                <span className="whitespace-nowrap">{s.label}</span>
              </div>
            );
          })}
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-32 pt-6 lg:pb-12">
          <div className="space-y-2">
            <h1 className="h1">{title}</h1>
            {description ? <p className="body-text text-muted-foreground">{description}</p> : null}
          </div>
          {children}
        </div>
      </main>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur",
          "lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none",
        )}
      >
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3 lg:py-6">
          {secondaryAction ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.label}
            </Button>
          ) : (
            <span aria-hidden />
          )}
          <Button
            type="button"
            size="lg"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled || primaryAction.pending}
            className="min-w-32"
          >
            {primaryAction.pending ? "Working…" : primaryAction.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
