import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../trpc";

const PARTNER_TYPE = z.enum(["HOTEL", "HOSTEL", "TOUR_OPERATOR", "AGGREGATOR", "CORPORATE", "OTHER"]);
const PARTNER_TX_STATUS = z.enum(["PENDING", "PAYABLE", "PAID", "DISPUTED", "VOIDED"]);

/**
 * Partner router — hotel concierges, aggregators, and B2B channels that
 * refer bookings. Partners earn a commission on each booking attributed
 * via their tracking code. Commissions are ledgered in PartnerTransaction
 * with a lifecycle: PENDING → PAYABLE (once booking completes) → PAID
 * (once admin marks it settled). Stripe Connect payout is out of scope.
 */
export const partnerRouter = createTRPCRouter({
  /**
   * Public: resolve a tracking code to a minimal public identity. Used by
   * the booking widget when a customer lands with ?ref=CODE.
   */
  resolveTrackingCode: publicProcedure
    .input(z.object({ trackingCode: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const partner = await ctx.prisma.partner.findUnique({
        where: { trackingCode: input.trackingCode },
        select: { id: true, slug: true, name: true, isActive: true, widgetEnabled: true },
      });
      if (!partner || !partner.isActive || !partner.widgetEnabled) return null;
      return partner;
    }),

  /** Admin: list every partner. */
  list: adminProcedure
    .input(
      z.object({
        type: PARTNER_TYPE.optional(),
        onlyActive: z.boolean().default(false),
      }).optional(),
    )
    .query(({ ctx, input }) =>
      ctx.prisma.partner.findMany({
        where: {
          ...(input?.type ? { type: input.type } : {}),
          ...(input?.onlyActive ? { isActive: true } : {}),
        },
        orderBy: { name: "asc" },
      }),
    ),

  /** Admin: full detail with recent transactions. */
  detail: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const partner = await ctx.prisma.partner.findUnique({
      where: { id: input.id },
      include: {
        users: true,
        transactions: {
          include: {
            booking: {
              select: { id: true, bookingReference: true, totalAmount: true, status: true },
            },
          },
          orderBy: { attributedAt: "desc" },
          take: 50,
        },
      },
    });
    if (!partner) throw new TRPCError({ code: "NOT_FOUND" });
    return partner;
  }),

  /** Admin: create. Auto-generates tracking code if blank. */
  create: adminProcedure
    .input(
      z.object({
        slug: z.string().min(2),
        name: z.string().min(2),
        type: PARTNER_TYPE,
        commissionPct: z.number().min(0).max(100).default(10),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().optional(),
        trackingCode: z.string().optional(),
        websiteUrl: z.string().url().optional(),
        depotIds: z.array(z.string()).default([]),
        widgetEnabled: z.boolean().default(true),
        notes: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.partner.create({
        data: {
          ...input,
          trackingCode: input.trackingCode ?? slugifyTracking(input.slug),
        },
      }),
    ),

  /** Admin: update. */
  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          name: z.string().min(2).optional(),
          type: PARTNER_TYPE.optional(),
          commissionPct: z.number().min(0).max(100).optional(),
          contactEmail: z.string().email().nullable().optional(),
          contactPhone: z.string().nullable().optional(),
          websiteUrl: z.string().url().nullable().optional(),
          depotIds: z.array(z.string()).optional(),
          widgetEnabled: z.boolean().optional(),
          isActive: z.boolean().optional(),
          notes: z.string().nullable().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.partner.update({ where: { id: input.id }, data: input.data }),
    ),

  /**
   * Attribute a booking to a partner — idempotent on (bookingId, partnerId).
   * Called from the booking-creation flow when the customer carried a
   * tracking code, and from admin when fixing up a miscategorised booking.
   * Commission is snapshot at the time of attribution so later commission
   * rate changes don't retroactively shift payouts.
   */
  attributeBooking: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        partnerId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [booking, partner] = await Promise.all([
        ctx.prisma.booking.findUnique({ where: { id: input.bookingId } }),
        ctx.prisma.partner.findUnique({ where: { id: input.partnerId } }),
      ]);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      if (!partner || !partner.isActive)
        throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found or inactive" });

      const bookingTotal = Number(booking.totalAmount);
      const commissionAmount = computePartnerCommission(bookingTotal, Number(partner.commissionPct));

      return ctx.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: { partnerId: partner.id },
        });
        return tx.partnerTransaction.upsert({
          where: { bookingId_partnerId: { bookingId: booking.id, partnerId: partner.id } },
          create: {
            partnerId: partner.id,
            bookingId: booking.id,
            bookingTotal,
            commissionPct: partner.commissionPct,
            commissionAmount,
            status: booking.status === "COMPLETED" ? "PAYABLE" : "PENDING",
          },
          update: {
            bookingTotal,
            commissionAmount,
          },
        });
      });
    }),

  /**
   * Admin: settle a commission — mark a PAYABLE transaction as PAID. The
   * actual money movement (Stripe transfer, bank) happens outside this
   * system; this just records the settlement.
   */
  settleTransaction: adminProcedure
    .input(
      z.object({
        transactionId: z.string(),
        stripeTransferId: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.prisma.partnerTransaction.findUniqueOrThrow({
        where: { id: input.transactionId },
      });
      if (tx.status !== "PAYABLE") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Can only settle PAYABLE commissions (status is ${tx.status}).`,
        });
      }
      return ctx.prisma.partnerTransaction.update({
        where: { id: tx.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          stripeTransferId: input.stripeTransferId,
          notes: input.notes,
        },
      });
    }),

  /** Admin: dispute or void a transaction. */
  setTransactionStatus: adminProcedure
    .input(
      z.object({
        transactionId: z.string(),
        status: PARTNER_TX_STATUS,
        notes: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.partnerTransaction.update({
        where: { id: input.transactionId },
        data: {
          status: input.status,
          notes: input.notes,
        },
      }),
    ),

  /**
   * Admin: aggregate dashboard metrics — outstanding commissions, YTD
   * attributed revenue, top partners by volume.
   */
  metrics: adminProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.PartnerTransactionWhereInput = {
        attributedAt: { gte: input.from, lt: input.to },
      };
      const [allTx, byStatus] = await Promise.all([
        ctx.prisma.partnerTransaction.findMany({
          where,
          include: { partner: { select: { id: true, name: true } } },
        }),
        ctx.prisma.partnerTransaction.groupBy({
          by: ["status"],
          where,
          _sum: { commissionAmount: true, bookingTotal: true },
          _count: true,
        }),
      ]);

      const byPartner = new Map<
        string,
        { partnerId: string; partnerName: string; total: number; commission: number; count: number }
      >();
      for (const t of allTx) {
        const existing = byPartner.get(t.partnerId) ?? {
          partnerId: t.partnerId,
          partnerName: t.partner.name,
          total: 0,
          commission: 0,
          count: 0,
        };
        existing.total += Number(t.bookingTotal);
        existing.commission += Number(t.commissionAmount);
        existing.count += 1;
        byPartner.set(t.partnerId, existing);
      }

      return {
        totals: byStatus.map((s) => ({
          status: s.status,
          count: s._count,
          bookingTotal: Number(s._sum.bookingTotal ?? 0),
          commissionAmount: Number(s._sum.commissionAmount ?? 0),
        })),
        byPartner: Array.from(byPartner.values()).sort((a, b) => b.commission - a.commission),
      };
    }),
});

/** Partner tracking-code slugifier. Exported for tests. */
export function slugifyTracking(slug: string): string {
  return slug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 16) || "PARTNER";
}

/**
 * Round to cents. Returns `bookingTotal * commissionPct / 100` rounded to
 * 2 dp. Snapshotted at attribution time so later rate changes don't
 * retroactively shift payouts.
 */
export function computePartnerCommission(
  bookingTotal: number,
  commissionPct: number,
): number {
  return Math.round((bookingTotal * commissionPct) / 100 * 100) / 100;
}
