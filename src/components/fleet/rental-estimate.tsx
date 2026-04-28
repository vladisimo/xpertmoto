import { SpecTable, type SpecRow } from "@/components/marketing/spec-table";
import { formatCurrency } from "@/lib/utils";

/** A PricingTier row projected to plain numbers for client rendering. */
export type RentalEstimateTier = {
  minDays: number;
  maxDays: number;
  tierTotal: number;
};

export interface RentalEstimateProps {
  dailyRate: number;
  weeklyRate: number;
  monthlyRate: number;
  /** Optional progressive tier ladder. When present, takes precedence over
   *  the flat daily/weekly/monthly cascade. Mirrors
   *  `computeProgressiveTierTotal` in src/server/services/pricing.ts — keep
   *  in sync. */
  tiers?: RentalEstimateTier[];
}

// Flat fallback — mirrors src/server/services/pricing.ts (non-tiered path).
function chooseBaseRate(days: number, daily: number, weekly: number, monthly: number): number {
  if (days >= 28) return monthly / 30;
  if (days >= 7) return weekly / 7;
  return daily;
}

function durationDiscount(days: number): number {
  if (days >= 30) return 0.25;
  if (days >= 7) return 0.1;
  return 0;
}

function flatTotalForDays(days: number, daily: number, weekly: number, monthly: number): number {
  const base = chooseBaseRate(days, daily, weekly, monthly);
  return base * days * (1 - durationDiscount(days));
}

// Tiered path — mirrors `computeProgressiveTierTotal` in pricing.ts. Uses
// plain Number arithmetic (preview only; the server quote is canonical).
function progressiveTierTotal(tiers: RentalEstimateTier[], days: number): number {
  if (tiers.length === 0 || days <= 0) return 0;
  let total = 0;
  let remaining = days;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const tierLength = tier.maxDays - tier.minDays + 1;
    const daysInTier = Math.min(remaining, tierLength);
    if (daysInTier >= tierLength) {
      total += tier.tierTotal;
    } else {
      total += (tier.tierTotal / tierLength) * daysInTier;
    }
    remaining -= daysInTier;
  }
  if (remaining > 0) {
    const last = tiers[tiers.length - 1]!;
    const lastLength = last.maxDays - last.minDays + 1;
    total += (last.tierTotal / lastLength) * remaining;
  }
  return total;
}

export function RentalEstimate({
  dailyRate,
  weeklyRate,
  monthlyRate,
  tiers,
}: RentalEstimateProps) {
  const hasTiers = !!tiers && tiers.length > 0;
  const t = (days: number) =>
    hasTiers
      ? progressiveTierTotal(tiers!, days)
      : flatTotalForDays(days, dailyRate, weeklyRate, monthlyRate);
  const perWeek = (days: number) => (t(days) / days) * 7;

  const rows: SpecRow[] = [
    { label: "24 hours", value: formatCurrency(t(1)) },
    { label: "48 hours", value: formatCurrency(t(2)) },
    { label: "1 week", value: formatCurrency(t(7)) },
    { label: "2 weeks", value: formatCurrency(t(14)) },
    { label: "3 weeks", value: formatCurrency(t(21)) },
    { label: "4–12 weeks", value: `from ${formatCurrency(perWeek(28))} / week` },
    { label: "12+ weeks", value: `from ${formatCurrency(perWeek(84))} / week` },
  ];

  return (
    <div className="space-y-3">
      <SpecTable rows={rows} />
      <p className="caption">
        GST-inclusive.{" "}
        {hasTiers
          ? "Longer hires drop into cheaper tiers automatically — the effective per-day rate falls the longer you ride."
          : "Longer hires automatically get our best rate — 10% off from 1 week, 25% off from 30 days."}
      </p>
    </div>
  );
}
