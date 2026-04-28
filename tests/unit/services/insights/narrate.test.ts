import { describe, expect, test } from "vitest";
import { fallbackNarrative } from "@/server/services/insights/narrate";
import type {
  AcquisitionConversionPayload,
  MaintenanceVsRevenuePayload,
  RepeatCohortPayload,
  RevenuePerVehicleDayPayload,
  RevenueTrendPayload,
  TopCustomersAtRiskPayload,
} from "@/server/services/insights/types";

describe("fallbackNarrative", () => {
  test("repeat-cohort: HIGH priority when rate is under 20%", () => {
    const payload: RepeatCohortPayload = {
      id: "repeat-cohort",
      overallRepeatRate: 0.12,
      bestCohort: { month: "2025-07", rate: 0.2 },
      cohorts: [],
      headlineMetric: { label: "Repeat", value: "12%" },
    };
    const n = fallbackNarrative(payload);
    expect(n.priority).toBe("HIGH");
    expect(n.headline).toContain("12%");
    expect(n.confidence).toBeGreaterThan(0);
    expect(n.recommendation.length).toBeGreaterThan(10);
  });

  test("repeat-cohort: LOW priority when rate is healthy", () => {
    const payload: RepeatCohortPayload = {
      id: "repeat-cohort",
      overallRepeatRate: 0.45,
      bestCohort: null,
      cohorts: [],
      headlineMetric: { label: "Repeat", value: "45%" },
    };
    expect(fallbackNarrative(payload).priority).toBe("LOW");
  });

  test("top-customers-at-risk: HIGH when at-risk spend exceeds $10k", () => {
    const payload: TopCustomersAtRiskPayload = {
      id: "top-customers-at-risk",
      rows: [],
      atRiskCount: 7,
      atRiskSpend: 15_200,
      headlineMetric: { label: "at-risk", value: "7" },
    };
    const n = fallbackNarrative(payload);
    expect(n.priority).toBe("HIGH");
    expect(n.headline).toContain("7");
  });

  test("revenue-per-vehicle-day: mentions top and bottom performers", () => {
    const payload: RevenuePerVehicleDayPayload = {
      id: "revenue-per-vehicle-day",
      rows: [],
      fleetAverage: 45,
      top: [{ label: "SCT-001", value: 88 }],
      bottom: [{ label: "SCT-012", value: 12 }],
      headlineMetric: { label: "avg", value: "$45" },
    };
    const n = fallbackNarrative(payload);
    expect(n.summary).toContain("SCT-001");
    expect(n.summary).toContain("SCT-012");
  });

  test("maintenance-vs-revenue: HIGH when there are >2 loss-makers", () => {
    const payload: MaintenanceVsRevenuePayload = {
      id: "maintenance-vs-revenue",
      points: [],
      lossMakerCount: 5,
      totalNet: 1200,
      medianRevenue: 3000,
      medianMaintenance: 500,
      headlineMetric: { label: "loss-makers", value: "5" },
    };
    expect(fallbackNarrative(payload).priority).toBe("HIGH");
  });

  test("revenue-trend: HIGH when YoY drops more than 5%", () => {
    const payload: RevenueTrendPayload = {
      id: "revenue-trend",
      months: [],
      mom: { changePct: -3, direction: "down" },
      yoy: { changePct: -8, direction: "down" },
      latestMonth: "2026-03",
      headlineMetric: { label: "revenue", value: "$0" },
    };
    const n = fallbackNarrative(payload);
    expect(n.priority).toBe("HIGH");
    expect(n.headline.toLowerCase()).toContain("down");
  });

  test("revenue-trend: phrasing flips on direction", () => {
    const up: RevenueTrendPayload = {
      id: "revenue-trend",
      months: [],
      mom: { changePct: 2, direction: "up" },
      yoy: { changePct: 10, direction: "up" },
      latestMonth: "2026-03",
      headlineMetric: { label: "revenue", value: "$0" },
    };
    expect(fallbackNarrative(up).headline.toLowerCase()).toContain("up");
  });

  test("acquisition-conversion: includes headline conversion rate", () => {
    const payload: AcquisitionConversionPayload = {
      id: "acquisition-conversion",
      sources: [],
      bestSource: { source: "google", conversionRate: 4.2 },
      worstSource: { source: "facebook", conversionRate: 1.1 },
      overallConversionRate: 2.5,
      headlineMetric: { label: "conv", value: "2.5%" },
    };
    const n = fallbackNarrative(payload);
    expect(n.headline).toContain("2.5");
    expect(n.summary).toContain("google");
    expect(n.summary).toContain("facebook");
  });

  test("narrative always respects the schema envelope (confidence 0-1)", () => {
    const payload: RepeatCohortPayload = {
      id: "repeat-cohort",
      overallRepeatRate: 0,
      bestCohort: null,
      cohorts: [],
      headlineMetric: { label: "x", value: "0%" },
    };
    const n = fallbackNarrative(payload);
    expect(n.confidence).toBeGreaterThanOrEqual(0);
    expect(n.confidence).toBeLessThanOrEqual(1);
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(n.priority);
  });
});
