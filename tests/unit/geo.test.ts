import { test, expect } from "vitest";
import {
  haversineKm,
  deliveryFee,
  pointInPolygon,
  DEFAULT_DELIVERY_ZONES,
} from "../../src/lib/geo";

const GOLD_COAST = { lat: -28.0167, lng: 153.4 };
const BRISBANE = { lat: -27.4698, lng: 153.0251 };
const BYRON_BAY = { lat: -28.6474, lng: 153.6020 };

test("haversine — Gold Coast ↔ Brisbane ~72km", () => {
  const km = haversineKm(GOLD_COAST, BRISBANE);
  expect(Math.abs(km - 72)).toBeLessThan(4);
});

test("haversine — same point returns 0", () => {
  expect(haversineKm(GOLD_COAST, GOLD_COAST)).toBe(0);
});

test("deliveryFee — nearby uses cheapest zone", () => {
  const result = deliveryFee(
    GOLD_COAST,
    { lat: -28.02, lng: 153.41 },
    DEFAULT_DELIVERY_ZONES,
  );
  expect(result).toBeTruthy();
  expect(result!.fee).toBe(25);
});

test("deliveryFee — beyond furthest zone returns null", () => {
  const result = deliveryFee(GOLD_COAST, BYRON_BAY, DEFAULT_DELIVERY_ZONES);
  expect(result).toBeNull();
});

test("pointInPolygon — simple square", () => {
  const square = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];
  expect(pointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
  expect(pointInPolygon({ lat: 15, lng: 5 }, square)).toBe(false);
});
