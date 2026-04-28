import { describe, expect, test } from "vitest";
import {
  renderDigestEmail,
  type DigestAggregates,
} from "@/server/services/analytics-digest";

function fixture(overrides: Partial<DigestAggregates> = {}): DigestAggregates {
  return {
    periodStart: new Date("2026-04-14T00:00:00Z"),
    periodEnd: new Date("2026-04-21T00:00:00Z"),
    totalSessions: 3421,
    uniqueVisitors: 2891,
    conversions: 142,
    bounces: 817,
    abandonedWizard: 294,
    conversionRate: 0.0415,
    bounceRate: 0.2388,
    topLandingPath: { path: "/fleet/scooter", count: 612 },
    topCountry: { country: "AU", count: 3011 },
    topAbandonedVehicle: { label: "Honda PCX", count: 48 },
    exitIntents: 72,
    rageClicks: 4,
    vsPrevSessions: 0.18,
    vsPrevConversionRate: 0.004,
    ...overrides,
  };
}

describe("renderDigestEmail", () => {
  test("subject summarises total sessions and conversion rate", () => {
    const out = renderDigestEmail(fixture());
    expect(out.subject).toContain("3,421");
    expect(out.subject).toContain("4.15%");
  });

  test("body includes period and key metrics", () => {
    const out = renderDigestEmail(fixture());
    expect(out.text).toContain("2026-04-14");
    expect(out.text).toContain("2026-04-21");
    expect(out.text).toContain("3,421");
    expect(out.text).toContain("2,891");
    expect(out.text).toContain("Conversion rate: 4.15%");
    expect(out.text).toContain("/fleet/scooter");
    expect(out.text).toContain("Honda PCX");
  });

  test("renders deltas vs prior week when available", () => {
    const out = renderDigestEmail(fixture());
    expect(out.text).toMatch(/\+18\.0% vs prior week/);
    expect(out.text).toMatch(/\+0\.40pp vs prior week/);
  });

  test("omits deltas when prior week had zero sessions", () => {
    const out = renderDigestEmail(fixture({ vsPrevSessions: null, vsPrevConversionRate: null }));
    expect(out.text).not.toContain("vs prior week");
  });

  test("handles missing top-X entries gracefully", () => {
    const out = renderDigestEmail(
      fixture({ topLandingPath: null, topCountry: null, topAbandonedVehicle: null }),
    );
    expect(out.text).toContain("Top landing page: —");
    expect(out.text).toContain("Top country: —");
    expect(out.text).toContain("Top abandoned vehicle: —");
  });
});
