"use client";
import * as React from "react";
import Image from "next/image";
import { trpc } from "@/lib/trpc/client";
import { useBookingWizard } from "@/stores/booking-wizard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics/track";
import { VehicleMakeLogo } from "./vehicle-make-logo";

type Props = {
  /**
   * When true, render the line items flush — without the surrounding
   * `<Card>` + "Your quote" header. Used inside the mobile bottom-sheet
   * which already supplies its own SheetTitle and surface, so the inner
   * card chrome would be a duplicate title and a nested border.
   */
  nested?: boolean;
};

export function QuoteSummary({ nested = false }: Props = {}) {
  const w = useBookingWizard();
  const ready = !!(
    w.categoryId &&
    w.pickupDepotId &&
    w.returnDepotId &&
    w.pickupDateTime &&
    w.returnDateTime &&
    // Don't show a cost estimate until the customer has made a vehicle
    // decision in Step 2 — a specific bike or "No preference".
    (w.preferredVehicleId || w.noPreference)
  );
  const { data: quote } = trpc.booking.quote.useQuery(
    {
      categoryId: w.categoryId ?? "",
      vehicleId: w.preferredVehicleId ?? undefined,
      pickupDepotId: w.pickupDepotId ?? "",
      returnDepotId: w.returnDepotId ?? "",
      pickupDateTime: new Date(w.pickupDateTime ?? new Date()),
      returnDateTime: new Date(w.returnDateTime ?? new Date()),
      addons: w.addons,
      insuranceOptionId: w.insuranceOptionId ?? undefined,
      discountCode: w.discountCode || undefined,
      deliveryFee: w.deliveryFee,
    },
    { enabled: ready },
  );

  const { data: preferredVehicle } = trpc.vehicle.byId.useQuery(
    { id: w.preferredVehicleId ?? "" },
    { enabled: !!w.preferredVehicleId },
  );

  // Fire DISCOUNT_APPLIED / DISCOUNT_REJECTED once per unique
  // (code, quote-has-discount-line) pair. We can't easily detect
  // server-side rejection without a dedicated field on the quote
  // response, so we heuristically consider "discount line appeared" as
  // APPLIED and "quote arrived but no discount line" as REJECTED.
  const lastReportedRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!quote || !w.discountCode) return;
    const code = w.discountCode.trim();
    if (!code) return;
    const applied = quote.lineItems.some((li) => /discount/i.test(li.label));
    const key = `${code}:${applied ? "A" : "R"}`;
    if (lastReportedRef.current === key) return;
    lastReportedRef.current = key;
    trackEvent({
      kind: applied ? "DISCOUNT_APPLIED" : "DISCOUNT_REJECTED",
      target: "booking-discount-input",
      value: code,
    });
  }, [quote, w.discountCode]);

  if (!ready || !quote) return null;

  const frequencyWord =
    quote.recurringFrequency === "WEEKLY"
      ? "weekly"
      : quote.recurringFrequency === "FORTNIGHTLY"
        ? "fortnightly"
        : quote.recurringFrequency === "MONTHLY"
          ? "monthly"
          : null;

  const body = (
    <>
      {preferredVehicle && (
        <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-2.5">
          <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-sm bg-muted">
            {preferredVehicle.images[0]?.url ? (
              <Image
                src={preferredVehicle.images[0].url}
                alt={`${preferredVehicle.make} ${preferredVehicle.model}`}
                fill
                sizes="64px"
                className="object-contain"
              />
            ) : null}
          </div>
          <div className="min-w-0 text-xs">
            <div className="caption uppercase tracking-[0.08em]">Your vehicle</div>
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <VehicleMakeLogo make={preferredVehicle.make} size={12} />
              <span className="truncate">
                {preferredVehicle.make} {preferredVehicle.model}
              </span>
            </div>
            <div className="truncate text-muted-foreground">
              {preferredVehicle.year} · {preferredVehicle.colour} · {preferredVehicle.rego}
            </div>
          </div>
        </div>
      )}

      {/* PAY NOW IS THE LEAD. The customer sees the upfront charge plus its
          breakdown before any of the line-item arithmetic, so there's no
          ambiguity about what's being debited today vs. paid at pickup.
          "Pay now" shows ONLY the amount that will be debited from the
          customer's card today. The refundable bond is rendered as its
          own info-toned card below so it's never confused with a charge.
          Emerald = success tone (matches <StatusBadge> success); the
          --primary token is monochrome in this brand and can't be used. */}
      <div className="mt-3 rounded-md border border-emerald-600/30 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-500/10">
        <div className="flex justify-between text-base">
          <span className="font-semibold">Pay now</span>
          <span className="font-bold text-lg">{formatCurrency(quote.payOnlineAmount)}</span>
        </div>
        <div className="text-xs text-muted-foreground">Charged to your card today</div>
        {quote.payOnlineBreakdown.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-t border-emerald-600/20 pt-2 text-xs dark:border-emerald-400/20">
            {quote.payOnlineBreakdown.map((item, i) => (
              <li key={i}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
                {item.detail && (
                  <div className="text-muted-foreground">{item.detail}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {quote.bondAmount > 0 && (
        <div className="mt-2 rounded-md border border-sky-600/30 bg-sky-50 p-3 dark:border-sky-400/30 dark:bg-sky-500/10">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-sky-800 dark:text-sky-200">
              Refundable bond (authorisation hold)
            </span>
            <span className="font-semibold text-sky-800 dark:text-sky-200">
              {formatCurrency(quote.bondAmount)}
            </span>
          </div>
          <div className="text-xs text-sky-700/80 dark:text-sky-300/80">
            Held on your card — not charged. Released after the vehicle is returned.
          </div>
        </div>
      )}

      {quote.remainderDueAtPickup > 0 && (
        <div className="mt-2 flex justify-between rounded-md border border-border bg-muted/50 p-3 text-sm">
          <span className="text-muted-foreground">Pay at pickup</span>
          <span className="font-medium">{formatCurrency(quote.remainderDueAtPickup)}</span>
        </div>
      )}

      {/* Phase A2 — long-term hire billing schedule. Subtle amber tint
          distinguishes the recurring-charge callout from the green
          "Pay now" total without competing with it. (--primary is
          monochrome in this brand, so we use the amber palette
          directly — same convention as <StatusBadge> warning.) */}
      {quote.isLongTerm && frequencyWord && quote.recurringPeriodsTotal > 0 && (
        <div className="mt-2 rounded-md border border-amber-600/20 bg-amber-50/70 p-3 space-y-1 text-xs dark:border-amber-400/20 dark:bg-amber-500/5">
          <div className="font-medium text-amber-700 dark:text-amber-300">Long-term hire billing</div>
          <div className="text-muted-foreground">
            Today&apos;s payment covers the first {frequencyWord.replace(/ly$/, "")} of hire
            plus any one-time fees (delivery, one-way) and the bond hold. We&apos;ll then
            automatically charge your card on file{" "}
            <strong>{formatCurrency(quote.recurringAmount)}</strong> {frequencyWord} for{" "}
            <strong>{quote.recurringPeriodsTotal}</strong> more period
            {quote.recurringPeriodsTotal === 1 ? "" : "s"} — covering rental, per-day add-ons
            and insurance.
          </div>
        </div>
      )}

      {/* Quote breakdown — every line that rolls up to the rental total,
          shown after the payment callouts so the customer can verify the
          math behind the "Pay now" / "Pay at pickup" figures. Each row
          shows its own formula in small text underneath. */}
      <div className="mt-4 border-t pt-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Quote breakdown
        </div>
        <ul className="space-y-1.5">
          {quote.lineItems.map((li, i) => (
            <li key={i}>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{li.label}</span>
                <span className="tabular-nums text-foreground">{formatCurrency(li.amount)}</span>
              </div>
              {li.detail && (
                <div className="text-xs text-muted-foreground/80">{li.detail}</div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
          <span>Total (GST incl)</span>
          <span className="text-foreground">{formatCurrency(quote.totalAmount)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Includes GST</span>
          <span>{formatCurrency(quote.gstAmount)}</span>
        </div>
      </div>
    </>
  );

  if (nested) {
    return <div className="space-y-1 text-sm">{body}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your quote</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">{body}</CardContent>
    </Card>
  );
}
