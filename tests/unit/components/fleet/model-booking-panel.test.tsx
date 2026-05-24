import { describe, expect, it } from "vitest";

import {
  buildBookingHref,
  filterModelUnits,
  rangeReady,
} from "@/components/fleet/model-booking-panel";

describe("rangeReady", () => {
  it("is false until both dates are present", () => {
    expect(rangeReady("", "")).toBe(false);
    expect(rangeReady("2026-06-01T10:00", "")).toBe(false);
    expect(rangeReady("", "2026-06-02T10:00")).toBe(false);
  });

  it("requires a strictly positive range", () => {
    expect(rangeReady("2026-06-02T10:00", "2026-06-01T10:00")).toBe(false);
    expect(rangeReady("2026-06-01T10:00", "2026-06-01T10:00")).toBe(false);
    expect(rangeReady("2026-06-01T10:00", "2026-06-02T10:00")).toBe(true);
  });
});

describe("filterModelUnits", () => {
  const units = [
    { id: "v1", modelId: "m-cbr" },
    { id: "v2", modelId: "m-monster" },
    { id: "v3", modelId: "m-cbr" },
    { id: "v4", modelId: null },
  ];

  it("keeps only units of the target model", () => {
    expect(filterModelUnits(units, "m-cbr").map((u) => u.id)).toEqual(["v1", "v3"]);
  });

  it("returns empty when no unit matches", () => {
    expect(filterModelUnits(units, "m-vespa")).toEqual([]);
  });
});

describe("buildBookingHref", () => {
  it("builds the five-param deep link when a unit is free", () => {
    const href = buildBookingHref({
      categoryId: "cat-1",
      depotId: "depot-1",
      vehicleId: "v3",
      pickup: "2026-06-01T10:00",
      ret: "2026-06-04T10:00",
    });
    expect(href).not.toBeNull();
    const url = new URL(href!, "https://x.test");
    expect(url.pathname).toBe("/booking");
    expect(url.searchParams.get("categoryId")).toBe("cat-1");
    expect(url.searchParams.get("depotId")).toBe("depot-1");
    expect(url.searchParams.get("vehicleId")).toBe("v3");
    expect(url.searchParams.get("pickup")).toBe("2026-06-01T10:00");
    expect(url.searchParams.get("return")).toBe("2026-06-04T10:00");
  });

  it("returns null when no specific unit is free", () => {
    expect(
      buildBookingHref({
        categoryId: "cat-1",
        depotId: "depot-1",
        vehicleId: null,
        pickup: "2026-06-01T10:00",
        ret: "2026-06-04T10:00",
      }),
    ).toBeNull();
  });

  it("returns null when no depot is chosen", () => {
    expect(
      buildBookingHref({
        categoryId: "cat-1",
        depotId: "",
        vehicleId: "v3",
        pickup: "2026-06-01T10:00",
        ret: "2026-06-04T10:00",
      }),
    ).toBeNull();
  });
});
