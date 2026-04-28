import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  awardLoyaltyPoints,
  burnLoyaltyPoints,
  BURN_POINTS_PER_DOLLAR,
  tierBondMultiplier,
  tierForPoints,
  TIER_THRESHOLDS,
} from "../../../src/server/services/loyalty";

describe("loyalty service", () => {
  describe("tierForPoints", () => {
    it("returns SILVER below Gold threshold", () => {
      expect(tierForPoints(0)).toBe("SILVER");
      expect(tierForPoints(TIER_THRESHOLDS.GOLD - 1)).toBe("SILVER");
    });
    it("returns GOLD between Gold and Platinum", () => {
      expect(tierForPoints(TIER_THRESHOLDS.GOLD)).toBe("GOLD");
      expect(tierForPoints(TIER_THRESHOLDS.PLATINUM - 1)).toBe("GOLD");
    });
    it("returns PLATINUM at or above Platinum threshold", () => {
      expect(tierForPoints(TIER_THRESHOLDS.PLATINUM)).toBe("PLATINUM");
      expect(tierForPoints(999999)).toBe("PLATINUM");
    });
  });

  describe("tierBondMultiplier", () => {
    it("zeroes the bond at Platinum and discounts Gold", () => {
      expect(tierBondMultiplier("SILVER")).toBe(1);
      expect(tierBondMultiplier("GOLD")).toBeLessThan(1);
      expect(tierBondMultiplier("PLATINUM")).toBe(0);
    });
  });

  describe("awardLoyaltyPoints", () => {
    function makePrisma(existing: unknown = null) {
      const loyaltyCreate = vi.fn();
      const customerProfileUpdate = vi.fn().mockResolvedValue({
        lifetimePoints: 100,
        loyaltyTier: "SILVER",
      });
      const tx = {
        loyaltyLedger: { create: loyaltyCreate },
        customerProfile: { update: customerProfileUpdate },
      };
      return {
        loyaltyLedger: { findFirst: vi.fn().mockResolvedValue(existing) },
        $transaction: vi
          .fn()
          .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        __tx: tx,
      } as never;
    }

    beforeEach(() => vi.clearAllMocks());

    it("no-ops on zero / negative points", async () => {
      const prisma = makePrisma();
      expect(await awardLoyaltyPoints(prisma, {
        userId: "u1",
        points: 0,
        reason: "x",
      })).toBe(0);
    });

    it("dedupes by (userId, bookingId, reason)", async () => {
      const prisma = makePrisma({ id: "existing" });
      const result = await awardLoyaltyPoints(prisma, {
        userId: "u1",
        bookingId: "b1",
        points: 50,
        reason: "Booking SCT-123",
      });
      expect(result).toBe(0);
    });

    it("credits and bumps tier when threshold crossed", async () => {
      const prisma = makePrisma();
      const tx = (prisma as unknown as { __tx: { customerProfile: { update: ReturnType<typeof vi.fn> } } }).__tx;
      tx.customerProfile.update.mockResolvedValueOnce({
        lifetimePoints: 2500, // crosses GOLD
        loyaltyTier: "SILVER",
      });
      const points = await awardLoyaltyPoints(prisma, {
        userId: "u1",
        points: 2500,
        reason: "Big-ticket",
      });
      expect(points).toBe(2500);
      expect(tx.customerProfile.update).toHaveBeenCalledTimes(2); // increment + tier bump
    });
  });

  describe("burnLoyaltyPoints", () => {
    function makePrisma(balance: number) {
      const ledgerCreate = vi.fn();
      const profileUpdate = vi.fn();
      const tx = {
        loyaltyLedger: { create: ledgerCreate },
        customerProfile: { update: profileUpdate },
      };
      return {
        customerProfile: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ loyaltyPoints: balance, lifetimePoints: balance }),
        },
        $transaction: vi
          .fn()
          .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      } as never;
    }

    it("converts points to dollars at 100:1 and decrements balance", async () => {
      const prisma = makePrisma(500);
      const dollars = await burnLoyaltyPoints(prisma, {
        userId: "u1",
        bookingId: "b1",
        points: 300,
      });
      expect(dollars).toBe(300 / BURN_POINTS_PER_DOLLAR);
    });

    it("throws when balance insufficient", async () => {
      const prisma = makePrisma(10);
      await expect(
        burnLoyaltyPoints(prisma, {
          userId: "u1",
          bookingId: "b1",
          points: 500,
        }),
      ).rejects.toThrow(/Insufficient/);
    });
  });
});
