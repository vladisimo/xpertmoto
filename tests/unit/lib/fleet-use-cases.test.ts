import { describe, expect, it } from "vitest";
import { FleetUseCase } from "@prisma/client";
import {
  USE_CASES,
  USE_CASE_LABELS,
  USE_CASE_SLUGS,
  USE_CASE_DESCRIPTIONS,
  DEFAULT_USE_CASE,
  slugToUseCase,
  // Aliased: the bare `useCaseToSlug` name trips eslint's rules-of-hooks
  // (any `use*` identifier is assumed to be a React hook) when called in a loop.
  useCaseToSlug as toSlug,
} from "@/lib/fleet-use-cases";

describe("trimmed FleetUseCase taxonomy", () => {
  it("is exactly the four pure use cases", () => {
    expect([...USE_CASES].sort()).toEqual(
      ["ADVENTURE", "COMMUTING", "DELIVERY", "PRACTICE"],
    );
  });

  it("matches the Prisma enum (no SPORT_CRUISER / LEARNER_APPROVED)", () => {
    expect(Object.values(FleetUseCase).sort()).toEqual([...USE_CASES].sort());
  });

  it("has a label, slug and description for every value", () => {
    for (const u of USE_CASES) {
      expect(USE_CASE_LABELS[u]).toBeTruthy();
      expect(USE_CASE_SLUGS[u]).toBeTruthy();
      expect(USE_CASE_DESCRIPTIONS[u]).toBeTruthy();
    }
  });

  it("DEFAULT_USE_CASE is a live value", () => {
    expect(USE_CASES).toContain(DEFAULT_USE_CASE);
  });
});

describe("slug resolution after the trim", () => {
  it("round-trips the surviving values", () => {
    for (const u of USE_CASES) {
      expect(slugToUseCase(toSlug(u))).toBe(u);
    }
  });

  it("the removed slugs no longer resolve", () => {
    expect(slugToUseCase("sport-cruiser")).toBeNull();
    expect(slugToUseCase("learner-approved")).toBeNull();
  });
});
