import { describe, expect, it } from "vitest";
import { shouldRewrite } from "../../../scripts/backfill-image-sizes";

describe("shouldRewrite", () => {
  it("rewrites when the saving meets the default 10% threshold", () => {
    expect(shouldRewrite(1000, 800)).toBe(true); // 20% smaller
    expect(shouldRewrite(1000, 900)).toBe(true); // exactly 10%
  });

  it("skips images that barely shrink", () => {
    expect(shouldRewrite(1000, 950)).toBe(false); // 5% — not worth a rewrite
  });

  it("never rewrites when re-encoding would bloat the file", () => {
    expect(shouldRewrite(1000, 1100)).toBe(false);
  });

  it("guards against a zero/unknown original size", () => {
    expect(shouldRewrite(0, 0)).toBe(false);
  });

  it("honours a custom saving ratio", () => {
    expect(shouldRewrite(1000, 940, 0.05)).toBe(true); // 6% >= 5%
    expect(shouldRewrite(1000, 960, 0.05)).toBe(false); // 4% < 5%
  });
});
