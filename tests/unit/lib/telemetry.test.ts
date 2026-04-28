import { describe, it, expect } from "vitest";
import { haversineKm, TelemetryPingSchema } from "@/lib/telemetry";

describe("haversineKm", () => {
  it("returns 0 for same point", () => {
    expect(haversineKm({ lat: -28.5, lng: 153.5 }, { lat: -28.5, lng: 153.5 })).toBeCloseTo(0, 5);
  });

  it("computes Byron Bay → Gold Coast at ~70km", () => {
    const byron = { lat: -28.6474, lng: 153.6020 };
    const goldCoast = { lat: -28.0167, lng: 153.4000 };
    const km = haversineKm(byron, goldCoast);
    expect(km).toBeGreaterThan(65);
    expect(km).toBeLessThan(80);
  });
});

describe("TelemetryPingSchema", () => {
  it("accepts a valid ping", () => {
    const parsed = TelemetryPingSchema.parse({
      deviceId: "dev_1",
      timestamp: "2026-05-01T00:00:00Z",
      latitude: -28.6,
      longitude: 153.6,
      speedKph: 45,
      odometerKm: 1000,
    });
    expect(parsed.deviceId).toBe("dev_1");
  });

  it("rejects out-of-range latitude", () => {
    expect(() =>
      TelemetryPingSchema.parse({
        deviceId: "d",
        timestamp: new Date(),
        latitude: 91,
        longitude: 0,
      }),
    ).toThrow();
  });

  it("rejects heading >= 360", () => {
    expect(() =>
      TelemetryPingSchema.parse({
        deviceId: "d",
        timestamp: new Date(),
        latitude: 0,
        longitude: 0,
        headingDeg: 360,
      }),
    ).toThrow();
  });
});
