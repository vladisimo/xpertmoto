"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/router";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

export type PricingSummary = inferRouterOutputs<AppRouter>["admin"]["pricingSummary"];
export type ModelRatesSummary = inferRouterOutputs<AppRouter>["admin"]["modelRates"];
export type CategoryRow = PricingSummary["categories"][number];
export type AddonRow = PricingSummary["addons"][number];
export type InsuranceRow = PricingSummary["insurance"][number];
export type DiscountRow = PricingSummary["discounts"][number];
export type SeasonRow = PricingSummary["seasons"][number];
export type ModelRow = ModelRatesSummary["models"][number];
export type TierRow = NonNullable<ModelRatesSummary["tiersByModel"][string]>[number];

export function renderTierPreview(tiers: TierRow[]): string {
  // Compact one-line summary of the ladder so operators can read the rate
  // card without opening the editor. Falls back to a tier-count when the
  // mix is weird (mode-switched mid-ladder, both fields blank).
  const sorted = [...tiers].sort((a, b) => a.minDays - b.minDays);
  if (sorted.every((t) => t.tierMode === "PER_WEEK" && t.pricePerWeek != null)) {
    return sorted.map((t) => `$${Number(t.pricePerWeek!).toFixed(0)}/wk`).join(" → ");
  }
  if (sorted.every((t) => t.tierMode === "PROGRESSIVE")) {
    return sorted.map((t) => `$${Number(t.tierTotal).toFixed(0)}`).join(" + ");
  }
  return `${tiers.length} mixed tier(s)`;
}

export function NumberCell({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      type="number"
      value={v}
      onChange={(e) => setV(Number(e.target.value))}
      onBlur={() => v !== value && onSave(v)}
      className="h-9 text-right"
    />
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <StatusBadge status="AVAILABLE" />
  ) : (
    <StatusBadge status="CANCELLED" label="Inactive" />
  );
}
