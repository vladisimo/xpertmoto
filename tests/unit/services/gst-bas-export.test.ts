import { describe, expect, test } from "vitest";
import { quarterBoundaries } from "@/server/services/gst-bas-export";

describe("quarterBoundaries", () => {
  test("Q1 of 2026 = Jan-Mar", () => {
    const { from, to, label } = quarterBoundaries(2026, 1);
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(label).toBe("2026-Q1");
  });

  test("Q2 of 2026 = Apr-Jun", () => {
    const { from, to } = quarterBoundaries(2026, 2);
    expect(from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  test("Q3 of 2026 = Jul-Sep", () => {
    const { from, to } = quarterBoundaries(2026, 3);
    expect(from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  test("Q4 of 2026 = Oct-Dec (and spills into next year)", () => {
    const { from, to } = quarterBoundaries(2026, 4);
    expect(from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
