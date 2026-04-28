"use client";

import { useState } from "react";
import { Clock } from "lucide-react";

// Brand-specific authorization horizons matching bond-auth-expiry-check.ts.
// Stripe doesn't expose these; they're card-network defaults.
const BRAND_HORIZON_DAYS: Record<string, number> = {
  visa: 7,
  mastercard: 30,
  amex: 30,
  discover: 30,
  jcb: 30,
  unionpay: 7,
  diners: 14,
};
const DEFAULT_HORIZON_DAYS = 7;

type Props = {
  bondCreatedAt: string | Date | null | undefined;
  cardBrand: string | null | undefined;
  bondStatus: string;
};

export function BondAgeBanner({ bondCreatedAt, cardBrand, bondStatus }: Props) {
  const [now] = useState<number | null>(() =>
    typeof window === "undefined" ? null : Date.now(),
  );

  if (!bondCreatedAt || bondStatus !== "HELD") return null;
  if (now === null) return null; // SSR returns null; banner hydrates client-side.
  const brand = (cardBrand ?? "").toLowerCase();
  const horizonDays = BRAND_HORIZON_DAYS[brand] ?? DEFAULT_HORIZON_DAYS;
  const ageDays = (now - new Date(bondCreatedAt).getTime()) / 86_400_000;
  const daysLeft = horizonDays - ageDays;
  if (daysLeft > 2) return null; // only show once we're within 2 days

  const expired = daysLeft < 0;
  const tone = expired ? "destructive" : "amber";
  const toneClass =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400";

  return (
    <div className={`rounded-md border ${toneClass} p-3 text-sm flex items-start gap-2`}>
      <Clock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">
          {expired
            ? "Bond authorisation likely expired"
            : `Bond authorisation expiring in ~${Math.max(0, Math.ceil(daysLeft))} day${daysLeft < 1 && daysLeft > 0 ? "" : "s"}`}
        </div>
        <p className="text-xs mt-1">
          {brand ? `${brand.toUpperCase()} holds are valid for ~${horizonDays} days` : `Assuming ${horizonDays}-day hold`}
          . Capture any damage charges now, or accept that the auth will drop
          off the customer&apos;s card.
        </p>
      </div>
    </div>
  );
}
