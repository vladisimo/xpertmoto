import { describe, expect, test } from "vitest";
import {
  ALERT_SCHEMA,
  SEGMENT_FILTER_SCHEMA,
  FUNNEL_STEPS_SCHEMA,
  cooldownElapsed,
  evaluateOperator,
} from "@/lib/analytics/segments";

describe("evaluateOperator", () => {
  test("greater / less / eq variants", () => {
    expect(evaluateOperator(5, ">", 3)).toBe(true);
    expect(evaluateOperator(3, ">", 3)).toBe(false);
    expect(evaluateOperator(3, ">=", 3)).toBe(true);
    expect(evaluateOperator(2, "<", 3)).toBe(true);
    expect(evaluateOperator(3, "<=", 3)).toBe(true);
    expect(evaluateOperator(3, "==", 3)).toBe(true);
    expect(evaluateOperator(3, "==", 4)).toBe(false);
  });
});

describe("cooldownElapsed", () => {
  const now = new Date("2026-04-21T12:00:00Z");

  test("true when lastFiredAt is null", () => {
    expect(cooldownElapsed(null, 60, now)).toBe(true);
  });

  test("false when still inside cooldown window", () => {
    const fired = new Date(now.getTime() - 30 * 60_000);
    expect(cooldownElapsed(fired, 60, now)).toBe(false);
  });

  test("true when exactly at cooldown boundary", () => {
    const fired = new Date(now.getTime() - 60 * 60_000);
    expect(cooldownElapsed(fired, 60, now)).toBe(true);
  });

  test("true when comfortably past cooldown", () => {
    const fired = new Date(now.getTime() - 2 * 60 * 60_000);
    expect(cooldownElapsed(fired, 60, now)).toBe(true);
  });
});

describe("SEGMENT_FILTER_SCHEMA", () => {
  test("accepts a minimal filter", () => {
    const r = SEGMENT_FILTER_SCHEMA.safeParse({});
    expect(r.success).toBe(true);
  });

  test("rejects wrong-length country code", () => {
    const r = SEGMENT_FILTER_SCHEMA.safeParse({ country: "AUS" });
    expect(r.success).toBe(false);
  });

  test("accepts a fully-populated filter", () => {
    const r = SEGMENT_FILTER_SCHEMA.safeParse({
      segment: "MOBILE",
      country: "AU",
      landingPath: "/fleet",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "summer24",
      referrerDomain: "google.com",
      wizardStepEq: 3,
      dow: 6,
      hour: 14,
      pickupDepotId: "dep_gc",
      categoryId: "cat_50",
      vehicleId: "veh_honda",
      discountCode: "SUMMER10",
    });
    expect(r.success).toBe(true);
  });

  test("rejects wizardStepEq out of range", () => {
    expect(SEGMENT_FILTER_SCHEMA.safeParse({ wizardStepEq: 0 }).success).toBe(false);
    expect(SEGMENT_FILTER_SCHEMA.safeParse({ wizardStepEq: 7 }).success).toBe(false);
  });
});

describe("FUNNEL_STEPS_SCHEMA", () => {
  test("requires at least 2 steps", () => {
    const r = FUNNEL_STEPS_SCHEMA.safeParse([
      { kind: "path", label: "Home", match: "/" },
    ]);
    expect(r.success).toBe(false);
  });

  test("accepts mixed step kinds", () => {
    const r = FUNNEL_STEPS_SCHEMA.safeParse([
      { kind: "path", label: "Home", match: "/" },
      { kind: "event", label: "CTA", eventKind: "CTA_CLICK" },
      { kind: "wizardStep", label: "Wizard 3", minStep: 3 },
      { kind: "outcome", label: "Converted", outcome: "CONVERTED" },
    ]);
    expect(r.success).toBe(true);
  });

  test("rejects unknown event kind", () => {
    const r = FUNNEL_STEPS_SCHEMA.safeParse([
      { kind: "path", label: "Home", match: "/" },
      { kind: "event", label: "X", eventKind: "NONSENSE" },
    ]);
    expect(r.success).toBe(false);
  });

  test("rejects more than 8 steps", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({
      kind: "path" as const,
      label: `S${i}`,
      match: "/",
    }));
    expect(FUNNEL_STEPS_SCHEMA.safeParse(nine).success).toBe(false);
  });
});

describe("ALERT_SCHEMA", () => {
  test("accepts a well-formed alert", () => {
    const r = ALERT_SCHEMA.safeParse({
      name: "Bounces spike",
      metric: "bounces_last_hour",
      operator: ">",
      threshold: 20,
      notifyEmails: ["ops@xpert.com"],
      cooldownMinutes: 60,
      isActive: true,
    });
    expect(r.success).toBe(true);
  });

  test("rejects invalid email", () => {
    const r = ALERT_SCHEMA.safeParse({
      name: "x",
      metric: "bounces_last_hour",
      operator: ">",
      threshold: 20,
      notifyEmails: ["not-an-email"],
    });
    expect(r.success).toBe(false);
  });

  test("rejects unknown metric", () => {
    const r = ALERT_SCHEMA.safeParse({
      name: "x",
      metric: "cosmic_ray_count",
      operator: ">",
      threshold: 1,
      notifyEmails: ["ops@xpert.com"],
    });
    expect(r.success).toBe(false);
  });

  test("rejects cooldown outside range", () => {
    const below = ALERT_SCHEMA.safeParse({
      name: "x",
      metric: "bounces_last_hour",
      operator: ">",
      threshold: 1,
      notifyEmails: ["ops@xpert.com"],
      cooldownMinutes: 1,
    });
    expect(below.success).toBe(false);
  });
});
