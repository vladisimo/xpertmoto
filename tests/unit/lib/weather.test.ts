import { describe, it, expect } from "vitest";
import { isRidingUnsafe, summariseWeatherCode } from "@/lib/weather";

describe("summariseWeatherCode", () => {
  it("maps known WMO codes", () => {
    expect(summariseWeatherCode(0)).toBe("Clear sky");
    expect(summariseWeatherCode(95)).toBe("Thunderstorm");
  });
  it("returns Unknown for unexpected codes", () => {
    expect(summariseWeatherCode(999)).toBe("Unknown");
  });
});

describe("isRidingUnsafe", () => {
  const base = {
    date: "2026-05-01",
    tempMaxC: 25,
    tempMinC: 15,
    precipitationMm: 0,
    precipitationProbability: 10,
    weatherCode: 0,
    summary: "Clear",
  };

  it("flags thunderstorms as unsafe", () => {
    expect(isRidingUnsafe({ ...base, weatherCode: 95 })).toBe(true);
  });

  it("flags heavy showers as unsafe", () => {
    expect(isRidingUnsafe({ ...base, weatherCode: 82 })).toBe(true);
  });

  it("flags high rain probability as unsafe", () => {
    expect(isRidingUnsafe({ ...base, precipitationProbability: 80 })).toBe(true);
  });

  it("keeps clear sunny days safe", () => {
    expect(isRidingUnsafe(base)).toBe(false);
  });
});
