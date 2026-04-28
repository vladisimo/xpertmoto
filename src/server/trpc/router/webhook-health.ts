import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "../trpc";
import { writeAudit } from "@/server/services/audit";

/**
 * Stripe webhook health queries for the admin Integrations surface.
 * Exposes aggregate counts + a recent-events table; mutating actions
 * (mark as RECEIVED to trigger retry on Stripe's side) are also here.
 */
export const webhookHealthRouter = createTRPCRouter({
  summary: adminProcedure.query(async ({ ctx }) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since5m = new Date(Date.now() - 5 * 60 * 1000);
    const [processed, failed, stuck, received24h] = await Promise.all([
      ctx.prisma.stripeWebhookEvent.count({
        where: { status: "PROCESSED", receivedAt: { gte: since24h } },
      }),
      ctx.prisma.stripeWebhookEvent.count({
        where: { status: "FAILED", receivedAt: { gte: since24h } },
      }),
      ctx.prisma.stripeWebhookEvent.count({
        where: { status: "PROCESSING", receivedAt: { lt: since5m } },
      }),
      ctx.prisma.stripeWebhookEvent.count({
        where: { receivedAt: { gte: since24h } },
      }),
    ]);
    return { processed, failed, stuck, received24h };
  }),

  recent: adminProcedure
    .input(
      z.object({
        take: z.number().int().min(1).max(200).default(50),
        status: z.enum(["RECEIVED", "PROCESSING", "PROCESSED", "FAILED"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.stripeWebhookEvent.findMany({
        where: input.status ? { status: input.status } : undefined,
        orderBy: { receivedAt: "desc" },
        take: input.take,
        select: {
          id: true,
          type: true,
          status: true,
          attempts: true,
          errorReason: true,
          receivedAt: true,
          processedAt: true,
          livemode: true,
          apiVersion: true,
        },
      });
      return rows;
    }),

  // Reset a FAILED or PROCESSING row back to RECEIVED so a Stripe
  // resend can re-enter the handler. Our insert-then-process dedup
  // keys on the event id — triggering a Stripe "Resend event" action
  // afterwards will replay safely. This mutation doesn't trigger a
  // resend itself; staff still click "Resend" in the Stripe dashboard.
  reset: adminProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.prisma.stripeWebhookEvent.update({
        where: { id: input.eventId },
        data: { status: "RECEIVED", errorReason: null },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "stripe_webhook.reset",
        entity: "StripeWebhookEvent",
        entityId: input.eventId,
        status: "SUCCESS",
        newData: { type: event.type },
      });
      return { ok: true };
    }),
});
