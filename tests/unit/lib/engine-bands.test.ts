import { describe, expect, it } from "vitest";
import {
  ENGINE_BANDS,
  ENGINE_BAND_LABELS,
  ENGINE_BAND_SLUGS,
  ccToBand,
  bandToRange,
  bandToWhere,
  slugToBand,
  bandToSlug,
} from "@/lib/engine-bands";

describe("ccToBand", () => {
  it("returns null below the smallest band", () => {
    expect(ccToBand(109)).toBeNull();
    expect(ccToBand(0)).toBeNull();
  });

  it("returns null for null/undefined cc", () => {
    expect(ccToBand(null)).toBeNull();
    expect(ccToBand(undefined)).toBeNull();
  });

  it("buckets boundary values inclusively", () => {
    expect(ccToBand(110)).toBe("CC_110_160");
    expect(ccToBand(160)).toBe("CC_110_160");
    expect(ccToBand(161)).toBe("CC_161_300");
    expect(ccToBand(300)).toBe("CC_161_300");
    expect(ccToBand(301)).toBe("CC_301_600");
    expect(ccToBand(600)).toBe("CC_301_600");
    expect(ccToBand(601)).toBe("CC_601_1000");
    expect(ccToBand(1000)).toBe("CC_601_1000");
  });

  it("puts anything above 1000 in the open-ended top band", () => {
    expect(ccToBand(1001)).toBe("CC_1000_PLUS");
    expect(ccToBand(1300)).toBe("CC_1000_PLUS");
  });
});

describe("bandToRange / bandToWhere", () => {
  it("returns inclusive bounds with an open top", () => {
    expect(bandToRange("CC_110_160")).toEqual({ min: 110, max: 160 });
    expect(bandToRange("CC_1000_PLUS")).toEqual({ min: 1001, max: null });
  });

  it("omits lte for the open-ended top band", () => {
    expect(bandToWhere("CC_301_600")).toEqual({ gte: 301, lte: 600 });
    expect(bandToWhere("CC_1000_PLUS")).toEqual({ gte: 1001 });
  });
});

describe("slug round-trips", () => {
  it("maps every band to a unique slug and back", () => {
    for (const band of ENGINE_BANDS) {
      expect(slugToBand(bandToSlug(band))).toBe(band);
    }
    const slugs = new Set(ENGINE_BANDS.map(bandToSlug));
    expect(slugs.size).toBe(ENGINE_BANDS.length);
  });

  it("returns null for unknown / empty slugs", () => {
    expect(slugToBand("999cc")).toBeNull();
    expect(slugToBand(undefined)).toBeNull();
    expect(slugToBand(null)).toBeNull();
  });
});

describe("metadata completeness", () => {
  it("has a label and slug for every band", () => {
    for (const band of ENGINE_BANDS) {
      expect(ENGINE_BAND_LABELS[band]).toBeTruthy();
      expect(ENGINE_BAND_SLUGS[band]).toBeTruthy();
    }
  });
});
