import { describe, expect, it } from "vitest";
import { RiderLevel } from "@prisma/client";
import {
  RIDER_LEVELS,
  RIDER_LEVEL_LABELS,
  RIDER_LEVEL_SLUGS,
  slugToRiderLevel,
  riderLevelToSlug,
} from "@/lib/rider-levels";

describe("rider-levels metadata", () => {
  it("covers every RiderLevel enum value exactly once", () => {
    const enumValues = Object.values(RiderLevel).sort();
    expect([...RIDER_LEVELS].sort()).toEqual(enumValues);
  });

  it("has a label and slug for every level", () => {
    for (const l of RIDER_LEVELS) {
      expect(RIDER_LEVEL_LABELS[l]).toBeTruthy();
      expect(RIDER_LEVEL_SLUGS[l]).toBeTruthy();
    }
  });
});

describe("slug round-trips", () => {
  it("maps every level to a slug and back", () => {
    for (const l of RIDER_LEVELS) {
      expect(slugToRiderLevel(riderLevelToSlug(l))).toBe(l);
    }
  });

  it("returns null for unknown / empty slugs", () => {
    expect(slugToRiderLevel("expert")).toBeNull();
    expect(slugToRiderLevel(undefined)).toBeNull();
    expect(slugToRiderLevel(null)).toBeNull();
  });
});
