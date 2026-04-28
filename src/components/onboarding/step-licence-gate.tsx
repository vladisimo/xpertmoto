"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OnboardingIdentityPath } from "@/stores/onboarding-flow";

export interface StepLicenceGateProps {
  value: OnboardingIdentityPath;
  onChange: (next: Exclude<OnboardingIdentityPath, null>) => void;
}

/**
 * Step 2 — single decision: AU licence vs. International Driver's
 * Permit. Same UI as the booking-wizard `<AuLicenceQuestion>`, narrowed
 * to the onboarding store's type.
 */
export function StepLicenceGate({ value, onChange }: StepLicenceGateProps) {
  return (
    <fieldset className="space-y-3" role="radiogroup">
      <legend className="text-sm font-medium">
        Which licence will you ride on?
      </legend>
      <div className="grid gap-3 md:grid-cols-2">
        <Card
          selected={value === "AU_LICENCE"}
          title="Australian driver's licence"
          description="We'll take a photo of your AU licence to verify your identity."
          onClick={() => onChange("AU_LICENCE")}
        />
        <Card
          selected={value === "INTERNATIONAL"}
          title="International Driver's Permit"
          description="Overseas licence holders need an IDP and a passport."
          onClick={() => onChange("INTERNATIONAL")}
        />
      </div>
    </fieldset>
  );
}

function Card({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-[5rem] items-start gap-3 rounded-md border p-4 text-left transition",
        "hover:bg-muted/40",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-background",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span className="flex-1 space-y-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
