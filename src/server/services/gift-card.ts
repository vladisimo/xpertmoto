import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { logger } from "@/lib/logger";

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
  /**
   * PENDING for customer purchases (activated by the Stripe webhook once the
   * PaymentIntent succeeds); ACTIVE only for flows where the money is already
   * settled (e.g. an admin comp). Defaults to PENDING — a card must never be
   * spendable before it is paid for.
   */
  status?: "PENDING" | "ACTIVE";
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
      status: input.status ?? "PENDING",
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

/**
 * Flip a PENDING card ACTIVE once its PaymentIntent has succeeded, recording
 * the purchase Payment row. Idempotent: the PENDING→ACTIVE CAS fires exactly
 * once, so a redelivered webhook (or the stub path racing the webhook) can't
 * double-create the Payment. Returns whether THIS call performed the
 * activation — callers only send the recipient email on true.
 *
 * gstAmount is 0 by design (Div 100 voucher): selling the voucher is not a
 * taxable supply — GST attaches when it is REDEEMED, and computeGstSummary
 * books each redemption's face value into G1/1A at that point. Putting GST
 * on this row too would double-remit.
 */
export async function activateGiftCardOnPayment(
  prisma: PrismaClient,
  args: {
    giftCardId: string;
    stripePaymentIntentId: string;
    stripeChargeId?: string | null;
  },
): Promise<{ activated: boolean }> {
  const card = await prisma.giftCard.findUnique({ where: { id: args.giftCardId } });
  if (!card) {
    logger.warn({ giftCardId: args.giftCardId }, "gift-card: activation for unknown card");
    return { activated: false };
  }

  const flipped = await prisma.giftCard.updateMany({
    where: { id: card.id, status: "PENDING" },
    data: { status: "ACTIVE", stripePaymentIntentId: args.stripePaymentIntentId },
  });
  if (flipped.count === 0) return { activated: false };

  await prisma.payment.create({
    data: {
      reference: `GIFT-${card.id}`,
      customerId: card.purchasedById,
      type: "GIFT_CARD_PURCHASE",
      method: "STRIPE",
      amount: card.initialAmount,
      gstAmount: 0,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId ?? null,
      status: "SUCCEEDED",
      processedAt: new Date(),
      notes: `Gift card ${card.code} purchase`,
    },
  });
  return { activated: true };
}

/**
 * Send (or re-send-safely skip) the recipient email for an ACTIVE card.
 * No-ops when already delivered or notifications are paused. Shared by the
 * webhook activation path and the dev stub path.
 */
export async function deliverGiftCardEmail(
  prisma: PrismaClient,
  giftCardId: string,
): Promise<void> {
  const card = await prisma.giftCard.findUnique({ where: { id: giftCardId } });
  if (!card || card.deliveredAt || card.status !== "ACTIVE") return;
  const { isNotificationsPaused } = await import("@/server/services/notification-gate");
  if (await isNotificationsPaused()) {
    logger.info({ giftCardId }, "gift-card: recipient email suppressed — notifications paused");
    return;
  }
  const { getBranding } = await import("@/lib/branding");
  const { siteName } = await getBranding();
  const { render } = await import("@react-email/render");
  const { createElement } = await import("react");
  const { default: GiftCardReceivedEmail } = await import(
    "../../../emails/gift-card-received"
  );
  const { sendEmail } = await import("@/lib/email");
  const html = await render(
    createElement(GiftCardReceivedEmail, {
      recipientName: card.recipientName ?? "Rider",
      amount: `A$${Number(card.initialAmount).toFixed(2)}`,
      code: card.code,
      personalMessage: card.personalMessage ?? undefined,
      redeemUrl: `${process.env.APP_URL ?? ""}/booking?giftCard=${card.code}`,
      siteName,
    }),
  );
  await sendEmail({
    to: card.recipientEmail,
    subject: `🎁 You've been gifted a ${siteName} ride`,
    html,
  });
  await prisma.giftCard.update({
    where: { id: card.id },
    data: { deliveredAt: new Date() },
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
  return prisma.$transaction((tx) => redeemGiftCardTx(tx, input));
}

/**
 * Transaction-composable core of {@link redeemGiftCard}: callers that must
 * pair the card debit with other writes (Payment row, booking counters) pass
 * their own `tx` so a failure anywhere rolls the debit back too — a card must
 * never lose balance without the booking receiving the credit.
 */
export async function redeemGiftCardTx(
  tx: Prisma.TransactionClient,
  input: RedeemGiftCardInput,
) {
  if (input.amount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Redeem amount must be positive" });
  }

  {
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

    // Balance guard + decrement in ONE conditional statement. A plain
    // read-check-write lets two concurrent redemptions both pass the check
    // (READ COMMITTED) and overdraw the card; the WHERE clause makes the
    // row update itself the arbiter — the loser matches zero rows. The
    // status filter re-checks under the same statement so a concurrent
    // void/expiry can't slip in after the reads above.
    const claimed = await tx.giftCard.updateMany({
      where: {
        id: card.id,
        status: { in: ["ACTIVE", "REDEEMED"] },
        balance: { gte: input.amount },
      },
      data: { balance: { decrement: input.amount } },
    });
    if (claimed.count === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Insufficient balance on gift card (balance A$${Number(card.balance).toFixed(2)})`,
      });
    }

    const fresh = await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    const newBalance = Number(fresh.balance);
    const newStatus = newBalance <= 0.009 ? "REDEEMED" : fresh.status;

    const updated = await tx.giftCard.update({
      where: { id: card.id },
      data: {
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
  }
}

/**
 * Return value to the gift card(s) that funded a booking — the cancellation
 * counterpart of redemption. Walks the booking's DEBIT transactions newest
 * first and credits each card back up to what it contributed, reactivating
 * fully-spent cards. VOIDED/EXPIRED cards are skipped (their share stays
 * with the card-refund path / manual follow-up). Transaction-composable:
 * runs on the caller's `tx` so a cancellation rollback also rolls this back.
 */
export async function restoreGiftCardForBooking(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; amount: number; reason: string },
): Promise<{ restored: number }> {
  if (args.amount <= 0) return { restored: 0 };
  const debits = await tx.giftCardTransaction.findMany({
    where: { bookingId: args.bookingId, direction: "DEBIT" },
    orderBy: { createdAt: "desc" },
    include: { giftCard: { select: { id: true, status: true } } },
  });
  let remaining = Math.round(args.amount * 100) / 100;
  let restored = 0;
  for (const d of debits) {
    if (remaining <= 0) break;
    if (d.giftCard.status === "VOIDED" || d.giftCard.status === "EXPIRED") continue;
    const share = Math.min(remaining, Number(d.amount));
    if (share <= 0) continue;
    const updated = await tx.giftCard.update({
      where: { id: d.giftCard.id },
      data: {
        balance: { increment: share },
        // A fully-spent (REDEEMED) card becomes spendable again.
        ...(d.giftCard.status === "REDEEMED" ? { status: "ACTIVE" as const } : {}),
      },
    });
    await tx.giftCardTransaction.create({
      data: {
        giftCardId: d.giftCard.id,
        bookingId: args.bookingId,
        direction: "CREDIT",
        amount: share,
        balanceAfter: Number(updated.balance),
        notes: args.reason,
      },
    });
    remaining = Math.round((remaining - share) * 100) / 100;
    restored = Math.round((restored + share) * 100) / 100;
  }
  return { restored };
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
