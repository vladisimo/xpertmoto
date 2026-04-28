import { describe, expect, it } from "vitest";
import {
  computeOutOfZoneDistanceKm,
  detectSpeedEvent,
  detectZoneTransition,
  isInsideZone,
  quoteZoneSurcharge,
  type TelemetrySample,
  type ZoneConfig,
} from "../../../src/server/services/telematics-revenue";

/** Gold Coast depot — roughly (-28.0, 153.43). 10km radius for quick math. */
const GC_ZONE: ZoneConfig = {
  centerLat: -28.0,
  centerLng: 153.43,
  radiusKm: 10,
  polygon: null,
  allowStateCrossing: false,
  perKmSurchargeCents: 35,
  borderCrossingFeeCents: 10_000,
};

function sample(over: Partial<TelemetrySample>): TelemetrySample {
  return {
    timestamp: new Date("2026-05-01T12:00:00Z"),
    latitude: -28.0,
    longitude: 153.43,
    speedKph: 40,
    odometerKm: 1000,
    ignitionOn: true,
    ...over,
  };
}

describe("telematics-revenue service", () => {
  describe("isInsideZone", () => {
    it("accepts the centre point", () => {
      expect(isInsideZone(sample({}), GC_ZONE)).toBe(true);
    });
    it("rejects a point > 100km away", () => {
      expect(
        isInsideZone(sample({ latitude: -30.0, longitude: 153.0 }), GC_ZONE),
      ).toBe(false);
    });
    it("honours a polygon when provided", () => {
      const polyZone: ZoneConfig = {
        ...GC_ZONE,
        polygon: [
          { lat: -28.0, lng: 153.4 },
          { lat: -28.0, lng: 153.5 },
          { lat: -28.1, lng: 153.5 },
          { lat: -28.1, lng: 153.4 },
        ],
      };
      expect(
        isInsideZone(sample({ latitude: -28.05, longitude: 153.45 }), polyZone),
      ).toBe(true);
      expect(
        isInsideZone(sample({ latitude: -28.2, longitude: 153.45 }), polyZone),
      ).toBe(false);
    });
  });

  describe("detectZoneTransition", () => {
    it("flags an exit when moving from inside to outside", () => {
      const prev = sample({});
      const curr = sample({ latitude: -30.0, longitude: 153.0 });
      expect(detectZoneTransition(prev, curr, GC_ZONE)?.kind).toBe(
        "OUT_OF_ZONE_ENTERED",
      );
    });
    it("flags a re-entry when moving from outside to inside", () => {
      const prev = sample({ latitude: -30.0, longitude: 153.0 });
      const curr = sample({});
      expect(detectZoneTransition(prev, curr, GC_ZONE)?.kind).toBe(
        "OUT_OF_ZONE_EXITED",
      );
    });
    it("no event when both inside", () => {
      expect(
        detectZoneTransition(sample({}), sample({}), GC_ZONE),
      ).toBeNull();
    });
    it("treats a fresh sample starting outside as an entry event", () => {
      const curr = sample({ latitude: -30.0, longitude: 153.0 });
      expect(detectZoneTransition(null, curr, GC_ZONE)?.kind).toBe(
        "OUT_OF_ZONE_ENTERED",
      );
    });
  });

  describe("computeOutOfZoneDistanceKm", () => {
    it("accumulates distance while outside the zone", () => {
      const samples = [
        sample({ latitude: -30.0, longitude: 153.0, timestamp: new Date("2026-05-01T12:00:00Z") }),
        sample({ latitude: -30.1, longitude: 153.0, timestamp: new Date("2026-05-01T12:05:00Z") }),
      ];
      const km = computeOutOfZoneDistanceKm(samples, GC_ZONE);
      expect(km).toBeGreaterThan(0);
      expect(km).toBeLessThan(20);
    });
    it("ignores legs fully inside the zone", () => {
      const samples = [sample({}), sample({})];
      expect(computeOutOfZoneDistanceKm(samples, GC_ZONE)).toBe(0);
    });
  });

  describe("detectSpeedEvent", () => {
    it("flags sustained speeding over threshold", () => {
      const window: TelemetrySample[] = [];
      for (let i = 0; i < 10; i += 1) {
        window.push(sample({
          timestamp: new Date(`2026-05-01T12:00:${String(i * 5).padStart(2, "0")}Z`),
          speedKph: 95,
        }));
      }
      const event = detectSpeedEvent(window, 85, 30);
      expect(event).not.toBeNull();
      expect(event!.peakSpeedKph).toBe(95);
      expect(event!.durationSec).toBeGreaterThan(30);
    });
    it("ignores brief spikes shorter than min duration", () => {
      const window = [
        sample({ speedKph: 95, timestamp: new Date("2026-05-01T12:00:00Z") }),
        sample({ speedKph: 40, timestamp: new Date("2026-05-01T12:00:05Z") }),
      ];
      expect(detectSpeedEvent(window, 85, 30)).toBeNull();
    });
  });

  describe("quoteZoneSurcharge", () => {
    it("combines per-km and border totals", () => {
      const quote = quoteZoneSurcharge({
        outOfZoneKm: 20,
        borderCrossings: 1,
        zone: GC_ZONE,
      });
      // 20 km × 35c = $7.00
      expect(quote.perKmTotal).toBe(7);
      // 1 border crossing × $100 = $100
      expect(quote.borderTotal).toBe(100);
      expect(quote.total).toBe(107);
    });
    it("waives border crossings when allowStateCrossing is true", () => {
      const quote = quoteZoneSurcharge({
        outOfZoneKm: 0,
        borderCrossings: 3,
        zone: { ...GC_ZONE, allowStateCrossing: true },
      });
      expect(quote.borderTotal).toBe(0);
      expect(quote.total).toBe(0);
    });
  });
});
