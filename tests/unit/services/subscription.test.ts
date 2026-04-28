import { describe, expect, it, vi } from "vitest";
import { computeOverage } from "../../../src/server/services/subscription";

describe("subscription service", () => {
  describe("computeOverage", () => {
    function makePrisma(options: {
      plan: {
        includedDays?: number | null;
        includedKm?: number | null;
        overageDayRate?: number | null;
        overageKmRate?: number | null;
      };
      usage: {
        daysUsed: number;
        kmUsed: number;
      } | null;
    }) {
      return {
        subscription: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: "s1",
            currentPeriodStart: new Date("2026-05-01"),
            plan: options.plan,
          }),
        },
        subscriptionUsage: {
          findUnique: vi.fn().mockResolvedValue(options.usage),
        },
      } as never;
    }

    it("returns zeros when no usage row yet", async () => {
      const prisma = makePrisma({
        plan: { includedDays: 10, overageDayRate: 30 },
        usage: null,
      });
      const q = await computeOverage(prisma, "s1");
      expect(q).toEqual({ daysOver: 0, kmOver: 0, overageCharge: 0 });
    });

    it("charges overage when days consumed exceed included", async () => {
      const prisma = makePrisma({
        plan: {
          includedDays: 10,
          includedKm: 500,
          overageDayRate: 30,
          overageKmRate: 0.2,
        },
        usage: { daysUsed: 14, kmUsed: 800 },
      });
      const q = await computeOverage(prisma, "s1");
      expect(q.daysOver).toBe(4);
      expect(q.kmOver).toBe(300);
      // 4 × $30 + 300 × $0.20 = $120 + $60 = $180
      expect(q.overageCharge).toBe(180);
    });

    it("zero overage when included is unlimited (null)", async () => {
      const prisma = makePrisma({
        plan: { includedDays: null, includedKm: null },
        usage: { daysUsed: 30, kmUsed: 5000 },
      });
      const q = await computeOverage(prisma, "s1");
      expect(q.daysOver).toBe(0);
      expect(q.kmOver).toBe(0);
      expect(q.overageCharge).toBe(0);
    });
  });
});
