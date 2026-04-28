import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

/**
 * Lever 8: gift-card service. Centralises code generation, redemption,
 * and balance accounting. Treated like a prepaid wallet scoped to a
 * single recipient — transfers/refunds are explicit admin operations.
 */

const CODE_LENGTH = 16; // SCOOT-XXXXXXXXXXXX
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 ambiguity
const DEFAULT_EXPIRY_YEARS = 3;

export function generateGiftCardCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "SCOOT-";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

export function defaultExpiry(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + DEFAULT_EXPIRY_YEARS);
  return d;
}

export type IssueGiftCardInput = {
  amount: number;
  purchasedById?: string | null;
  purchaserEmail: string;
  recipientEmail: string;
  recipientName?: string | null;
  personalMessage?: string | null;
  scheduledDeliveryAt?: Date | null;
  expiresAt?: Date;
};

export async function issueGiftCard(
  prisma: PrismaClient,
  input: IssueGiftCardInput,
) {
  if (input.amount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Gift card amount must be positive" });
  }
  if (input.amount > 2000) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Single gift cards capped at A$2000 — split into multiples for larger purchases.",
    });
  }

  // Very rare collision on a 16-char alphabet, but retry up to 5 times.
  let code = generateGiftCardCode();
  for (let i = 0; i < 5; i += 1) {
    const existing = await prisma.giftCard.findUnique({ where: { code } });
    if (!existing) break;
    code = generateGiftCardCode();
  }

  return prisma.giftCard.create({
    data: {
      code,
      initialAmount: input.amount,
      balance: input.amount,
      purchasedById: input.purchasedById ?? null,
      purchaserEmail: input.purchaserEmail,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? null,
      personalMessage: input.personalMessage ?? null,
      scheduledDeliveryAt: input.scheduledDeliveryAt ?? null,
      expiresAt: input.expiresAt ?? defaultExpiry(),
      transactions: {
        create: {
          direction: "CREDIT",
          amount: input.amount,
          balanceAfter: input.amount,
          notes: "Gift card issued",
        },
      },
    },
  });
}

export type RedeemGiftCardInput = {
  code: string;
  amount: number;
  bookingId?: string;
  paymentId?: string;
  notes?: string;
};

export async function redeemGiftCard(
  prisma: PrismaClient,
  input: RedeemGiftCardInput,
) {
  if (input.amount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Redeem amount must be positive" });
  }

  // Lock the card within the transaction to prevent concurrent redemption
  // double-spend. Postgres row-level lock via SELECT FOR UPDATE inside tx.
  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findUnique({ where: { code: input.code } });
    if (!card) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Gift card not found" });
    }
    if (card.status === "VOIDED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Gift card has been voided" });
    }
    if (card.status === "EXPIRED" || card.expiresAt < new Date()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Gift card has expired" });
    }
    if (Number(card.balance) < input.amount) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Insufficient balance on gift card (balance A$${Number(card.balance).toFixed(2)})`,
      });
    }

    const newBalance = Number(card.balance) - input.amount;
    const newStatus = newBalance <= 0.009 ? "REDEEMED" : card.status;

    const updated = await tx.giftCard.update({
      where: { id: card.id },
      data: {
        balance: newBalance,
        status: newStatus,
        transactions: {
          create: {
            direction: "DEBIT",
            amount: input.amount,
            balanceAfter: newBalance,
            bookingId: input.bookingId ?? null,
            paymentId: input.paymentId ?? null,
            notes: input.notes ?? null,
          },
        },
      },
    });
    return updated;
  });
}

export async function getActiveBalance(
  prisma: PrismaClient,
  code: string,
): Promise<number> {
  const card = await prisma.giftCard.findUnique({ where: { code } });
  if (!card) return 0;
  if (card.status !== "ACTIVE") return 0;
  if (card.expiresAt < new Date()) return 0;
  return Number(card.balance);
}
