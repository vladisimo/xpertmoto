"use client";

import { formatCurrency } from "@/lib/utils";

export function SettlementPage({
  standardTotal,
  lateFee,
  fuelCharge,
  pendingQuoteCap,
  bondHeld,
}: {
  standardTotal: number;
  lateFee: number;
  fuelCharge: number;
  pendingQuoteCap: number;
  bondHeld: number;
}) {
  const totalDueNow = Math.round((standardTotal + lateFee + fuelCharge) * 100) / 100;
  const bondApplied = Math.min(bondHeld, totalDueNow);
  const bondReleased = Math.max(0, bondHeld - bondApplied);
  const aboveBond = Math.max(0, totalDueNow - bondHeld);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-4">
          <div className="eyebrow">Total due now</div>
          <div className="mt-1 text-2xl font-semibold">{formatCurrency(totalDueNow)}</div>
          <p className="caption mt-1">
            Standard {formatCurrency(standardTotal)} + late {formatCurrency(lateFee)} + fuel{" "}
            {formatCurrency(fuelCharge)}.
          </p>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="eyebrow">Pending quote cap</div>
          <div className="mt-1 text-2xl font-semibold">{formatCurrency(pendingQuoteCap)}</div>
          <p className="caption mt-1">Charged later up to this ceiling, once the mechanic confirms cost.</p>
        </div>
      </div>
      <div className="rounded-md border border-border">
        <div className="flex justify-between border-b px-3 py-2">
          <span>Bond held</span>
          <span>{formatCurrency(bondHeld)}</span>
        </div>
        <div className="flex justify-between border-b px-3 py-2">
          <span>Applied to charges</span>
          <span>{formatCurrency(bondApplied)}</span>
        </div>
        <div className="flex justify-between border-b px-3 py-2">
          <span>Released back to customer</span>
          <span>{formatCurrency(bondReleased)}</span>
        </div>
        {aboveBond > 0 && (
          <div className="flex justify-between bg-amber-50 px-3 py-2 font-medium">
            <span>Above bond — captured from card</span>
            <span>{formatCurrency(aboveBond)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
