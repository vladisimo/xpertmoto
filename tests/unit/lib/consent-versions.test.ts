import { describe, expect, test } from "vitest";
import {
  GRANDFATHERED_TERMS_VERSIONS,
  needsReconsent,
  TERMS_VERSION,
} from "@/lib/consent-versions";

describe("needsReconsent", () => {
  test("requires consent when user has never accepted", () => {
    expect(needsReconsent(null)).toBe(true);
    expect(needsReconsent(undefined)).toBe(true);
    expect(needsReconsent("")).toBe(true);
  });

  test("accepts the current terms version", () => {
    expect(needsReconsent(TERMS_VERSION)).toBe(false);
  });

  test("accepts any grandfathered version", () => {
    for (const v of GRANDFATHERED_TERMS_VERSIONS) {
      expect(needsReconsent(v)).toBe(false);
    }
  });

  test("rejects a non-grandfathered old version", () => {
    expect(needsReconsent("v0.0-never-shipped")).toBe(true);
  });
});
