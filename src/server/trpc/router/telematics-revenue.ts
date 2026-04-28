import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  staffProcedure,
} from "../trpc";
import { summariseTelemetryCharges } from "@/server/services/telematics-revenue";
import { writeAudit } from "@/server/services/audit";
import { gstFromInclusive } from "@/lib/money";

/**
 * Lever 2 tRPC surface:
 *   - configureZone        · staff, per booking
 *   - requestServiceDispatch · customer, mid-rental upsell (fuel drop-off
 *                              / extra helmet / phone mount)
 *   - summariseCharges     · staff, ready-to-attach numbers at return
 *   - listZoneEvents       · staff, breach history for a booking
 */
export const telematicsRevenueRouter = createTRPCRouter({
  configureZone: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        centerLat: z.number(),
        centerLng: z.number(),
        radiusKm: z.number().min(10).max(1000).default(200),
        polygon: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
        allowStateCrossing: z.boolean().default(false),
        perKmSurchargeCents: z.number().int().min(0).max(500).default(35),
        borderCrossingFeeCents: z.number().int().min(0).max(50_000).default(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { id: true, bookingReference: true },
      });
      const zone = await ctx.prisma.rentalZone.upsert({
        where: { bookingId: booking.id },
        update: {
          centerLat: input.centerLat,
          centerLng: input.centerLng,
          radiusKm: input.radiusKm,
          polygon: input.polygon,
          allowStateCrossing: input.allowStateCrossing,
          perKmSurchargeCents: input.perKmSurchargeCents,
          borderCrossingFeeCents: input.borderCrossingFeeCents,
        },
        create: {
          bookingId: booking.id,
          centerLat: input.centerLat,
          centerLng: input.centerLng,
          radiusKm: input.radiusKm,
          polygon: input.polygon,
          allowStateCrossing: input.allowStateCrossing,
          perKmSurchargeCents: input.perKmSurchargeCents,
          borderCrossingFeeCents: input.borderCrossingFeeCents,
        },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "RENTAL_ZONE_CONFIGURED",
        entity: "RentalZone",
        entityId: zone.id,
        newData: input,
      });
      return zone;
    }),

  requestServiceDispatch: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        type: z.enum([
          "FUEL_DELIVERY",
          "EXTRA_HELMET",
          "PHONE_MOUNT",
          "SCOOTER_SWAP",
          "ROADSIDE",
          "BATTERY_JUMP",
        ]),
        deliveryLat: z.number().optional(),
        deliveryLng: z.number().optional(),
        deliveryNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      if (booking.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!["CHECKED_OUT", "ACTIVE", "OVERDUE"].includes(booking.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Service dispatch only available during an active rental.",
        });
      }

      const feeByType: Record<string, number> = {
        FUEL_DELIVERY: 25,
        EXTRA_HELMET: 15,
        PHONE_MOUNT: 10,
        SCOOTER_SWAP: 0,
        ROADSIDE: 45,
        BATTERY_JUMP: 35,
      };
      const feeAmount = feeByType[input.type] ?? 0;

      const dispatch = await ctx.prisma.$transaction(async (tx) => {
        const d = await tx.serviceDispatch.create({
          data: {
            bookingId: booking.id,
            type: input.type,
            feeAmount,
            deliveryLat: input.deliveryLat,
            deliveryLng: input.deliveryLng,
            deliveryNote: input.deliveryNote,
          },
        });
        if (feeAmount > 0) {
          const payment = await tx.payment.create({
            data: {
              reference: `DISPATCH-${d.id}`,
              customerId: booking.customerId,
              bookingId: booking.id,
              type: input.type === "FUEL_DELIVERY" ? "FUEL_DELIVERY_FEE" : "ADDON_CHARGE",
              method: "STRIPE",
              amount: feeAmount,
              gstAmount: gstFromInclusive(feeAmount),
              status: "PENDING",
              notes: `Service dispatch: ${input.type}`,
            },
          });
          await tx.serviceDispatch.update({
            where: { id: d.id },
            data: { paymentId: payment.id },
          });
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              fuelDeliveryTotal: input.type === "FUEL_DELIVERY"
                ? { increment: feeAmount }
                : undefined,
              balanceDue: { increment: feeAmount },
              totalAmount: { increment: feeAmount },
            },
          });
        }
        return d;
      });

      return dispatch;
    }),

  summariseCharges: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const summary = await summariseTelemetryCharges(
        ctx.prisma,
        input.bookingId,
      );
      return summary;
    }),

  listZoneEvents: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.zoneEvent.findMany({
        where: { bookingId: input.bookingId },
        orderBy: { eventAt: "asc" },
      });
    }),

  listSpeedEvents: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.speedEvent.findMany({
        where: { bookingId: input.bookingId },
        orderBy: { eventAt: "asc" },
      });
    }),
});
