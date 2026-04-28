"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * URL-serialised shared filters for the /staff/live analytics tabs.
 *
 * Every widget on Overview / Acquisition / Behaviour / Conversion /
 * Retention reads from the same set so a filter applied on one view
 * propagates to the others (and to the Sessions tab when users drill
 * down). Keys are short to keep URLs legible.
 *
 *  range    r   TODAY | 7D | 30D | 90D
 *  compare  c   "1"   — enables previous-period comparison deltas
 *  segment  seg ALL | MOBILE | DESKTOP | TABLET | BOT_EXCL
 *  country  co  ISO-2, uppercased
 *  landing  lp  raw landing path
 *  source   us  utm_source value
 *  medium   um  utm_medium value
 *  campaign uc  utm_campaign value
 *  referrer rd  referrer domain (host only)
 *  step     ws  wizardHighestStep equality filter (1–6)
 *  dow      dw  0..6 (Sunday = 0)
 *  hour     hr  0..23
 *  depot    dp  pickupDepotId from wizard-state snapshot
 *  cat      ct  categoryId from wizard-state snapshot
 *  vehicle  vh  preferredVehicleId from wizard-state snapshot
 *  code     dc  discountCode from wizard-state snapshot
 */
export type AnalyticsRange = "TODAY" | "7D" | "30D" | "90D";
export type AnalyticsSegment = "ALL" | "MOBILE" | "DESKTOP" | "TABLET" | "BOT_EXCL";

export interface AnalyticsFilters {
  range: AnalyticsRange;
  compare: boolean;
  segment: AnalyticsSegment;
  country: string | null;
  landing: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  step: number | null;
  dow: number | null;
  hour: number | null;
  depot: string | null;
  category: string | null;
  vehicle: string | null;
  code: string | null;
}

const RANGE_VALUES: readonly AnalyticsRange[] = ["TODAY", "7D", "30D", "90D"];
const SEGMENT_VALUES: readonly AnalyticsSegment[] = [
  "ALL",
  "MOBILE",
  "DESKTOP",
  "TABLET",
  "BOT_EXCL",
];

export const ANALYTICS_RANGE_LABEL: Record<AnalyticsRange, string> = {
  TODAY: "Today",
  "7D": "Last 7 days",
  "30D": "Last 30 days",
  "90D": "Last 90 days",
};

export const ANALYTICS_SEGMENT_LABEL: Record<AnalyticsSegment, string> = {
  ALL: "All visitors",
  MOBILE: "Mobile",
  DESKTOP: "Desktop",
  TABLET: "Tablet",
  BOT_EXCL: "Exclude bots",
};

function parseRange(v: string | null): AnalyticsRange {
  return (RANGE_VALUES as readonly string[]).includes(v ?? "") ? (v as AnalyticsRange) : "7D";
}

function parseSegment(v: string | null): AnalyticsSegment {
  return (SEGMENT_VALUES as readonly string[]).includes(v ?? "")
    ? (v as AnalyticsSegment)
    : "ALL";
}

function parseOptionalInt(v: string | null, min: number, max: number): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= min && i <= max ? i : null;
}

function parseCountry(v: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

function parseString(v: string | null): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function useAnalyticsFilters(): {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  clearDrilldown: () => void;
  hasDrilldown: boolean;
} {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = React.useMemo<AnalyticsFilters>(
    () => ({
      range: parseRange(searchParams.get("r")),
      compare: searchParams.get("c") === "1",
      segment: parseSegment(searchParams.get("seg")),
      country: parseCountry(searchParams.get("co")),
      landing: parseString(searchParams.get("lp")),
      source: parseString(searchParams.get("us")),
      medium: parseString(searchParams.get("um")),
      campaign: parseString(searchParams.get("uc")),
      referrer: parseString(searchParams.get("rd")),
      step: parseOptionalInt(searchParams.get("ws"), 1, 6),
      dow: parseOptionalInt(searchParams.get("dw"), 0, 6),
      hour: parseOptionalInt(searchParams.get("hr"), 0, 23),
      depot: parseString(searchParams.get("dp")),
      category: parseString(searchParams.get("ct")),
      vehicle: parseString(searchParams.get("vh")),
      code: parseString(searchParams.get("dc")),
    }),
    [searchParams],
  );

  const setFilters = React.useCallback(
    (patch: Partial<AnalyticsFilters>) => {
      const next = new URLSearchParams(searchParams.toString());
      const write = (key: string, value: string | null) => {
        if (value == null || value === "") next.delete(key);
        else next.set(key, value);
      };
      if ("range" in patch) write("r", patch.range === "7D" || !patch.range ? null : patch.range);
      if ("compare" in patch) write("c", patch.compare ? "1" : null);
      if ("segment" in patch)
        write("seg", patch.segment === "ALL" || !patch.segment ? null : patch.segment);
      if ("country" in patch) write("co", patch.country ?? null);
      if ("landing" in patch) write("lp", patch.landing ?? null);
      if ("source" in patch) write("us", patch.source ?? null);
      if ("medium" in patch) write("um", patch.medium ?? null);
      if ("campaign" in patch) write("uc", patch.campaign ?? null);
      if ("referrer" in patch) write("rd", patch.referrer ?? null);
      if ("step" in patch) write("ws", patch.step == null ? null : String(patch.step));
      if ("dow" in patch) write("dw", patch.dow == null ? null : String(patch.dow));
      if ("hour" in patch) write("hr", patch.hour == null ? null : String(patch.hour));
      if ("depot" in patch) write("dp", patch.depot ?? null);
      if ("category" in patch) write("ct", patch.category ?? null);
      if ("vehicle" in patch) write("vh", patch.vehicle ?? null);
      if ("code" in patch) write("dc", patch.code ?? null);
      const qs = next.toString();
      router.replace(qs ? `/staff/live?${qs}` : "/staff/live", { scroll: false });
    },
    [router, searchParams],
  );

  const drilldownKeys = [
    "country",
    "landing",
    "source",
    "medium",
    "campaign",
    "referrer",
    "step",
    "dow",
    "hour",
    "depot",
    "category",
    "vehicle",
    "code",
  ] as const;
  const hasDrilldown = drilldownKeys.some((k) => filters[k] != null);

  const clearDrilldown = React.useCallback(() => {
    setFilters({
      country: null,
      landing: null,
      source: null,
      medium: null,
      campaign: null,
      referrer: null,
      step: null,
      dow: null,
      hour: null,
      depot: null,
      category: null,
      vehicle: null,
      code: null,
    });
  }, [setFilters]);

  return { filters, setFilters, clearDrilldown, hasDrilldown };
}

export function rangeDays(range: AnalyticsRange): number {
  return range === "TODAY" ? 1 : range === "7D" ? 7 : range === "30D" ? 30 : 90;
}
