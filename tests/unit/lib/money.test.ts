import { describe, expect, test } from "vitest";
import {
  aud,
  roundCents,
  gstFromInclusive,
  subtotalExGst,
  sum,
  times,
  divide,
  applyPercentage,
  toStripeCents,
  fromStripeCents,
  toNumber,
} from "@/lib/money";

describe("money utilities (Prisma.Decimal-backed)", () => {
  test("roundCents half-up at the 2dp boundary", () => {
    expect(toNumber(roundCents("0.005"))).toBe(0.01);
    expect(toNumber(roundCents("0.014"))).toBe(0.01);
    expect(toNumber(roundCents("0.015"))).toBe(0.02);
  });

  test("gst = total / 11 on a known-tricky GST-inclusive value", () => {
    // $110 inclusive → $10 GST, $100 ex-GST
    expect(toNumber(gstFromInclusive(110))).toBe(10);
    expect(toNumber(subtotalExGst(110))).toBe(100);
  });

  test("weekly rate division preserves precision vs JS / operator", () => {
    // Legacy code: Number('279') / 7 = 39.857142857142854 → drifts after *5
    // New code: aud('279').div(7) stays at full Decimal precision.
    const perDay = divide(279, 7);
    const fiveDays = times(perDay, 5);
    // 279 × 5 / 7 = 1395 / 7 = 199.285714... → rounded to 199.29
    expect(toNumber(roundCents(fiveDays))).toBe(199.29);
  });

  test("sum accumulates multiple Decimals exactly", () => {
    const total = sum("0.1", "0.2", "0.3", "0.4");
    expect(toNumber(roundCents(total))).toBe(1);
  });

  test("applyPercentage for a 10% discount", () => {
    // $79.95 × (1 - 0.10) = $71.955 → $71.96 (half-up)
    expect(toNumber(roundCents(applyPercentage(79.95, 0.1)))).toBe(71.96);
  });

  test("toStripeCents is integer and round-trips", () => {
    expect(toStripeCents(49)).toBe(4900);
    expect(toStripeCents("0.015")).toBe(2); // half-up
    expect(toNumber(fromStripeCents(4900))).toBe(49);
  });

  test("aud() coerces null/undefined to zero", () => {
    expect(toNumber(aud(null))).toBe(0);
    expect(toNumber(aud(undefined))).toBe(0);
  });
});
