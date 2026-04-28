"use client";

import { formatCurrency } from "@/lib/utils";

export function ReturnFeesPage({
  lateFee,
  fuelCharge,
  lateHours,
  pickupFuel,
  returnFuel,
}: {
  lateFee: number;
  fuelCharge: number;
  lateHours: number;
  pickupFuel: number;
  returnFuel: number;
}) {
  return (
    <div className="space-y-4 text-sm">
      <p>
        Fees are calculated per the rental agreement signed at pickup. A one-hour grace period is applied before
        late fees begin.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-4">
          <div className="eyebrow">Late return fee</div>
          <div className="mt-1 text-xl font-semibold">{formatCurrency(lateFee)}</div>
          <p className="caption mt-1">
            {lateHours > 0
              ? `Approx ${Math.floor(lateHours)}h beyond the grace period.`
              : "No late fee — returned on time."}
          </p>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="eyebrow">Fuel shortfall charge</div>
          <div className="mt-1 text-xl font-semibold">{formatCurrency(fuelCharge)}</div>
          <p className="caption mt-1">
            Pickup fuel {pickupFuel}% · Return fuel {returnFuel}%.
          </p>
        </div>
      </div>
    </div>
  );
}
