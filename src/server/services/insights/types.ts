/**
 * Shared types for the AI Insights feature. Each insight has:
 *
 *  - a deterministic `payload` produced by a Prisma aggregation generator,
 *  - an AI-authored `narrative` (headline / summary / recommendation),
 *  - metadata the UI uses to render the card and drill-down.
 *
 * Numbers and time series are produced by the generators — never by the
 * AI — so the charts always match the database even if the AI is offline.
 */

import type { DataReadiness } from "./readiness";

export const INSIGHT_IDS = [
  "repeat-cohort",
  "top-customers-at-risk",
  "revenue-per-vehicle-day",
  "maintenance-vs-revenue",
  "revenue-trend",
  "acquisition-conversion",
] as const;

export type InsightId = (typeof INSIGHT_IDS)[number];

export type InsightPillar = "customer" | "fleet" | "revenue" | "acquisition";

export type InsightPriority = "HIGH" | "MEDIUM" | "LOW";

export interface InsightNarrative {
  headline: string;
  summary: string;
  recommendation: string;
  priority: InsightPriority;
  confidence: number;
}

export interface InsightKeyMetric {
  label: string;
  value: string;
  trendPct?: number;
  trendLabel?: string;
}

// ---------------------------------------------------------------------------
// Per-insight payload shapes. Discriminated union on `id`.
// ---------------------------------------------------------------------------

export interface RepeatCohortPayload {
  id: "repeat-cohort";
  cohorts: Array<{
    cohortMonth: string;
    newCustomers: number;
    returnedByMonth: number[];
  }>;
  overallRepeatRate: number;
  bestCohort: { month: string; rate: number } | null;
  headlineMetric: InsightKeyMetric;
}

export interface TopCustomersAtRiskPayload {
  id: "top-customers-at-risk";
  rows: Array<{
    customerId: string;
    name: string;
    email: string | null;
    totalSpend: number;
    totalBookings: number;
    lastBookingAt: string | null;
    daysSinceLastBooking: number | null;
    riskRating: "LOW" | "MEDIUM" | "HIGH";
    atRisk: boolean;
  }>;
  atRiskCount: number;
  atRiskSpend: number;
  headlineMetric: InsightKeyMetric;
}

export interface RevenuePerVehicleDayPayload {
  id: "revenue-per-vehicle-day";
  rows: Array<{
    vehicleId: string;
    internalCode: string;
    label: string;
    category: string;
    revenue: number;
    availableDays: number;
    revenuePerDay: number;
  }>;
  fleetAverage: number;
  top: Array<{ label: string; value: number }>;
  bottom: Array<{ label: string; value: number }>;
  headlineMetric: InsightKeyMetric;
}

export interface MaintenanceVsRevenuePayload {
  id: "maintenance-vs-revenue";
  points: Array<{
    vehicleId: string;
    internalCode: string;
    label: string;
    revenue: number;
    maintenanceCost: number;
    net: number;
    lossMaker: boolean;
  }>;
  lossMakerCount: number;
  totalNet: number;
  medianRevenue: number;
  medianMaintenance: number;
  headlineMetric: InsightKeyMetric;
}

export interface RevenueTrendPayload {
  id: "revenue-trend";
  months: Array<{
    month: string;
    currentRevenue: number;
    priorYearRevenue: number;
  }>;
  mom: { changePct: number | null; direction: "up" | "down" | "flat" };
  yoy: { changePct: number | null; direction: "up" | "down" | "flat" };
  latestMonth: string | null;
  headlineMetric: InsightKeyMetric;
}

export interface AcquisitionConversionPayload {
  id: "acquisition-conversion";
  sources: Array<{
    source: string;
    sessions: number;
    bookings: number;
    conversionRate: number;
  }>;
  bestSource: { source: string; conversionRate: number } | null;
  worstSource: { source: string; conversionRate: number } | null;
  overallConversionRate: number;
  headlineMetric: InsightKeyMetric;
}

export type InsightPayload =
  | RepeatCohortPayload
  | TopCustomersAtRiskPayload
  | RevenuePerVehicleDayPayload
  | MaintenanceVsRevenuePayload
  | RevenueTrendPayload
  | AcquisitionConversionPayload;

export interface InsightCard<P extends InsightPayload = InsightPayload> {
  id: InsightId;
  pillar: InsightPillar;
  title: string;
  payload: P;
  narrative: InsightNarrative;
  detailHref: string;
  generatedAt: string;
}

export interface InsightsOverview {
  cards: InsightCard[];
  generatedAt: string;
  scopeLabel: string;
  stale: boolean;
  readiness: DataReadiness;
}

export interface InsightsGeneratorContext {
  depotId?: string;
  now: Date;
}

export const PILLAR_META: Record<
  InsightPillar,
  { label: string; description: string; accentVar: string }
> = {
  customer: {
    label: "Customer",
    description: "Retention, loyalty, lifetime value and churn risk.",
    accentVar: "--staff-accent",
  },
  fleet: {
    label: "Fleet",
    description:
      "Per-vehicle revenue, maintenance ROI and utilisation signals.",
    accentVar: "--admin-accent",
  },
  revenue: {
    label: "Revenue",
    description: "Monthly trend, year-on-year momentum, seasonality.",
    accentVar: "--accent",
  },
  acquisition: {
    label: "Acquisition",
    description: "How visitors become customers and which channels work.",
    accentVar: "--secondary",
  },
};

export const INSIGHT_META: Record<
  InsightId,
  { pillar: InsightPillar; title: string }
> = {
  "repeat-cohort": {
    pillar: "customer",
    title: "Repeat-customer cohort",
  },
  "top-customers-at-risk": {
    pillar: "customer",
    title: "Top customers at risk",
  },
  "revenue-per-vehicle-day": {
    pillar: "fleet",
    title: "Revenue per vehicle-day",
  },
  "maintenance-vs-revenue": {
    pillar: "fleet",
    title: "Maintenance cost vs revenue",
  },
  "revenue-trend": {
    pillar: "revenue",
    title: "Revenue trend with YoY",
  },
  "acquisition-conversion": {
    pillar: "acquisition",
    title: "Acquisition source conversion",
  },
};
