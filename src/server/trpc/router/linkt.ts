import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, managerProcedure, adminProcedure } from "../trpc";
import { encryptSecret } from "@/lib/crypto";
import { runLinktSync } from "@/server/services/linkt";

/**
 * Pure validation for resolve-unmatched-row inputs. Split out so we can unit
 * test the business rules without spinning up a tRPC context. Mirrors the
 * e-toll validator (kept self-contained so e-toll can be retired later).
 */
export function validateResolveInputs(input: {
  alreadyResolved: boolean;
  bookingVehicleId: string | null;
  selectedVehicleId: string;
  linkMode: "booking" | "customer" | "none";
  hasBookingId: boolean;
  hasCustomerId: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.alreadyResolved) {
    return { ok: false, reason: "This row has already been resolved" };
  }
  if (input.linkMode === "booking") {
    if (!input.hasBookingId) return { ok: false, reason: "Missing booking" };
    if (input.bookingVehicleId == null) {
      return { ok: false, reason: "Booking not found" };
    }
    if (input.bookingVehicleId !== input.selectedVehicleId) {
      return { ok: false, reason: "Selected booking is not for the selected vehicle" };
    }
  }
  if (input.linkMode === "customer" && !input.hasCustomerId) {
    return { ok: false, reason: "Missing customer" };
  }
  return { ok: true };
}

const REGIONS = ["NSW", "VIC", "QLD"] as const;

const accountSelect = {
  id: true,
  name: true,
  username: true,
  region: true,
  loginUrl: true,
  isActive: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
  createdAt: true,
} as const;

