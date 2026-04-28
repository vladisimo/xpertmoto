import { test, expect } from "vitest";
import { calcDepreciation } from "../src/server/services/depreciation";

test("straight-line depreciation halves over half useful life", () => {
  const r = calcDepreciation({
    purchasePrice: 10000,
    purchaseDate: new Date("2023-01-01"),
    method: "STRAIGHT_LINE",
    rate: 20,
    asOf: new Date("2025-01-01"),
  });
  expect(Math.abs(r.bookValue - 6000)).toBeLessThan(10);
  expect(Math.abs(r.depreciation - 4000)).toBeLessThan(10);
});

test("straight-line caps at purchase price (no negative book value)", () => {
  const r = calcDepreciation({
    purchasePrice: 5000,
    purchaseDate: new Date("2010-01-01"),
    method: "STRAIGHT_LINE",
    rate: 20,
    asOf: new Date("2025-01-01"),
  });
  expect(r.bookValue).toBe(0);
  expect(r.depreciation).toBe(5000);
});

test("diminishing value never reaches zero", () => {
  const r = calcDepreciation({
    purchasePrice: 10000,
    purchaseDate: new Date("2020-01-01"),
    method: "DIMINISHING_VALUE",
    rate: 25,
    asOf: new Date("2025-01-01"),
  });
  expect(r.bookValue).toBeGreaterThan(0);
  expect(r.bookValue).toBeLessThan(3000);
});
