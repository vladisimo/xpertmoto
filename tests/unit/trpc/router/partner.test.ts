import { describe, expect, it } from "vitest";
import {
  computePartnerCommission,
  slugifyTracking,
} from "@/server/trpc/router/partner";

describe("computePartnerCommission", () => {
  it("returns 0 for a zero total", () => {
    expect(computePartnerCommission(0, 10)).toBe(0);
  });

  it("rounds to cents", () => {
    // 333.33 × 12.5% = 41.66625 → 41.67
    expect(computePartnerCommission(333.33, 12.5)).toBe(41.67);
  });

  it("handles whole-dollar totals cleanly", () => {
    expect(computePartnerCommission(500, 10)).toBe(50);
  });

  it("scales linearly with total", () => {
    const a = computePartnerCommission(100, 15);
    const b = computePartnerCommission(200, 15);
    expect(b).toBeCloseTo(a * 2);
  });

  it("handles 0% commission", () => {
    expect(computePartnerCommission(500, 0)).toBe(0);
  });
});

describe("slugifyTracking", () => {
  it("uppercases and hyphenates", () => {
    expect(slugifyTracking("Hotel Brisbane")).toBe("HOTEL-BRISBANE");
  });

  it("strips special characters", () => {
    expect(slugifyTracking("Surf Co. & Mates!")).toBe("SURF-CO-MATES");
  });

  it("caps at 16 characters", () => {
    expect(slugifyTracking("a-very-long-partner-name-indeed").length).toBeLessThanOrEqual(16);
  });

  it("trims leading/trailing separators after slicing", () => {
    expect(slugifyTracking("-hello-")).toBe("HELLO");
  });

  it("falls back to PARTNER for empty inputs", () => {
    expect(slugifyTracking("")).toBe("PARTNER");
    expect(slugifyTracking("!!!")).toBe("PARTNER");
  });
});
