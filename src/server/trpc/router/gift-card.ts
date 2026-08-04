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
  activateGiftCardOnPayment,
  deliverGiftCardEmail,
  getActiveBalance,
  issueGiftCard,
  redeemGiftCardTx,
} from "@/server/services/gift-card";
import { writeAudit } from "@/server/services/audit";
import { Prisma } from "@prisma/client";

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
        // The webhook activates the card off this key — without it a paid
        // card would stay PENDING forever in real Stripe mode.
        metadata: { giftCardId: card.id },
      });

      // Correlate the card with its PI so reconciliation (and the webhook
      // fallback lookup) can find it even if metadata is ever stripped.
      await ctx.prisma.giftCard.update({
        where: { id: card.id },
        data: { stripePaymentIntentId: intent.id },
      });

      // Stub-mode Stripe (dev without keys) → no webhook will ever arrive;
      // activate + deliver inline so the flow still works end-to-end.
      if (intent.id.startsWith("pi_stub_")) {
        const { activated } = await activateGiftCardOnPayment(ctx.prisma, {
          giftCardId: card.id,
          stripePaymentIntentId: intent.id,
        });
        if (activated) await deliverGiftCardEmail(ctx.prisma, card.id);
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
        // One transaction for card debit + Payment row + booking counters:
        // a partial failure must roll the debit back (the customer's card
        // value can never evaporate without the booking being credited),
        // and the balanceDue CAS below rejects over-redemption so the
        // booking balance can never go negative.
        const updated = await ctx.prisma.$transaction(async (tx) => {
          const card = await redeemGiftCardTx(tx, {
            code: input.code,
            amount: input.amount,
            bookingId: input.bookingId,
          });

          // Deterministic reference = idempotency: a double-clicked submit
          // (or client retry) hits the unique constraint instead of debiting
          // the card twice. One redemption per card per booking.
          await tx.payment.create({
            data: {
              reference: `GC-REDEEM-${booking.id}-${card.id}`,
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

          const applied = await tx.booking.updateMany({
            where: { id: booking.id, balanceDue: { gte: input.amount } },
            data: {
              amountPaid: { increment: input.amount },
              balanceDue: { decrement: input.amount },
            },
          });
          if (applied.count === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Redemption exceeds the booking's remaining balance",
            });
          }
          return card;
        });
        return { newBalance: Number(updated.balance) };
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This gift card has already been applied to this booking",
          });
        }
        if (err instanceof TRPCError) throw err;
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

