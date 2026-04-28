import { describe, expect, test } from "vitest";
import { normalizeMarkers } from "@/components/agreement/damage-map-canvas";

describe("normalizeMarkers", () => {
  test("defaults missing view to LEFT (legacy data)", () => {
    const input = [{ id: "m1", x: 0.5, y: 0.5, severity: "MINOR", source: "staff", addedAt: "2026-01-01T00:00:00Z" }];
    const [m] = normalizeMarkers(input);
    expect(m).toBeDefined();
    expect(m?.view).toBe("LEFT");
    expect(m?.id).toBe("m1");
  });

  test("preserves a valid view field", () => {
    const input = [
      { id: "m1", x: 0.1, y: 0.2, severity: "MAJOR", source: "staff", addedAt: "", view: "REAR" },
      { id: "m2", x: 0.3, y: 0.4, severity: "MODERATE", source: "customer", addedAt: "", view: "FRONT" },
    ];
    const out = normalizeMarkers(input);
    expect(out).toHaveLength(2);
    expect(out[0]?.view).toBe("REAR");
    expect(out[1]?.view).toBe("FRONT");
  });

  test("rejects bogus view values and falls back to LEFT", () => {
    const input = [{ id: "m1", x: 0, y: 0, severity: "MINOR", source: "staff", addedAt: "", view: "TOP" }];
    const [m] = normalizeMarkers(input);
    expect(m?.view).toBe("LEFT");
  });

  test("backfills missing id and clamps invalid severity/source", () => {
    const input = [{ x: 0.5, y: 0.5, severity: "UNKNOWN", source: "hacker" }];
    const [m] = normalizeMarkers(input);
    expect(m?.id).toMatch(/^m_\d+_/);
    expect(m?.severity).toBe("MINOR");
    expect(m?.source).toBe("staff");
    expect(m?.view).toBe("LEFT");
    expect(m?.addedAt).toBe("");
  });

  test("treats non-array input as empty", () => {
    expect(normalizeMarkers(null)).toEqual([]);
    expect(normalizeMarkers(undefined)).toEqual([]);
    expect(normalizeMarkers({ markers: [] } as unknown as unknown[])).toEqual([]);
  });
});
