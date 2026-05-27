import { describe, it, expect, afterEach } from "vitest";
import {
  ratePerEventAud,
  estimateCostAud,
  hasCustomPricing,
} from "@/lib/observability-pricing";

const PRICE_ENV = [
  "SENTRY_PRICE_ERROR",
  "SENTRY_PRICE_TRANSACTION",
  "SENTRY_PRICE_REPLAY",
  "SENTRY_PRICE_ATTACHMENT",
] as const;

afterEach(() => {
  for (const k of PRICE_ENV) delete process.env[k];
});

describe("observability-pricing", () => {
  it("falls back to placeholder defaults with no env set", () => {
    expect(ratePerEventAud("error")).toBe(0.0005);
    expect(ratePerEventAud("transaction")).toBe(0.00003);
    expect(hasCustomPricing()).toBe(false);
  });

  it("returns 0 for an unknown metric", () => {
    expect(ratePerEventAud("widgets")).toBe(0);
    expect(estimateCostAud("widgets", 1000)).toBe(0);
  });

  it("honours a valid env override and flags custom pricing", () => {
    process.env.SENTRY_PRICE_ERROR = "0.01";
    expect(ratePerEventAud("error")).toBe(0.01);
    expect(hasCustomPricing()).toBe(true);
  });

  it("ignores a non-numeric or negative override", () => {
    process.env.SENTRY_PRICE_REPLAY = "free";
    expect(ratePerEventAud("replay")).toBe(0.004);
    process.env.SENTRY_PRICE_REPLAY = "-1";
    expect(ratePerEventAud("replay")).toBe(0.004);
  });

  it("estimates cost as rate × quantity", () => {
    expect(estimateCostAud("error", 26)).toBeCloseTo(0.013, 6);
    expect(estimateCostAud("transaction", 4557)).toBeCloseTo(0.13671, 6);
  });
});
