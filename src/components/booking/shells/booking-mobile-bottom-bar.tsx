"use client";

import { ChevronUp, Loader2, Receipt } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useBookingWizard } from "@/stores/booking-wizard";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Sticky CTA bar anchored to the bottom of the mobile wizard viewport.
 * Shows a price pill (opens the summary sheet) on the left and the
 * step's registered primary action on the right. Steps register their
 * action via `useStepContinueAction` on mount; the bar falls back to a
 * disabled placeholder while no action is registered.
 *
 * Honours `env(safe-area-inset-bottom)` so it clears the iOS home
 * indicator.
 */
export function BookingMobileBottomBar({
  onOpenSummary,
}: {
  onOpenSummary: () => void;
}) {
  const w = useBookingWizard();
  const action = useBookingWizard((s) => s.stepContinueAction);
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

  // Gate the displayed total on `ready` as well as `quote.data`. With
  // only the data check, TanStack Query's last-known result lingers in
  // the cache after the wizard is reset (post-booking flush, etc.) and
  // we'd render the previous booking's total even though the store is
  // empty. `ready` flips false the moment any required wizard field is
  // cleared, so it's the authoritative "should we show a price" signal.
  const priceLabel = ready && quote ? formatCurrency(quote.totalAmount) : "Quote";
  const continueLabel = action?.label ?? "Continue";
  const continueDisabled = !action || action.disabled;
  const continuePending = action?.pending ?? false;

  return (
    <div
      className={cn(
        "sticky bottom-0 z-40 border-t border-border bg-muted/95 backdrop-blur",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onOpenSummary}
          disabled={!quote}
          aria-label="View booking summary"
          className={cn(
            "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left",
            "disabled:opacity-60",
          )}
        >
          <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">{priceLabel}</span>
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
        <Button
          type="button"
          variant="cta"
          className="flex-1"
          disabled={continueDisabled || continuePending}
          onClick={() => action?.onClick()}
        >
          {continuePending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
