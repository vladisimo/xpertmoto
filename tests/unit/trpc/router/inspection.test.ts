import { describe, expect, test } from "vitest";
import { toStoredMarkers } from "@/server/trpc/router/inspection";

const FIXED_NOW = new Date("2026-04-18T10:00:00.000Z");

describe("toStoredMarkers", () => {
  test("defaults missing view to LEFT (legacy-safe persistence)", () => {
    const [out] = toStoredMarkers(
      [{ x: 0.1, y: 0.2, severity: "MINOR", source: "staff" }],
      FIXED_NOW,
    );
    expect(out?.view).toBe("LEFT");
  });

  test("preserves a supplied view unchanged", () => {
    const stored = toStoredMarkers(
      [
        { x: 0.1, y: 0.2, severity: "MINOR", source: "staff", view: "RIGHT" },
        { x: 0.3, y: 0.4, severity: "MODERATE", source: "customer", view: "FRONT" },
        { x: 0.5, y: 0.6, severity: "MAJOR", source: "staff", view: "REAR" },
      ],
      FIXED_NOW,
    );
    expect(stored.map((m) => m.view)).toEqual(["RIGHT", "FRONT", "REAR"]);
  });

  test("stamps addedAt when missing, preserves when supplied", () => {
    const stored = toStoredMarkers(
      [
        { x: 0, y: 0, severity: "MINOR", source: "staff" },
        { x: 0, y: 0, severity: "MINOR", source: "staff", addedAt: "2025-12-01T00:00:00.000Z" },
      ],
      FIXED_NOW,
    );
    expect(stored[0]?.addedAt).toBe(FIXED_NOW.toISOString());
    expect(stored[1]?.addedAt).toBe("2025-12-01T00:00:00.000Z");
  });

  test("propagates id, note, severity, source verbatim", () => {
    const [out] = toStoredMarkers(
      [{ id: "abc", x: 0.1, y: 0.2, severity: "MAJOR", note: "cracked panel", source: "customer", view: "REAR" }],
      FIXED_NOW,
    );
    expect(out).toEqual({
      id: "abc",
      x: 0.1,
      y: 0.2,
      severity: "MAJOR",
      note: "cracked panel",
      source: "customer",
      view: "REAR",
      addedAt: FIXED_NOW.toISOString(),
    });
  });

  test("empty array round-trips to empty array", () => {
    expect(toStoredMarkers([], FIXED_NOW)).toEqual([]);
  });
});
