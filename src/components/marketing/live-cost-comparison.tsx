"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

const E_FLEET_PER_TOLL = 1.5; // eFleetPass vehicle-rental tier: $1.50 / toll, no tag rental
const XPERT_REBILL_PER_TOLL = 3.3;

const aud0 = (n: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
const num0 = (n: number) =>
  new Intl.NumberFormat("en-AU").format(Math.round(n));

export interface StaticCostRow {
  line: string;
  legacyAnnual: number;
  legacyDetail: string;
  platformLabel: string;
}

interface LiveCostComparisonProps {
  siteName: string;
  staticRows: StaticCostRow[];
  platformAnnual: number;
  platformAnnualPrepaid: number;
  className?: string;
}

export function LiveCostComparison({
  siteName,
  staticRows,
  platformAnnual,
  platformAnnualPrepaid,
  className,
}: LiveCostComparisonProps) {
  const [vehicles, setVehicles] = useState(255);
  const [tollsPerMonth, setTollsPerMonth] = useState(6);

  const result = useMemo(() => {
    const annualTolls = vehicles * tollsPerMonth * 12;
    const legacyTollAdmin = annualTolls * E_FLEET_PER_TOLL;
    const xpertRebillRevenue = annualTolls * XPERT_REBILL_PER_TOLL;
    const staticLegacyTotal = staticRows.reduce((s, r) => s + r.legacyAnnual, 0);
    const legacyTotal = staticLegacyTotal + legacyTollAdmin;
    const xpertNet = platformAnnual - xpertRebillRevenue;
    const xpertNetPrepaid = platformAnnualPrepaid - xpertRebillRevenue;
    const benefit = legacyTotal - xpertNet;
    const benefitPrepaid = legacyTotal - xpertNetPrepaid;
    return {
      annualTolls,
      legacyTollAdmin,
      xpertRebillRevenue,
      legacyTotal,
      xpertNet,
      xpertNetPrepaid,
      benefit,
      benefitPrepaid,
    };
  }, [vehicles, tollsPerMonth, staticRows, platformAnnual, platformAnnualPrepaid]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="mb-1 text-sm font-semibold text-foreground">Your fleet scale</div>
        <p className="mb-4 text-sm text-muted-foreground">
          Adjust to model your operation — the cost comparison below
          recalculates the fleet-toll admin and rebill-revenue lines live.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <SliderField
            label="Fleet size"
            unit={vehicles === 1 ? " vehicle" : " vehicles"}
            min={1}
            max={1000}
            step={1}
            value={vehicles}
            onChange={setVehicles}
          />
          <SliderField
            label="Average tolls per vehicle / month"
            unit={tollsPerMonth === 1 ? " toll" : " tolls"}
            min={0}
            max={30}
            step={1}
            value={tollsPerMonth}
            onChange={setTollsPerMonth}
          />
        </div>
        <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
          That works out to{" "}
          <strong className="font-semibold text-foreground">
            {num0(result.annualTolls)}
          </strong>{" "}
          toll events across your fleet per year.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm" aria-live="polite">
            <thead className="bg-foreground text-background">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                  Cost line
                </th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                  Current stack / yr
                </th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                  {siteName} / yr
                </th>
              </tr>
            </thead>
            <tbody>
              {staticRows.map((row) => (
                <tr key={row.line} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium">{row.line}</td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">
                    {row.legacyAnnual > 0 ? aud0(row.legacyAnnual) : "$0"}
                    <div className="mt-0.5 text-xs">{row.legacyDetail}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.platformLabel}</td>
                </tr>
              ))}
              <tr className="border-t border-border bg-amber-500/5 align-top">
                <td className="px-4 py-3 font-medium">
                  Fleet toll administration
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Reacts to your fleet size + toll volume above
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {aud0(result.legacyTollAdmin)}
                  <div className="mt-0.5 text-xs">
                    eFleetPass vehicle-rental tier: $1.50 / toll × {num0(result.annualTolls)} events
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  $0
                  <div className="mt-0.5 text-xs text-muted-foreground">Included</div>
                </td>
              </tr>
              <tr className="border-t border-border bg-primary/5 align-top">
                <td className="px-4 py-3 font-medium">
                  Toll admin rebilled to hirers
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Net new revenue captured inside the platform
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">—</td>
                <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                  −{aud0(result.xpertRebillRevenue)}
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    $3.30 / toll × {num0(result.annualTolls)} events
                  </div>
                </td>
              </tr>
              <tr className="border-t border-border align-top">
                <td className="px-4 py-3 font-medium">Platform subscription</td>
                <td className="px-4 py-3 tabular-nums">—</td>
                <td className="px-4 py-3 tabular-nums">
                  {aud0(platformAnnual)}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    or {aud0(platformAnnualPrepaid)} prepaid (~10% discount)
                  </div>
                </td>
              </tr>
              <tr className="border-t-2 border-foreground/40 bg-muted/40 align-top">
                <td className="px-4 py-3 font-semibold">Net annual cost</td>
                <td className="px-4 py-3 font-semibold tabular-nums">
                  {aud0(result.legacyTotal)}
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums">
                  {aud0(result.xpertNet)}
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {aud0(result.xpertNetPrepaid)} prepaid
                  </div>
                </td>
              </tr>
              <tr className="border-t border-border bg-muted/40 align-top">
                <td className="px-4 py-3 font-semibold">
                  Annual benefit of switching
                </td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                  {result.benefit >= 0 ? "+" : ""}
                  {aud0(result.benefit)}
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {result.benefitPrepaid >= 0 ? "+" : ""}
                    {aud0(result.benefitPrepaid)} prepaid · before labour automation &amp; growth uplift (see worked example below)
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Assumptions (GST-inclusive AUD). eFleetPass vehicle-rental tier at
        ${E_FLEET_PER_TOLL.toFixed(2)} per toll, per their published fee
        schedule — no monthly tag rental on this tier. Excludes optional
        eFleetPass levies (carbon offset, GPS tracking, feed-in tariff) which
        can stack a further $3.50 per toll on contracts that include them.
        The {siteName} rebill assumes ${XPERT_REBILL_PER_TOLL.toFixed(2)} per
        toll charged through to the hirer via the existing Stripe bond hold.
        Static-row baselines are SMB-tier subscriptions; enterprise-comparable
        tiers would be higher and would widen the benefit shown.
      </p>
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}

function SliderField({ label, unit, min, max, step, value, onChange }: SliderFieldProps) {
  const id = useId();
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {value.toLocaleString("en-AU")}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {unit.trim()}
          </span>
        </span>
      </div>
      <div className="relative mt-3 h-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground/15"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`${value}${unit}`}
          className={cn(
            "absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent",
            "focus-visible:outline-none",
            "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
            "[&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-foreground/30 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:scale-110 active:[&::-webkit-slider-thumb]:cursor-grabbing",
            "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:border-0",
            "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab active:[&::-moz-range-thumb]:cursor-grabbing",
            "focus-visible:[&::-webkit-slider-thumb]:ring-ring focus-visible:[&::-webkit-slider-thumb]:ring-4",
            "focus-visible:[&::-moz-range-thumb]:shadow-[0_0_0_4px_hsl(var(--ring))]",
          )}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70">
        <span>{min.toLocaleString("en-AU")}</span>
        <span>{max.toLocaleString("en-AU")}</span>
      </div>
    </div>
  );
}
