"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, CalendarClock } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookingDateRangePicker } from "@/components/booking/date-range-picker";
import { formatCurrency } from "@/lib/utils";

export interface ModelBookingPanelProps {
  categoryId: string;
  modelId: string;
  modelLabel: string;
  bondAmount: number;
  /** First active unit of this model — pricing fallback so a quote still
   *  renders when nothing is free for the chosen dates. */
  sampleVehicleId: string | null;
  /** Every depot this model has an active unit at. */
  modelDepots: Array<{ id: string; name: string; state: string }>;
}

/** Both dates present and the range is strictly positive. */
export function rangeReady(pickup: string, ret: string): boolean {
  if (!pickup || !ret) return false;
  const p = new Date(pickup).getTime();
  const r = new Date(ret).getTime();
  return Number.isFinite(p) && Number.isFinite(r) && r > p;
}

/** Keep only the units that belong to this model. */
export function filterModelUnits<T extends { modelId: string | null }>(
  vehicles: T[],
  modelId: string,
): T[] {
  return vehicles.filter((v) => v.modelId === modelId);
}

/**
 * Build the wizard deep-link. All five params present → the wizard hand-off
 * jumps straight to the Vehicle step with this bike/depot/dates pre-filled.
 * Returns null when no specific unit is free (nothing to book).
 */
export function buildBookingHref(args: {
  categoryId: string;
  depotId: string;
  vehicleId: string | null;
  pickup: string;
  ret: string;
}): string | null {
  if (!args.vehicleId || !args.depotId) return null;
  const p = new URLSearchParams({
    categoryId: args.categoryId,
    depotId: args.depotId,
    vehicleId: args.vehicleId,
    pickup: args.pickup,
    return: args.ret,
  });
  return `/booking?${p.toString()}`;
}

/**
 * Interactive booking widget on the public model page. Lets the customer
 * pick a depot + date range, then shows the true date-aware availability for
 * THIS model and a live GST-inclusive quote, and hands off to the booking
 * wizard with everything pre-selected. Real checkout (licence, T&Cs, Stripe)
 * stays in the wizard — this panel deep-links into it via the five-param
 * hand-off so the wizard lands on the Vehicle step with this exact bike,
 * depot and dates already filled.
 */
export function ModelBookingPanel({
  categoryId,
  modelId,
  modelLabel,
  bondAmount,
  sampleVehicleId,
  modelDepots,
}: ModelBookingPanelProps) {
  const [depotId, setDepotId] = React.useState<string>(modelDepots[0]?.id ?? "");
  const [pickupValue, setPickupValue] = React.useState("");
  const [returnValue, setReturnValue] = React.useState("");

  const { data: depots } = trpc.depot.list.useQuery();
  const selectedDepot = depots?.find((d) => d.id === depotId) ?? null;
  const depotHours = selectedDepot
    ? { operatingHours: selectedDepot.operatingHours }
    : null;

  const ready = rangeReady(pickupValue, returnValue);

  // True, date-aware availability for THIS model: the engine returns every
  // free unit in the category/depot for the window; we keep only this model's.
  const { data: availableVehicles, isFetching: availFetching } =
    trpc.booking.listAvailableVehicles.useQuery(
      {
        categoryId,
        depotId,
        pickupDateTime: new Date(pickupValue || 0),
        returnDateTime: new Date(returnValue || 0),
      },
      { enabled: ready && !!depotId },
    );
  const availableUnits = React.useMemo(
    () => filterModelUnits(availableVehicles ?? [], modelId),
    [availableVehicles, modelId],
  );
  const firstFreeUnitId = availableUnits[0]?.id ?? null;

  const { data: quote, isFetching: quoteFetching } = trpc.booking.quote.useQuery(
    {
      categoryId,
      vehicleId: firstFreeUnitId ?? sampleVehicleId ?? undefined,
      pickupDepotId: depotId,
      returnDepotId: depotId,
      pickupDateTime: new Date(pickupValue || 0),
      returnDateTime: new Date(returnValue || 0),
    },
    { enabled: ready && !!depotId },
  );

  const bookHref = React.useMemo(
    () =>
      buildBookingHref({
        categoryId,
        depotId,
        vehicleId: firstFreeUnitId,
        pickup: pickupValue,
        ret: returnValue,
      }),
    [categoryId, depotId, firstFreeUnitId, pickupValue, returnValue],
  );

  const isAvailable = ready && availableUnits.length > 0;
  const loading = ready && (availFetching || quoteFetching);

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 md:p-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="font-semibold">Check dates &amp; book</h3>
      </div>

      {modelDepots.length > 1 && (
        <div className="flex items-center justify-between gap-3">
          <label className="shrink-0 text-sm font-medium">Depot</label>
          <Select value={depotId || undefined} onValueChange={setDepotId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Choose a depot" />
            </SelectTrigger>
            <SelectContent>
              {modelDepots.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.state})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <BookingDateRangePicker
        pickupValue={pickupValue}
        returnValue={returnValue}
        onPickupChange={setPickupValue}
        onReturnChange={setReturnValue}
        pickupDepot={depotHours}
        returnDepot={depotHours}
      />

      {!ready ? (
        <p className="text-sm text-muted-foreground">
          Select your pickup and return dates to see live availability and a price
          for the {modelLabel}.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Availability for the chosen window */}
          {isAvailable ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {availableUnits.length} available for these dates
            </p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Checking availability…</p>
          ) : (
            <p className="text-sm font-medium text-destructive">
              Not available for these dates — try a different window or depot.
            </p>
          )}

          {/* Live GST-inclusive quote. Tones mirror the wizard quote summary:
              emerald = charged today, sky = refundable bond hold. */}
          {quote && (
            <div className="space-y-2">
              <div className="rounded-md border border-emerald-600/30 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-500/10">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Pay now</span>
                  <span className="text-lg font-bold">
                    {formatCurrency(quote.payOnlineAmount)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Charged to your card today
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Total ({quote.durationDays}{" "}
                  {quote.durationDays === 1 ? "day" : "days"}, GST incl)
                </span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(quote.totalAmount)}
                </span>
              </div>
              {quote.bondAmount > 0 && (
                <div className="flex justify-between text-sm text-sky-800 dark:text-sky-200">
                  <span>Refundable bond (hold)</span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(quote.bondAmount)}
                  </span>
                </div>
              )}
            </div>
          )}

          {isAvailable && bookHref ? (
            <Button asChild variant="cta" size="lg" className="w-full">
              <Link href={bookHref}>Book these dates ➔</Link>
            </Button>
          ) : (
            <Button variant="cta" size="lg" className="w-full" disabled aria-disabled>
              {loading ? "Checking…" : "Not available for these dates"}
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Bond of {formatCurrency(bondAmount)} held on your card (not charged) and
        released after return. GST-inclusive pricing.
      </p>
    </div>
  );
}
