import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  trpcRateLimit,
} from "../trpc";
import { createPaymentIntent } from "@/lib/stripe";
import {
  getActiveBalance,
  issueGiftCard,
  redeemGiftCard,
} from "@/server/services/gift-card";
import { sendEmail } from "@/lib/email";
import { render } from "@react-email/render";
import { createElement } from "react";
import GiftCardReceivedEmail from "../../../../emails/gift-card-received";
import { writeAudit } from "@/server/services/audit";
import { isNotificationsPaused } from "@/server/services/notification-gate";
import { logger } from "@/lib/logger";
import { gstFromInclusive } from "@/lib/money";

export const giftCardRouter = createTRPCRouter({
  /**
   * Create a gift card in PENDING state and return a Stripe PaymentIntent
   * for the purchaser. The client confirms the intent and the webhook
   * flips the card to ACTIVE and emails the recipient.
   */
  purchase: publicProcedure
    .use(
      trpcRateLimit<{ purchaserEmail: string }>({
        bucket: "gift:purchase",
        limit: 3,
        windowSec: 60 * 60,
        identifier: (_ctx, input) => input?.purchaserEmail,
      }),
    )
    .input(
      z.object({
        amount: z.number().min(25).max(2000),
        purchaserEmail: z.string().email(),
        recipientEmail: z.string().email(),
        recipientName: z.string().optional(),
        personalMessage: z.string().max(500).optional(),
        scheduledDeliveryAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await issueGiftCard(ctx.prisma, {
        amount: input.amount,
        purchasedById: ctx.session?.user?.id ?? null,
        purchaserEmail: input.purchaserEmail,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        personalMessage: input.personalMessage,
        scheduledDeliveryAt: input.scheduledDeliveryAt,
      });

      const { getBranding } = await import("@/lib/branding");
      const { siteName } = await getBranding();
      const intent = await createPaymentIntent({
        amount: input.amount,
        bookingId: `GIFT-${card.id}`,
        customerEmail: input.purchaserEmail,
        description: `${siteName} gift card purchase (${card.code})`,
      });

      // Stub-mode Stripe → immediately mark as active for test flows.
      if (intent.id.startsWith("pi_stub_")) {
        await ctx.prisma.payment.create({
          data: {
            reference: `GIFT-${card.id}`,
            type: "GIFT_CARD_PURCHASE",
            method: "STRIPE",
            amount: input.amount,
            gstAmount: gstFromInclusive(input.amount),
            stripePaymentIntentId: intent.id,
            status: "SUCCEEDED",
            processedAt: new Date(),
          },
        });
        await sendRecipientEmail(ctx.prisma, card.id);
      }

      await writeAudit(ctx.prisma, {
        userId: ctx.session?.user?.id ?? null,
        action: "GIFT_CARD_PURCHASED",
        entity: "GiftCard",
        entityId: card.id,
        newData: {
          code: card.code,
          amount: input.amount,
          recipientEmail: input.recipientEmail,
        },
      });

      return {
        giftCardId: card.id,
        code: card.code,
        paymentClientSecret: intent.clientSecret,
        paymentIntentId: intent.id,
      };
    }),

  lookup: publicProcedure
    .input(z.object({ code: z.string().min(6) }))
    .query(async ({ ctx, input }) => {
      const balance = await getActiveBalance(ctx.prisma, input.code);
      const card = await ctx.prisma.giftCard.findUnique({
        where: { code: input.code },
        select: {
          code: true,
          initialAmount: true,
          balance: true,
          status: true,
          expiresAt: true,
          recipientName: true,
        },
      });
      if (!card) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...card, activeBalance: balance };
    }),

  redeem: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        bookingId: z.string(),
        amount: z.number().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      if (booking.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      try {
        const updated = await redeemGiftCard(ctx.prisma, {
          code: input.code,
          amount: input.amount,
          bookingId: input.bookingId,
        });

        await ctx.prisma.payment.create({
          data: {
            reference: `GC-REDEEM-${Date.now()}`,
            customerId: booking.customerId,
            bookingId: booking.id,
            type: "GIFT_CARD_REDEMPTION",
            method: "CARD",
            amount: -input.amount,
            status: "SUCCEEDED",
            notes: `Gift card ${input.code}`,
            processedAt: new Date(),
          },
        });
        await ctx.prisma.booking.update({
          where: { id: booking.id },
          data: {
            amountPaid: { increment: input.amount },
            balanceDue: { decrement: input.amount },
          },
        });
        return { newBalance: Number(updated.balance) };
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Redeem failed",
        });
      }
    }),

  void: adminProcedure
    .input(z.object({ id: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const card = await ctx.prisma.giftCard.update({
        where: { id: input.id },
        data: {
          status: "VOIDED",
          transactions: {
            create: {
              direction: "DEBIT",
              amount: 0,
              balanceAfter: 0,
              notes: `Voided: ${input.reason}`,
            },
          },
        },
      });
      return card;
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    const cards = await ctx.prisma.giftCard.findMany({
      where: {
        OR: [
          { purchasedById: ctx.user.id },
          { recipientEmail: ctx.user.email ?? "__no_email__" },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    return cards.map((c) => ({
      id: c.id,
      code: c.code,
      initialAmount: Number(c.initialAmount),
      balance: Number(c.balance),
      status: c.status,
      expiresAt: c.expiresAt,
      role:
        c.purchasedById === ctx.user.id ? ("PURCHASED" as const) : ("RECEIVED" as const),
    }));
  }),
});

async function sendRecipientEmail(prisma: Parameters<typeof issueGiftCard>[0], cardId: string) {
  const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!card || card.deliveredAt) return;
  if (await isNotificationsPaused()) {
    logger.info({ cardId }, "gift-card: recipient email suppressed — notifications paused");
    return;
  }
  const { getBranding } = await import("@/lib/branding");
  const { siteName } = await getBranding();
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
