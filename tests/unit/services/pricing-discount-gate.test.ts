import { describe, expect, it } from "vitest";
import { isDiscountUsable } from "@/server/services/pricing";

/**
 * Discount-code usability gate. Previously only `isActive` was checked —
 * expired, exhausted, out-of-scope, and under-minimum codes all kept
 * discounting, and single-use recovery codes were infinitely reusable.
 */
const NOW = new Date("2026-07-05T10:00:00+10:00");

function makeDiscount(over: Record<string, unknown> = {}) {
  return {
    isActive: true,
    validFrom: null,
    validTo: null,
    maxUses: null,
    usedCount: 0,
    minBookingDays: null,
    minBookingValue: null,
    applicableCategoryIds: [] as string[],
    applicableDepotIds: [] as string[],
    ...over,
  };
}

const CTX = {
  now: NOW,
  durationDays: 3,
  bookingValue: 250,
  categoryId: "cat_scooter",
  depotId: "depot_gc",
};

describe("isDiscountUsable", () => {
  it("accepts an unrestricted active code", () => {
    expect(isDiscountUsable(makeDiscount(), CTX)).toBe(true);
  });

  it("rejects inactive codes", () => {
    expect(isDiscountUsable(makeDiscount({ isActive: false }), CTX)).toBe(false);
  });

  it("rejects before validFrom and after validTo, but accepts ON the validTo day", () => {
    expect(
      isDiscountUsable(makeDiscount({ validFrom: new Date("2026-08-01") }), CTX),
    ).toBe(false);
    expect(
      isDiscountUsable(makeDiscount({ validTo: new Date("2026-07-01") }), CTX),
    ).toBe(false);
    // validTo is date-only — valid THROUGH that whole day.
    expect(
      isDiscountUsable(makeDiscount({ validTo: new Date("2026-07-05T00:00:00Z") }), CTX),
    ).toBe(true);
  });

  it("rejects exhausted codes (single-use recovery codes stop after one use)", () => {
    expect(isDiscountUsable(makeDiscount({ maxUses: 1, usedCount: 1 }), CTX)).toBe(false);
    expect(isDiscountUsable(makeDiscount({ maxUses: 1, usedCount: 0 }), CTX)).toBe(true);
  });

  it("enforces booking minimums", () => {
    expect(isDiscountUsable(makeDiscount({ minBookingDays: 7 }), CTX)).toBe(false);
    expect(isDiscountUsable(makeDiscount({ minBookingValue: 500 }), CTX)).toBe(false);
    expect(isDiscountUsable(makeDiscount({ minBookingDays: 3, minBookingValue: 250 }), CTX)).toBe(
      true,
    );
  });

  it("enforces category/depot scoping when the code is scoped", () => {
    expect(
      isDiscountUsable(makeDiscount({ applicableCategoryIds: ["cat_moto"] }), CTX),
    ).toBe(false);
    expect(
      isDiscountUsable(makeDiscount({ applicableDepotIds: ["depot_bne"] }), CTX),
    ).toBe(false);
    expect(
      isDiscountUsable(
        makeDiscount({
          applicableCategoryIds: ["cat_scooter"],
          applicableDepotIds: ["depot_gc"],
        }),
        CTX,
      ),
    ).toBe(true);
  });
});
