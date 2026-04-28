import { describe, expect, it, vi } from "vitest";
import {
  clampMultiplier,
  computeRecommendation,
} from "../../../src/server/services/yield-pricing";

describe("yield-pricing service", () => {
  describe("clampMultiplier", () => {
    it("floors at 0.85", () => {
      expect(clampMultiplier(0.5)).toBe(0.85);
    });
    it("caps at 1.4", () => {
      expect(clampMultiplier(2.0)).toBe(1.4);
    });
    it("passes values in range through", () => {
      expect(clampMultiplier(1.15)).toBe(1.15);
    });
  });

  describe("computeRecommendation", () => {
    function makePrisma(opts: {
      totalFleet: number;
      bookedCount: number;
      events?: { name: string; multiplier: number; depotIds?: string[]; categoryIds?: string[] }[];
    }) {
      return {
        vehicle: { count: vi.fn().mockResolvedValue(opts.totalFleet) },
        booking: { count: vi.fn().mockResolvedValue(opts.bookedCount) },
        demandEvent: {
          findMany: vi.fn().mockResolvedValue(
            (opts.events ?? []).map((e, i) => ({
              id: `de${i}`,
              name: e.name,
              multiplier: e.multiplier,
              depotIds: e.depotIds ?? [],
              categoryIds: e.categoryIds ?? [],
              isActive: true,
            })),
          ),
        },
      } as never;
    }

    const now = new Date("2026-05-01T10:00:00Z");

    it("returns 1× when fleet has plenty of capacity and no events", async () => {
      const prisma = makePrisma({ totalFleet: 10, bookedCount: 3 });
      const target = new Date("2026-06-01T00:00:00Z"); // Monday, > 7d out
      const rec = await computeRecommendation(prisma, {
        depotId: "d1",
        categoryId: "c1",
        targetDate: target,
        now,
      });
      // Monday, 30d away, utilisation 0.3 → no adjustments
      expect(rec.multiplier).toBeGreaterThanOrEqual(0.99);
      expect(rec.multiplier).toBeLessThanOrEqual(1.01);
    });

    it("bumps price when forward fleet utilisation is tight", async () => {
      const prisma = makePrisma({ totalFleet: 10, bookedCount: 9 });
      const target = new Date("2026-06-01T00:00:00Z");
      const rec = await computeRecommendation(prisma, {
        depotId: "d1",
        categoryId: "c1",
        targetDate: target,
        now,
      });
      expect(rec.multiplier).toBeGreaterThan(1.15);
      expect(rec.reasonCodes).toContain("INVENTORY_90PCT");
    });

    it("stacks weekend and short-lead premiums", async () => {
      const prisma = makePrisma({ totalFleet: 10, bookedCount: 5 });
      const target = new Date("2026-05-02T00:00:00Z"); // Sat, day after now
      const rec = await computeRecommendation(prisma, {
        depotId: "d1",
        categoryId: "c1",
        targetDate: target,
        now,
      });
      expect(rec.reasonCodes).toContain("WEEKEND");
      expect(rec.reasonCodes).toContain("SHORT_LEAD_48H");
      expect(rec.multiplier).toBeGreaterThan(1.1);
    });

    it("applies a matching DemandEvent", async () => {
      const prisma = makePrisma({
        totalFleet: 10,
        bookedCount: 3,
        events: [
          { name: "Bluesfest 2026", multiplier: 1.3, depotIds: ["d1"] },
        ],
      });
      const target = new Date("2026-06-03T00:00:00Z");
      const rec = await computeRecommendation(prisma, {
        depotId: "d1",
        categoryId: "c1",
        targetDate: target,
        now,
      });
      expect(rec.reasonCodes.some((r) => r.startsWith("DEMAND_EVENT"))).toBe(true);
      expect(rec.multiplier).toBeGreaterThan(1.25);
    });

    it("clamps to 1.4 at the top", async () => {
      const prisma = makePrisma({
        totalFleet: 10,
        bookedCount: 10,
        events: [
          { name: "Perfect Storm", multiplier: 1.8, depotIds: [] },
        ],
      });
      const target = new Date("2026-05-02T00:00:00Z"); // weekend + 1-day lead
      const rec = await computeRecommendation(prisma, {
        depotId: "d1",
        categoryId: "c1",
        targetDate: target,
        now,
      });
      expect(rec.multiplier).toBe(1.4);
    });

    it("discounts slow weeknights", async () => {
      const prisma = makePrisma({ totalFleet: 10, bookedCount: 1 });
      const target = new Date("2026-06-17T00:00:00Z"); // Wednesday, >45d out
      const rec = await computeRecommendation(prisma, {
        depotId: "d1",
        categoryId: "c1",
        targetDate: target,
        now,
      });
      expect(rec.multiplier).toBeLessThanOrEqual(0.95);
      expect(rec.reasonCodes).toContain("LOW_DEMAND");
    });
  });
});
