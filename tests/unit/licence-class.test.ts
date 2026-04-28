import { describe, expect, test } from "vitest";
import {
  formatLicenceClasses,
  parseLicenceClasses,
} from "../../src/lib/licence-class";

describe("parseLicenceClasses", () => {
  test("returns [] for null/undefined/empty", () => {
    expect(parseLicenceClasses(null)).toEqual([]);
    expect(parseLicenceClasses(undefined)).toEqual([]);
    expect(parseLicenceClasses("")).toEqual([]);
    expect(parseLicenceClasses("   ")).toEqual([]);
  });

  test("splits comma-delimited and maps known codes", () => {
    expect(parseLicenceClasses("C, R LRN")).toEqual([
      { code: "C", label: "Car" },
      { code: "R LRN", label: "Motorbike Learner" },
    ]);
  });

  test("splits on forward slash", () => {
    expect(parseLicenceClasses("C/RE")).toEqual([
      { code: "C", label: "Car" },
      { code: "RE", label: "Motorbike (restricted)" },
    ]);
  });

  test("treats dash as internal separator so R-LRN matches R LRN", () => {
    expect(parseLicenceClasses("R-LRN")).toEqual([
      { code: "R LRN", label: "Motorbike Learner" },
    ]);
  });

  test("is case-insensitive and tolerates extra whitespace", () => {
    expect(parseLicenceClasses("  c ,  r   lrn  ")).toEqual([
      { code: "C", label: "Car" },
      { code: "R LRN", label: "Motorbike Learner" },
    ]);
  });

  test("single unknown code is returned with null label", () => {
    expect(parseLicenceClasses("ZZ")).toEqual([{ code: "ZZ", label: null }]);
  });

  test("keeps the raw code for unknown entries but still labels known ones", () => {
    expect(parseLicenceClasses("C, ZZ")).toEqual([
      { code: "C", label: "Car" },
      { code: "ZZ", label: null },
    ]);
  });
});

describe("formatLicenceClasses", () => {
  test("empty input → empty string", () => {
    expect(formatLicenceClasses(null)).toBe("");
    expect(formatLicenceClasses("")).toBe("");
  });

  test("joins tokens with comma, labelling known codes", () => {
    expect(formatLicenceClasses("C, R LRN")).toBe(
      "C (Car), R LRN (Motorbike Learner)",
    );
  });

  test("bare code when unknown", () => {
    expect(formatLicenceClasses("ZZ")).toBe("ZZ");
    expect(formatLicenceClasses("C, ZZ")).toBe("C (Car), ZZ");
  });
});
