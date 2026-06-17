import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { generateIncidentNumber, withUniqueRetry } from "@/lib/id-gen";
import { runOverdueCheck } from "@/server/jobs/overdue-check";
import {
  type LinktTripRow,
  upsertInfringementFromRow,
} from "@/server/services/linkt";
import { findBookingForVehicleAt } from "@/server/services/booking-matcher";

const TEST_TOLL_ACCOUNT_NAME = "Test injections";

export function assertNotProduction(nodeEnv: string | undefined = process.env.NODE_ENV): void {
  if (nodeEnv === "production") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Test data injection is disabled in production",
    });
  }
}

type ResolvedBooking = {
  id: string;
  bookingReference: string;
  customerId: string;
  status: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  customer: { firstName: string; lastName: string; email: string };
} | null;

async function resolveActiveBooking(
  prisma: import("@prisma/client").PrismaClient,
  vehicleId: string,
  at: Date,
): Promise<ResolvedBooking> {
  // Delegates to the shared matcher (booking-matcher.ts) so the test-injection
  // preview and the production toll/infringement attribution stay in lock-step.
  return findBookingForVehicleAt(prisma, vehicleId, at);
}

export const devToolsRouter = createTRPCRouter({
  /**
   * Preview: return the booking active on a vehicle at a given time,
   * so the UI can show the operator which booking their injection will
   * link to before they submit.
   */
  resolveActiveBooking: superAdminProcedure
    .input(z.object({ vehicleId: z.string().min(1), at: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      assertNotProduction();
      return resolveActiveBooking(ctx.prisma, input.vehicleId, input.at);
    }),

  /** Active / upcoming bookings for the overdue picker. */
  listForceableBookings: superAdminProcedure.query(async ({ ctx }) => {
    assertNotProduction();
    return ctx.prisma.booking.findMany({
      where: { status: { in: ["CHECKED_OUT", "ACTIVE"] } },
      orderBy: { returnDateTime: "asc" },
      take: 100,
      select: {
        id: true,
        bookingReference: true,
        status: true,
        returnDateTime: true,
        vehicle: { select: { internalCode: true, rego: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    });
  }),

  /**
   * Inject a raw toll row through the production matching pipeline.
   * Auto-matches to an active booking if one exists; otherwise lands in
   * Unmatched for manual resolution. Behaves identically to a real Linkt
   * sync row — to test the manual-resolve flow, inject against a vehicle
   * that isn't currently rented.
   */
  injectToll: superAdminProcedure
    .input(
      z.object({
        vehicleId: z.string().min(1),
        eventAt: z.coerce.date(),
        amountCents: z.number().int().min(1),
        tollpoint: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotProduction();

      const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({
        where: { id: input.vehicleId },
        select: { rego: true },
      });

      // Reuse an existing account if present, else make a dedicated test one
      // so real accounts aren't polluted with fake rows.
      let account = await ctx.prisma.linktAccount.findFirst({
        where: { name: TEST_TOLL_ACCOUNT_NAME },
      });
      if (!account) {
        account = await ctx.prisma.linktAccount.create({
          data: {
            name: TEST_TOLL_ACCOUNT_NAME,
            username: "test@xpertmoto.local",
            passwordEnc: "test",
            passwordIv: "test",
            passwordTag: "test",
            isActive: false,
          },
        });
      }

      const externalHash = `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const row: LinktTripRow = {
        externalHash,
        eventAt: input.eventAt,
        plate: vehicle.rego,
        tollpoint: input.tollpoint ?? "TEST",
        amountCents: input.amountCents,
        rawDetails: "Injected by test-data panel",
      };
      const result = await upsertInfringementFromRow(ctx.prisma, row, account);
      return { result, externalHash };
    }),

  /**
   * Inject an infringement linked to the booking active at offenceDate
   * (auto-resolved). Mirrors fleet.createInfringement shape.
   */
  injectInfringement: superAdminProcedure
    .input(
      z.object({
        vehicleId: z.string().min(1),
        type: z.enum(["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "OTHER"]),
        issuer: z.string().min(1),
        referenceNumber: z.string().min(1),
        offenceDate: z.coerce.date(),
        amount: z.number().min(0),
        dueDate: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotProduction();
      const booking = await resolveActiveBooking(ctx.prisma, input.vehicleId, input.offenceDate);
      return ctx.prisma.infringement.create({
        data: {
          vehicleId: input.vehicleId,
          bookingId: booking?.id,
          customerId: booking?.customerId,
          type: input.type,
          issuer: input.issuer,
          referenceNumber: input.referenceNumber,
          offenceDate: input.offenceDate,
          amount: input.amount,
          dueDate: input.dueDate,
        },
      });
    }),

  /**
   * Inject an incident on a vehicle/booking. Uses auto-resolution for booking
   * & customer. Does not dispatch manager notifications (intentionally —
   * tests shouldn't page real managers).
   */
  injectIncident: superAdminProcedure
    .input(
      z.object({
        vehicleId: z.string().min(1),
        dateTime: z.coerce.date(),
        type: z.enum([
          "ACCIDENT",
          "THEFT",
          "VANDALISM",
          "BREAKDOWN",
          "CUSTOMER_DAMAGE",
          "WEATHER",
          "INFRINGEMENT",
          "OTHER",
        ]),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"]),
        description: z.string().min(1),
        estimatedDamageCost: z.number().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotProduction();
      const booking = await resolveActiveBooking(ctx.prisma, input.vehicleId, input.dateTime);
      return withUniqueRetry(
        () =>
          ctx.prisma.incident.create({
            data: {
              incidentNumber: generateIncidentNumber(),
              vehicleId: input.vehicleId,
              bookingId: booking?.id,
              customerId: booking?.customerId,
              type: input.type,
              severity: input.severity,
              dateTime: input.dateTime,
              description: input.description,
              estimatedDamageCost: input.estimatedDamageCost,
              reportedById: ctx.user.id,
            },
          }),
        { constraintFields: ["incidentNumber"] },
      );
    }),

  /**
   * Force a booking into OVERDUE by back-dating its returnDateTime, then
   * run the overdue-check job immediately. Exercises the full ladder
   * (stage 1 at +1h, stage 2 at +12h, stage 3 at +24h, stage 4 at +72h).
   */
  forceBookingOverdue: superAdminProcedure
    .input(
      z.object({
        bookingId: z.string().min(1),
        minutesLate: z.number().int().min(61).max(60 * 24 * 14),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotProduction();
      const backdatedReturn = new Date(Date.now() - input.minutesLate * 60 * 1000);
      await ctx.prisma.booking.update({
        where: { id: input.bookingId },
        data: { returnDateTime: backdatedReturn, overdueStage: 0 },
      });
      const result = await runOverdueCheck();
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: {
          id: true,
          bookingReference: true,
          status: true,
          overdueStage: true,
          returnDateTime: true,
        },
      });
      return { booking, overdueRun: result };
    }),
});
