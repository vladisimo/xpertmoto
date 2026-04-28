import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultExpiry,
  generateGiftCardCode,
  issueGiftCard,
  redeemGiftCard,
} from "../../../src/server/services/gift-card";

describe("gift-card service", () => {
  describe("generateGiftCardCode", () => {
    it("produces SCOOT-prefixed codes using unambiguous alphabet", () => {
      const code = generateGiftCardCode();
      expect(code).toMatch(/^SCOOT-[A-Z2-9]{16}$/);
      // No 0/1/I ambiguity in the random suffix (the SCOOT- prefix contains an O
      // intentionally — the alphabet check is scoped to the random portion).
      const suffix = code.slice("SCOOT-".length);
      expect(suffix).not.toMatch(/[01OI]/);
    });

    it("generates unique codes across many calls", () => {
      const codes = new Set<string>();
      for (let i = 0; i < 1000; i += 1) codes.add(generateGiftCardCode());
      expect(codes.size).toBe(1000);
    });
  });

  describe("defaultExpiry", () => {
    it("sets expiry 3 years forward", () => {
      const from = new Date("2026-01-15T00:00:00Z");
      const exp = defaultExpiry(from);
      expect(exp.getUTCFullYear()).toBe(2029);
      expect(exp.getUTCMonth()).toBe(0);
    });
  });

  describe("issueGiftCard", () => {
    const makePrisma = () => {
      const created = { id: "gc1", code: "SCOOT-XXXXXXXXXXXXXXXX", balance: 100, status: "ACTIVE" };
      return {
        giftCard: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(created),
        },
      } as never;
    };

    beforeEach(() => vi.clearAllMocks());

    it("rejects zero / negative amounts", async () => {
      const prisma = makePrisma();
      await expect(
        issueGiftCard(prisma, {
          amount: 0,
          purchaserEmail: "a@b.com",
          recipientEmail: "c@d.com",
        }),
      ).rejects.toThrow(/positive/);
    });

    it("caps single-card amount", async () => {
      const prisma = makePrisma();
      await expect(
        issueGiftCard(prisma, {
          amount: 5000,
          purchaserEmail: "a@b.com",
          recipientEmail: "c@d.com",
        }),
      ).rejects.toThrow(/capped/);
    });

    it("creates card with credit transaction on happy path", async () => {
      const prisma = makePrisma();
      await issueGiftCard(prisma, {
        amount: 100,
        purchaserEmail: "a@b.com",
        recipientEmail: "c@d.com",
      });
      expect(
        (prisma as unknown as { giftCard: { create: ReturnType<typeof vi.fn> } })
          .giftCard.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            initialAmount: 100,
            balance: 100,
            transactions: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe("redeemGiftCard", () => {
    const fakeCard = {
      id: "gc1",
      code: "SCOOT-XXXX",
      balance: 100,
      status: "ACTIVE",
      expiresAt: new Date("2030-01-01"),
    };

    function prismaWith(overrides?: { balance?: number; status?: string; expiresAt?: Date }) {
      const tx = {
        giftCard: {
          findUnique: vi.fn().mockResolvedValue({ ...fakeCard, ...overrides }),
          update: vi.fn().mockImplementation(async ({ data }) => ({ ...fakeCard, ...data })),
        },
      };
      return {
        $transaction: vi
          .fn()
          .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        giftCard: tx.giftCard,
      } as never;
    }

    it("debits the card and returns updated balance", async () => {
      const prisma = prismaWith();
      const updated = await redeemGiftCard(prisma, {
        code: "SCOOT-XXXX",
        amount: 30,
      });
      expect(Number(updated.balance)).toBe(70);
    });

    it("flips to REDEEMED when balance hits zero", async () => {
      const prisma = prismaWith({ balance: 30 });
      const updated = await redeemGiftCard(prisma, {
        code: "SCOOT-XXXX",
        amount: 30,
      });
      expect(updated.status).toBe("REDEEMED");
    });

    it("rejects insufficient balance", async () => {
      const prisma = prismaWith({ balance: 5 });
      await expect(
        redeemGiftCard(prisma, { code: "SCOOT-XXXX", amount: 30 }),
      ).rejects.toThrow(/Insufficient balance/);
    });

    it("rejects expired cards", async () => {
      const prisma = prismaWith({ expiresAt: new Date("2020-01-01") });
      await expect(
        redeemGiftCard(prisma, { code: "SCOOT-XXXX", amount: 10 }),
      ).rejects.toThrow(/expired/);
    });
  });
});