export const linktRouter = createTRPCRouter({
  listAccounts: managerProcedure.query(({ ctx }) =>
    ctx.prisma.linktAccount.findMany({
      orderBy: { createdAt: "desc" },
      select: accountSelect,
    }),
  ),

  createAccount: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        username: z.string().min(1),
        password: z.string().min(1),
        region: z.enum(REGIONS).default("NSW"),
        loginUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const sec = encryptSecret(input.password);
      return ctx.prisma.linktAccount.create({
        data: {
          name: input.name,
          username: input.username,
          region: input.region,
          loginUrl: input.loginUrl ?? "https://www.linkt.com.au/login",
          passwordEnc: sec.enc,
          passwordIv: sec.iv,
          passwordTag: sec.tag,
        },
        select: accountSelect,
      });
    }),

  updateAccount: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        username: z.string().min(1).optional(),
        password: z.string().min(1).optional(),
        region: z.enum(REGIONS).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.name) data.name = input.name;
      if (input.username) data.username = input.username;
      if (input.region) data.region = input.region;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.password) {
        const sec = encryptSecret(input.password);
        data.passwordEnc = sec.enc;
        data.passwordIv = sec.iv;
        data.passwordTag = sec.tag;
      }
      return ctx.prisma.linktAccount.update({
        where: { id: input.id },
        data,
        select: accountSelect,
      });
    }),

  deleteAccount: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.linktAccount.delete({ where: { id: input.id } }),
    ),

  runSyncNow: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await runLinktSync(ctx.prisma, input.id);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),

  listSyncs: managerProcedure
    .input(z.object({ accountId: z.string(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(({ ctx, input }) =>
      ctx.prisma.linktSync.findMany({
        where: { accountId: input.accountId },
        orderBy: { startedAt: "desc" },
        take: input.limit,
      }),
    ),

  listUnmatched: managerProcedure
    .input(
      z.object({
        accountId: z.string().optional(),
        includeResolved: z.boolean().default(false),
        search: z.string().trim().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.LinktUnmatchedRowWhereInput = {};
      if (input.accountId) where.accountId = input.accountId;
      if (!input.includeResolved) where.resolvedAt = null;
      if (input.search) {
        where.OR = [
          { plate: { contains: input.search, mode: "insensitive" } },
          { tollpoint: { contains: input.search, mode: "insensitive" } },
          { rawDetails: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const items = await ctx.prisma.linktUnmatchedRow.findMany({
        where,
        include: { account: { select: { id: true, name: true } } },
        orderBy: [{ resolvedAt: "asc" }, { eventAt: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = items.length > input.limit ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  unmatchedCount: managerProcedure
    .input(z.object({ accountId: z.string().optional() }))
    .query(({ ctx, input }) =>
      ctx.prisma.linktUnmatchedRow.count({
        where: {
          resolvedAt: null,
          ...(input.accountId ? { accountId: input.accountId } : {}),
        },
      }),
    ),

  suggestBookingsForUnmatched: managerProcedure
    .input(z.object({ id: z.string(), vehicleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.linktUnmatchedRow.findUnique({
        where: { id: input.id },
        select: { eventAt: true },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Unmatched row not found" });

      const exact = await ctx.prisma.booking.findMany({
        where: {
          vehicleId: input.vehicleId,
          pickupDateTime: { lte: row.eventAt },
          returnDateTime: { gte: row.eventAt },
        },
        select: {
          id: true,
          bookingReference: true,
          pickupDateTime: true,
          returnDateTime: true,
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { pickupDateTime: "desc" },
        take: 5,
      });
      if (exact.length > 0) return { bookings: exact, window: "exact" as const };

      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const near = await ctx.prisma.booking.findMany({
        where: {
          vehicleId: input.vehicleId,
          pickupDateTime: { lte: new Date(row.eventAt.getTime() + threeDaysMs) },
          returnDateTime: { gte: new Date(row.eventAt.getTime() - threeDaysMs) },
        },
        select: {
          id: true,
          bookingReference: true,
          pickupDateTime: true,
          returnDateTime: true,
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { pickupDateTime: "desc" },
        take: 5,
      });
      return { bookings: near, window: "fuzzy" as const };
    }),

  resolveUnmatched: managerProcedure
    .input(
      z.object({
        id: z.string(),
        vehicleId: z.string().min(1),
        bookingId: z.string().optional(),
        customerId: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.linktUnmatchedRow.findUnique({
        where: { id: input.id },
        include: { account: { select: { id: true, name: true, region: true } } },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Unmatched row not found" });
      if (row.resolvedAt) {
        throw new TRPCError({ code: "CONFLICT", message: "This row has already been resolved" });
      }

      let bookingId: string | null = null;
      let customerId: string | null = input.customerId ?? null;
      if (input.bookingId) {
        const booking = await ctx.prisma.booking.findUnique({
          where: { id: input.bookingId },
          select: { id: true, vehicleId: true, customerId: true },
        });
        if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        if (booking.vehicleId !== input.vehicleId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected booking is not for the selected vehicle",
          });
        }
        bookingId = booking.id;
        customerId = booking.customerId;
      } else if (input.customerId) {
        const customer = await ctx.prisma.user.findUnique({
          where: { id: input.customerId },
          select: { id: true },
        });
        if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      // Guard against a race where the sync worker created the Infringement
      // between the UI load and this mutation firing.
      const existing = await ctx.prisma.infringement.findUnique({
        where: { referenceNumber: row.externalHash },
        select: { id: true },
      });
      if (existing) {
        await ctx.prisma.linktUnmatchedRow.update({
          where: { id: row.id },
          data: {
            resolvedAt: new Date(),
            resolvedById: ctx.session.user.id,
            resolvedAction: "AUTO_MATCHED",
            resolvedInfringementId: existing.id,
          },
        });
        return { infringementId: existing.id };
      }

      const tollAud = row.amountCents / 100;
      const { getTollAdminFee } = await import("@/server/services/toll-admin-fee");
      const adminFeeAud = await getTollAdminFee();
      const infringement = await ctx.prisma.infringement.create({
        data: {
          vehicleId: input.vehicleId,
          bookingId: bookingId ?? undefined,
          customerId: customerId ?? undefined,
          type: "TOLL",
          issuer: `Linkt-${row.account.region} (${row.account.name})`,
          referenceNumber: row.externalHash,
          offenceDate: row.eventAt,
          amount: new Prisma.Decimal(tollAud.toFixed(2)),
          adminFee: new Prisma.Decimal(adminFeeAud.toFixed(2)),
          status: customerId ? "CUSTOMER_CHARGED" : "RECEIVED",
          notes: `Toll: ${row.tollpoint || "—"}. Source: ${row.rawDetails ?? row.plate}`,
        },
      });

      await ctx.prisma.linktUnmatchedRow.update({
        where: { id: row.id },
        data: {
          resolvedAt: new Date(),
          resolvedById: ctx.session.user.id,
          resolvedAction: "RESOLVED",
          resolvedInfringementId: infringement.id,
          resolutionNotes: input.notes ?? null,
        },
      });

      if (customerId) {
        const { applyInfringementRecoveryCharge } = await import(
          "@/server/services/infringement-charge"
        );
        await applyInfringementRecoveryCharge({
          prisma: ctx.prisma,
          infringement: {
            id: infringement.id,
            referenceNumber: infringement.referenceNumber,
            type: infringement.type,
            issuer: infringement.issuer,
            amount: tollAud,
            adminFee: adminFeeAud,
            bookingId: bookingId ?? null,
            customerId,
          },
          performedById: ctx.session.user.id,
        });
      }

      return { infringementId: infringement.id };
    }),

  dismissUnmatched: managerProcedure
    .input(z.object({ id: z.string(), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.linktUnmatchedRow.findUnique({
        where: { id: input.id },
        select: { id: true, resolvedAt: true },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Unmatched row not found" });
      if (row.resolvedAt) {
        throw new TRPCError({ code: "CONFLICT", message: "This row has already been resolved" });
      }

      return ctx.prisma.linktUnmatchedRow.update({
        where: { id: row.id },
        data: {
          resolvedAt: new Date(),
          resolvedById: ctx.session.user.id,
          resolvedAction: "DISMISSED",
          resolutionNotes: input.notes ?? null,
        },
        select: { id: true },
      });
    }),

  listTransactions: managerProcedure
    .input(
      z.object({
        accountId: z.string().optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        status: z
          .enum(["RECEIVED", "NOMINATED", "CUSTOMER_CHARGED", "PAID", "DISPUTED", "WRITTEN_OFF"])
          .optional(),
        search: z.string().trim().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.InfringementWhereInput = { type: "TOLL" };

      if (input.accountId) {
        const account = await ctx.prisma.linktAccount.findUnique({
          where: { id: input.accountId },
          select: { name: true },
        });
        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
        // Linkt infringements carry issuer "Linkt-<region> (<name>)".
        where.issuer = { startsWith: "Linkt-", contains: `(${account.name})` };
      } else {
        where.issuer = { startsWith: "Linkt-" };
      }

      if (input.status) where.status = input.status;

      if (input.dateFrom || input.dateTo) {
        where.offenceDate = {
          ...(input.dateFrom ? { gte: input.dateFrom } : {}),
          ...(input.dateTo ? { lte: input.dateTo } : {}),
        };
      }

      if (input.search) {
        where.AND = [
          {
            OR: [
              { referenceNumber: { contains: input.search, mode: "insensitive" } },
              { notes: { contains: input.search, mode: "insensitive" } },
              { vehicle: { rego: { contains: input.search, mode: "insensitive" } } },
              { vehicle: { internalCode: { contains: input.search, mode: "insensitive" } } },
              { booking: { bookingReference: { contains: input.search, mode: "insensitive" } } },
            ],
          },
        ];
      }

      const items = await ctx.prisma.infringement.findMany({
        where,
        include: {
          vehicle: { select: { internalCode: true, rego: true } },
          booking: {
            select: {
              bookingReference: true,
              customer: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { offenceDate: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      const nextCursor = items.length > input.limit ? items.pop()!.id : null;
      return { items, nextCursor };
    }),
});
