import { describe, expect, it } from "vitest";
import { BikeType } from "@prisma/client";
import {
  BIKE_TYPES,
  BIKE_TYPE_LABELS,
  BIKE_TYPE_SLUGS,
  slugToBikeType,
  bikeTypeToSlug,
} from "@/lib/bike-types";

describe("bike-types metadata", () => {
  it("covers every BikeType enum value exactly once", () => {
    const enumValues = Object.values(BikeType).sort();
    expect([...BIKE_TYPES].sort()).toEqual(enumValues);
  });

  it("has a label and slug for every type", () => {
    for (const t of BIKE_TYPES) {
      expect(BIKE_TYPE_LABELS[t]).toBeTruthy();
      expect(BIKE_TYPE_SLUGS[t]).toBeTruthy();
    }
  });

  it("slugs are unique", () => {
    const slugs = new Set(BIKE_TYPES.map(bikeTypeToSlug));
    expect(slugs.size).toBe(BIKE_TYPES.length);
  });
});

describe("slug round-trips", () => {
  it("maps every type to a slug and back", () => {
    for (const t of BIKE_TYPES) {
      expect(slugToBikeType(bikeTypeToSlug(t))).toBe(t);
    }
  });

  it("returns null for unknown / empty slugs", () => {
    expect(slugToBikeType("dirtbike")).toBeNull();
    expect(slugToBikeType(undefined)).toBeNull();
    expect(slugToBikeType(null)).toBeNull();
  });
});
