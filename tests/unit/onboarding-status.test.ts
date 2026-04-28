import { describe, expect, it } from "vitest";

import {
  buildOnboardingVersion,
  needsOnboarding,
} from "@/lib/onboarding-status";
import {
  CANCELLATION_VERSION,
  MARKETING_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@/lib/consent-versions";

describe("needsOnboarding", () => {
  it("returns true when profile is null", () => {
    expect(needsOnboarding(null)).toBe(true);
  });

  it("returns true when onboardedAt is null", () => {
    expect(
      needsOnboarding({ onboardedAt: null, onboardingVersion: buildOnboardingVersion() }),
    ).toBe(true);
  });

  it("returns true when onboardingVersion is null", () => {
    expect(needsOnboarding({ onboardedAt: new Date(), onboardingVersion: null })).toBe(true);
  });

  it("returns false when onboardedAt + current joint version are present", () => {
    expect(
      needsOnboarding({
        onboardedAt: new Date(),
        onboardingVersion: buildOnboardingVersion(),
      }),
    ).toBe(false);
  });

  it("returns true when the joint key is malformed (wrong segment count)", () => {
    expect(
      needsOnboarding({ onboardedAt: new Date(), onboardingVersion: "v1.0|v1.0" }),
    ).toBe(true);
  });

  it("returns true when any segment is empty", () => {
    expect(
      needsOnboarding({
        onboardedAt: new Date(),
        onboardingVersion: `${TERMS_VERSION}|${PRIVACY_VERSION}||${MARKETING_VERSION}`,
      }),
    ).toBe(true);
  });

  it("returns true when a single segment is stale (e.g. terms bumped)", () => {
    const stale = `v0.9|${PRIVACY_VERSION}|${CANCELLATION_VERSION}|${MARKETING_VERSION}`;
    expect(needsOnboarding({ onboardedAt: new Date(), onboardingVersion: stale })).toBe(true);
  });
});

describe("buildOnboardingVersion", () => {
  it("joins the four current consent versions in fixed order", () => {
    expect(buildOnboardingVersion()).toBe(
      `${TERMS_VERSION}|${PRIVACY_VERSION}|${CANCELLATION_VERSION}|${MARKETING_VERSION}`,
    );
  });
});
