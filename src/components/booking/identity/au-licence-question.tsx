"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardIdentityPath } from "@/stores/booking-wizard";

/**
 * The binary gate at the top of Step 4 that routes the identity
 * document UI. Only appears when `wizard_intl_licence_flow` is on; with
 * the flag off the step keeps its pre-refactor licence-OR-passport
 * toggle.
 *
 * Radio-card layout: two stacked options on mobile (single column) and
 * two-up on desktop, each large enough to tap comfortably.
 */
export function AuLicenceQuestion({
  value,
  onChange,
}: {
  value: WizardIdentityPath;
  onChange: (next: Exclude<WizardIdentityPath, null>) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">
        Do you hold an Australian driver&apos;s licence?
      </legend>
      <div className="grid gap-3 md:grid-cols-2">
        <OptionCard
          selected={value === "AU_LICENCE"}
          title="Yes, Australian licence"
          description="We&apos;ll take a photo of your AU licence to verify your details."
          onClick={() => onChange("AU_LICENCE")}
        />
        <OptionCard
          selected={value === "INTERNATIONAL"}
          title="No, I&apos;ll use an IDP"
          description="Overseas licence holders need an International Driver&apos;s Permit and a passport."
          onClick={() => onChange("INTERNATIONAL")}
        />
      </div>
    </fieldset>
  );
}

function OptionCard({
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
        "flex min-h-[4.5rem] items-start gap-3 rounded-md border p-3 text-left transition",
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
      <span className="flex-1 space-y-0.5">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
