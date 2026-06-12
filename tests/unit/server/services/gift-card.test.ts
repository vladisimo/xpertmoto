import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { generateGiftCardCode, redeemGiftCard } from "@/server/services/gift-card";

const findUnique = vi.fn();
const updateMany = vi.fn();
const findUniqueOrThrow = vi.fn();
const update = vi.fn();

const tx = { giftCard: { findUnique, updateMany, findUniqueOrThrow, update } };
const prisma = {
  $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
} as unknown as PrismaClient;

const future = new Date(Date.now() + 86_400_000);
const baseCard = {
  id: "gc_1",
  code: "SCOOT-TEST",
  status: "ACTIVE",
  balance: 50,
  expiresAt: future,
};

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ ...baseCard });
  updateMany.mockResolvedValue({ count: 1 });
  findUniqueOrThrow.mockResolvedValue({ ...baseCard, balance: 10 });
  update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...baseCard,
    balance: 10,
    status: args.data.status,
  }));
});

describe("generateGiftCardCode", () => {
  it("emits the SCOOT- prefix with no ambiguous characters", () => {
    const code = generateGiftCardCode();
    expect(code).toMatch(/^SCOOT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
  });
});

describe("redeemGiftCard", () => {
  it("guards the balance inside the decrement statement (atomic claim)", async () => {
    await redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 40 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "gc_1",
        status: { in: ["ACTIVE", "REDEEMED"] },
        balance: { gte: 40 },
      },
      data: { balance: { decrement: 40 } },
    });
  });

  it("rejects when the conditional claim matches no rows (concurrent overdraw loser)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 40 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("records balanceAfter from the post-decrement row and flips REDEEMED at zero", async () => {
    findUniqueOrThrow.mockResolvedValue({ ...baseCard, balance: 0 });
    await redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 50, bookingId: "bk_1" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REDEEMED",
          transactions: {
            create: expect.objectContaining({
              direction: "DEBIT",
              amount: 50,
              balanceAfter: 0,
              bookingId: "bk_1",
            }),
          },
        }),
      }),
    );
  });

  it("keeps the card ACTIVE when a balance remains", async () => {
    findUniqueOrThrow.mockResolvedValue({ ...baseCard, balance: 10 });
    const res = (await redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 40 })) as {
      status: string;
    };
    expect(res.status).toBe("ACTIVE");
  });

  it("still rejects voided and expired cards before claiming", async () => {
    findUnique.mockResolvedValue({ ...baseCard, status: "VOIDED" });
    await expect(redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    findUnique.mockResolvedValue({ ...baseCard, expiresAt: new Date(Date.now() - 1000) });
    await expect(redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects non-positive amounts without touching the database", async () => {
    await expect(redeemGiftCard(prisma, { code: "SCOOT-TEST", amount: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
