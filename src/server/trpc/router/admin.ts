import { z } from "zod";
import { Prisma, type PaymentType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";
import { createTRPCRouter, adminProcedure, managerProcedure, superAdminProcedure } from "../trpc";
import {
  buildInviteIdentifier,
  issueStaffInvite,
} from "@/server/services/staff-invite";
import { anonymiseUser } from "@/server/services/anonymise-user";
import {
  captureCustomerId,
  readCapturedCustomerId,
} from "@/server/services/audit";
import { geocodeAddress } from "@/lib/geo";
import { trackServerGroupIdentify } from "@/lib/analytics";
import { revalidateTag } from "next/cache";
import { invalidateTag } from "@/lib/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { paymentNetWeight, signedPaymentAmount } from "@/lib/payment-labels";
import { roundCents } from "@/lib/money";
import { reconcilePayments } from "@/server/services/finance-reconciliation";
import { computeGstSummary } from "@/server/services/gst-bas-export";
import { runStripeReconcile } from "@/server/jobs/stripe-reconcile";
import {
  netCashByBooking,
  reconcileInvoice,
} from "@/lib/finance/invoice-reconciliation";

const BRANDING_SETTING_KEYS = new Set([
  "org.tradingName",
  "org.siteTagline",
  "org.legalName",
  "org.abn",
  "org.supportEmail",
  "org.privacyEmail",
  "org.postalAddress",
  "org.logoWideUrl",
  "org.logoSquareUrl",
  "org.faviconUrl",
]);
import { getSecret, getString } from "@/lib/integration-config";
import { skipAutoAudit, writeAudit } from "@/server/services/audit";
import { buildAuditWhere } from "@/server/services/audit-query";
import {
  debtorsList,
  debtorsSummary,
  incidentsSummary,
  theftsOpen,
  unpaidInfringementsSummary,
} from "@/server/services/admin-risk-signals";
import { sendNotification } from "@/server/services/notification-sender";
import {
  categoryArchiveSchema,
  categoryFormSchema,
  categoryReorderSchema,
  categoryUpdateSchema,
} from "@/lib/validators/category";
import {
  pricingTierDeleteInputSchema,
  pricingTierListInputSchema,
  pricingTierReplaceInputSchema,
  type PricingTierScope,
} from "@/lib/validators/pricing-tier";

function tierScopeWhere(scope: PricingTierScope, scopeId: string) {
  switch (scope) {
    case "CATEGORY":
      return { categoryId: scopeId };
    case "MODEL":
      return { modelId: scopeId };
    case "VEHICLE":
      return { vehicleId: scopeId };
  }
}
import { reassignFutureBookings } from "@/server/services/fleet-reassign";

/**
 * Register/update the depot's properties on its PostHog group so events
 * tagged `$groups: { depot: slug }` can be sliced by depot attributes.
 * Keyed on the depot slug to match the group key used on every event.
 * Best-effort — fired on depot create/update only, never per event.
 */
async function identifyDepotGroup(depot: {
  slug: string;
  name: string;
  state: string;
  timezone: string;
  isActive: boolean;
  maxCapacity: number;
}): Promise<void> {
  await trackServerGroupIdentify({
    groupType: "depot",
    groupKey: depot.slug,
    set: {
      name: depot.name,
      state: depot.state,
      timezone: depot.timezone,
      isActive: depot.isActive,
      maxCapacity: depot.maxCapacity,
    },
  });
}

export const adminRouter = createTRPCRouter({
  // ----- KPIs -----
  dashboard: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [todayRevenue, mtdRevenue, activeRentals, newCustomersMonth, totalFleet, rented, overdue, trendRows] = await Promise.all([
      ctx.prisma.booking.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      ctx.prisma.booking.aggregate({
        where: { createdAt: { gte: startOfMonth }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      ctx.prisma.booking.count({ where: { status: "ACTIVE" } }),
      ctx.prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: startOfMonth } } }),
      ctx.prisma.vehicle.count({ where: { isActive: true } }),
      ctx.prisma.vehicle.count({ where: { isActive: true, status: "RENTED" } }),
      ctx.prisma.booking.count({ where: { status: "OVERDUE" } }),
      ctx.prisma.$queryRaw<Array<{ month: Date; revenue: unknown }>>`
        SELECT date_trunc('month', "date") AS "month", SUM("totalRevenue") AS "revenue"
        FROM "DailyRevenue"
        WHERE "date" >= date_trunc('month', ${twelveMonthsAgo}::timestamp)
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    const monthBuckets = new Map<string, { revenue: number; count: number }>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(twelveMonthsAgo.getFullYear(), twelveMonthsAgo.getMonth() + i, 1);
      monthBuckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { revenue: 0, count: 0 });
    }
    for (const r of trendRows) {
      const d = new Date(r.month);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = monthBuckets.get(key);
      if (bucket) bucket.revenue = Number(r.revenue ?? 0);
    }
    const trend = Array.from(monthBuckets.entries()).map(([month, v]) => ({ month, ...v }));

    return {
      todayRevenue: Number(todayRevenue._sum.totalAmount ?? 0),
      todayBookings: todayRevenue._count,
      mtdRevenue: Number(mtdRevenue._sum.totalAmount ?? 0),
      mtdBookings: mtdRevenue._count,
      activeRentals,
      newCustomersMonth,
      fleetUtilisation: totalFleet ? Math.round((rented / totalFleet) * 100) : 0,
      overdue,
      trend,
    };
  }),

  // ----- Risk & debt -----
  riskOverview: adminProcedure.query(async ({ ctx }) => {
    const [incidents, thefts, infringements, debtors] = await Promise.all([
      incidentsSummary(ctx.prisma),
      theftsOpen(ctx.prisma),
      unpaidInfringementsSummary(ctx.prisma),
      debtorsSummary(ctx.prisma),
    ]);
    return { incidents, thefts, infringements, debtors };
  }),

  debtors: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(({ ctx, input }) => debtorsList(input?.limit ?? 100, ctx.prisma)),

  sendDebtReminder: adminProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
        channels: z.array(z.enum(["EMAIL", "SMS"])).min(1).default(["EMAIL", "SMS"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const all = await debtorsList(500, ctx.prisma);
      const debtor = all.find((d) => d.customerId === input.customerId);
      if (!debtor) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No outstanding balance for this customer." });
      }

      const channels = debtor.phone ? input.channels : input.channels.filter((c) => c !== "SMS");

      const { getBranding } = await import("@/lib/branding");
      const { siteName } = await getBranding();
      const { buildDebtReminderEmail } = await import("@/server/jobs/debt-reminder");
      const portalUrl = `${
        process.env.AUTH_URL ??
        process.env.APP_URL ??
        process.env.NEXTAUTH_URL ??
        "http://localhost:3000"
      }/dashboard`;
      const { subject, title, body, html } = await buildDebtReminderEmail(
        debtor,
        siteName,
        portalUrl,
      );
      const res = await sendNotification({
        userId: debtor.customerId,
        type: "DEBT_REMINDER",
        channels,
        subject,
        title,
        body,
        html,
        templateKey: "debt-reminder",
        data: {
          totalOwed: debtor.totalOwed,
          bookingDebt: debtor.bookingDebt,
          invoiceDebt: debtor.invoiceDebt,
          infringementDebt: debtor.infringementDebt,
          trigger: "manual",
          triggeredById: ctx.user.id,
        },
        sentById: ctx.user.id,
      });
      return { results: res.results, sentAt: new Date() };
    }),

  // ----- Users -----
  listUsers: adminProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          role: z.string().optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(5).max(200).default(25),
          sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
          sortDir: z.enum(["asc", "desc"]).default("desc"),
        })
        .default({
          page: 1,
          pageSize: 25,
          sortBy: "createdAt",
          sortDir: "desc",
        }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.UserWhereInput = {
        ...(input.role ? { role: input.role as never } : {}),
        ...(input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: "insensitive" } },
                { firstName: { contains: input.search, mode: "insensitive" } },
                { lastName: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const orderBy: Prisma.UserOrderByWithRelationInput[] =
        input.sortBy === "name"
          ? [{ firstName: input.sortDir }, { lastName: input.sortDir }]
          : [{ createdAt: input.sortDir }];
      const [rawItems, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          include: { depot: true, staffProfile: true },
          orderBy,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);
      // A user is "pending invite" if they've never set a password. We need
      // this flag on the client to render the pending badge + resend/revoke
      // actions — but passwordHash itself must not leave the server, so we
      // compute the boolean here and strip the field.
      const items = rawItems.map((u) => {
        const { passwordHash, ...rest } = u;
        return { ...rest, hasPendingInvite: passwordHash === null };
      });
      const pageCount = Math.max(1, Math.ceil(totalCount / input.pageSize));
      return {
        items,
        totalCount,
        pageCount,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  usersStats: adminProcedure.query(async ({ ctx }) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [total, byRoleRaw, byStatusRaw, newThisMonth, staffPending] = await Promise.all([
      ctx.prisma.user.count(),
      ctx.prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      ctx.prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
      ctx.prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      ctx.prisma.user.count({
        where: {
          role: { in: ["STAFF", "MANAGER", "ADMIN"] },
          emailVerified: null,
        },
      }),
    ]);

    const roleMap: Record<string, number> = {};
    for (const r of byRoleRaw) roleMap[r.role] = r._count._all;
    const statusMap: Record<string, number> = {};
    for (const r of byStatusRaw) statusMap[r.status] = r._count._all;

    return {
      total,
      byRole: {
        customer: roleMap.CUSTOMER ?? 0,
        staff: roleMap.STAFF ?? 0,
        manager: roleMap.MANAGER ?? 0,
        admin: roleMap.ADMIN ?? 0,
        superAdmin: roleMap.SUPER_ADMIN ?? 0,
      },
      byStatus: {
        active: statusMap.ACTIVE ?? 0,
        suspended: statusMap.SUSPENDED ?? 0,
        banned: statusMap.BANNED ?? 0,
      },
      newThisMonth,
      staffPendingVerification: staffPending,
    };
  }),

  inviteStaff: adminProcedure
    .input(
      z.object({
        email: z.preprocess(
          (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
          z.string().email(),
        ),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        role: z.enum(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]),
        depotId: z.string().optional(),
        position: z.string().optional(),
      }),
    )
    .meta({
      audit: {
        entity: "User",
        customerIdPath: readCapturedCustomerId,
      },
    })
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
      });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });

      // Create the user with NO password and SUSPENDED status. They cannot
      // log in until they accept the invite (passwordHash=null is rejected
      // at src/lib/auth.ts, and status != ACTIVE is rejected too).
      const user = await ctx.prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          depotId: input.depotId,
          passwordHash: null,
          status: "SUSPENDED",
          staffProfile: {
            create: {
              employeeId: `${input.role.slice(0, 3)}-${Date.now().toString().slice(-6)}`,
              position: input.position,
            },
          },
          // Back-office users also get a CustomerProfile so they can rent
          // personally. Bare on creation (only userId via the relation) —
          // onboarding collects consent + licence before they can book, so
          // we deliberately leave onboardedAt/consent/licence null here.
          customerProfile: { create: {} },
        },
      });
      captureCustomerId(ctx, user.id);

      const inviterName = ctx.user.name ?? ctx.user.email ?? "an administrator";
      const { expiresAt } = await issueStaffInvite(ctx.prisma, {
        email: input.email,
        role: input.role,
        inviterName,
      });

      return { id: user.id, email: user.email, expiresAt };
    }),

  resendInvite: adminProcedure
    .input(z.object({ userId: z.string() }))
    .meta({
      audit: {
        entity: "User",
        customerIdPath: readCapturedCustomerId,
      },
    })
    .mutation(async ({ ctx, input }) => {
      captureCustomerId(ctx, input.userId);
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          email: true,
          role: true,
          status: true,
          passwordHash: true,
          firstName: true,
          lastName: true,
        },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (user.role === "CUSTOMER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only staff-role accounts can be re-invited.",
        });
      }
      if (user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This account has already been activated.",
        });
      }
      const inviterName = ctx.user.name ?? ctx.user.email ?? "an administrator";
      const { expiresAt } = await issueStaffInvite(ctx.prisma, {
        email: user.email,
        role: user.role,
        inviterName,
      });
      return { email: user.email, expiresAt };
    }),

  revokeInvite: adminProcedure
    .input(z.object({ userId: z.string() }))
    .meta({
      audit: {
        entity: "User",
        customerIdPath: readCapturedCustomerId,
      },
    })
    .mutation(async ({ ctx, input }) => {
      captureCustomerId(ctx, input.userId);
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, passwordHash: true, role: true },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This account has already been activated — suspend instead.",
        });
      }
      await ctx.prisma.$transaction([
        ctx.prisma.verificationToken.deleteMany({
          where: { identifier: buildInviteIdentifier(user.email) },
        }),
        ctx.prisma.staffProfile.deleteMany({ where: { userId: input.userId } }),
        ctx.prisma.user.delete({ where: { id: input.userId } }),
      ]);
      return { ok: true };
    }),

  updateUser: adminProcedure
    .input(
      z.object({
        id: z.string(),
        role: z.enum(["CUSTOMER", "STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]).optional(),
        status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]).optional(),
        depotId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.role) data.role = input.role;
      if (input.status) data.status = input.status;
      if (input.depotId !== undefined) data.depotId = input.depotId;
      return ctx.prisma.user.update({ where: { id: input.id }, data });
    }),

  // Soft-delete a staff/manager/admin account. Restricted to super admins so
  // that ordinary admins cannot delete their peers. Hard delete is unsafe —
  // staff ids are FK-referenced by Bookings, WorkOrders, AuditLogs etc. which
  // must be retained for 7 years of ATO compliance — so we use the same
  // anonymisation path as APP 13 customer deletion.
  deleteStaffUser: superAdminProcedure
    .input(z.object({ userId: z.string() }))
    .meta({
      audit: {
        entity: "User",
        customerIdPath: readCapturedCustomerId,
      },
    })
    .mutation(async ({ ctx, input }) => {
      captureCustomerId(ctx, input.userId);
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot delete your own account.",
        });
      }
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (user.deletedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This user has already been deleted.",
        });
      }
      if (!["STAFF", "MANAGER", "ADMIN"].includes(user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only staff, managers, and admins can be deleted through this action.",
        });
      }
      await anonymiseUser(ctx.prisma, input.userId, {
        reason: "Deleted by super admin",
        actorUserId: ctx.user.id,
      });
      return { ok: true };
    }),

  // ----- Depots -----
  listDepots: managerProcedure.query(({ ctx }) =>
    ctx.prisma.depot.findMany({
      where: { deletedAt: null },
      include: { operatingHours: { orderBy: { dayOfWeek: "asc" } }, _count: { select: { vehicles: true } } },
      orderBy: { name: "asc" },
    }),
  ),

  createDepot: adminProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required"),
        slug: z.string().min(1, "Slug is required"),
        addressLine1: z.string().min(1, "Address is required"),
        suburb: z.string().min(1, "Suburb is required"),
        state: z.string().min(2, "State is required"),
        postcode: z.string().min(4, "Postcode is required"),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        timezone: z.string().default("Australia/Brisbane"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let slug = input.slug;
      let suffix = 1;
      while (await ctx.prisma.depot.findUnique({ where: { slug } })) {
        suffix += 1;
        slug = `${input.slug}-${suffix}`;
      }
      // Geocode the address to get coordinates for the map
      const addr = [input.addressLine1, input.suburb, input.state, input.postcode, "Australia"].join(", ");
      const coords = await geocodeAddress(addr);
      if (!coords) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not verify address — please check the address details and try again.",
        });
      }
      const depot = await ctx.prisma.depot.create({
        data: {
          ...input,
          slug,
          latitude: coords.lat,
          longitude: coords.lng,
          operatingHours: {
            create: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, openTime: "08:00", closeTime: "18:00" })),
          },
        },
      });
      await invalidateTag(CACHE_TAGS.DEPOTS);
      await identifyDepotGroup(depot);
      return depot;
    }),

  updateDepot: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        addressLine1: z.string().optional(),
        addressLine2: z.string().nullable().optional(),
        suburb: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        timezone: z.string().optional(),
        maxCapacity: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Auto-geocode when address fields are provided
      const addressChanged = data.addressLine1 || data.suburb || data.state || data.postcode;
      if (addressChanged) {
        const existing = await ctx.prisma.depot.findUniqueOrThrow({ where: { id } });
        const addr = [
          data.addressLine1 ?? existing.addressLine1,
          data.suburb ?? existing.suburb,
          data.state ?? existing.state,
          data.postcode ?? existing.postcode,
          "Australia",
        ].join(", ");
        const coords = await geocodeAddress(addr);
        if (coords) {
          (data as Record<string, unknown>).latitude = coords.lat;
          (data as Record<string, unknown>).longitude = coords.lng;
        }
      }
      const depot = await ctx.prisma.depot.update({ where: { id }, data });
      await invalidateTag(CACHE_TAGS.DEPOTS);
      await identifyDepotGroup(depot);
      return depot;
    }),

  updateDepotHours: adminProcedure
    .input(
      z.object({
        depotId: z.string(),
        hours: z.array(
          z.object({ dayOfWeek: z.number().int().min(0).max(6), openTime: z.string(), closeTime: z.string(), isClosed: z.boolean() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async (tx) => {
        await tx.depotOperatingHours.deleteMany({ where: { depotId: input.depotId } });
        await tx.depotOperatingHours.createMany({
          data: input.hours.map((h) => ({ depotId: input.depotId, ...h })),
        });
      });
      await invalidateTag(CACHE_TAGS.DEPOTS);
      return { ok: true };
    }),

  // ----- Pricing -----
  pricingSummary: adminProcedure.query(async ({ ctx }) => {
    const [categories, addons, insurance, discounts, seasons, tierCounts] = await Promise.all([
      ctx.prisma.vehicleCategory.findMany({ orderBy: { displayOrder: "asc" } }),
      ctx.prisma.addon.findMany({ orderBy: { name: "asc" } }),
      ctx.prisma.insuranceOption.findMany({ orderBy: { dailyRate: "asc" } }),
      ctx.prisma.discount.findMany({ orderBy: { code: "asc" } }),
      ctx.prisma.season.findMany({ orderBy: { startDate: "asc" } }),
      ctx.prisma.pricingTier.groupBy({
        by: ["categoryId"],
        where: { categoryId: { not: null }, isActive: true },
        _count: { _all: true },
      }),
    ]);
    const tierCountByCategory: Record<string, number> = {};
    for (const row of tierCounts) {
      if (row.categoryId) tierCountByCategory[row.categoryId] = row._count._all;
    }
    return { categories, addons, insurance, discounts, seasons, tierCountByCategory };
  }),

  updateCategoryRates: adminProcedure
    .input(
      z.object({
        id: z.string(),
        baseDailyRate: z.number().optional(),
        baseWeeklyRate: z.number().optional(),
        baseMonthlyRate: z.number().optional(),
        bondAmount: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const category = await ctx.prisma.vehicleCategory.update({
        where: { id: input.id },
        data: { ...input, id: undefined },
      });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return category;
    }),

  /** List the PricingTier ladder for a category, model, or vehicle, sorted
   *  by minDays ascending. Empty array means the scope falls back to the
   *  next layer (vehicle → model → category → flat daily/weekly/monthly). */
  listPricingTiers: adminProcedure
    .input(pricingTierListInputSchema)
    .query(async ({ ctx, input }) => {
      const where = tierScopeWhere(input.scope, input.scopeId);
      return ctx.prisma.pricingTier.findMany({
        where,
        orderBy: { minDays: "asc" },
      });
    }),

  /** Replace the entire tier ladder for a scope atomically. The validator
   *  guarantees the submitted ladder is contiguous, starts at day 1, and
   *  has no overlaps, so we just wipe-and-reinsert under a transaction. */
  replacePricingTiers: adminProcedure
    .input(pricingTierReplaceInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.scope === "CATEGORY") {
        await ctx.prisma.vehicleCategory.findUniqueOrThrow({
          where: { id: input.scopeId },
          select: { id: true },
        });
      } else if (input.scope === "MODEL") {
        await ctx.prisma.vehicleModel.findUniqueOrThrow({
          where: { id: input.scopeId },
          select: { id: true },
        });
      } else {
        await ctx.prisma.vehicle.findUniqueOrThrow({
          where: { id: input.scopeId },
          select: { id: true },
        });
      }

      await ctx.prisma.$transaction(async (tx) => {
        const where = tierScopeWhere(input.scope, input.scopeId);
        await tx.pricingTier.deleteMany({ where });
        if (input.tiers.length > 0) {
          await tx.pricingTier.createMany({
            data: input.tiers.map((t) => ({
              categoryId: input.scope === "CATEGORY" ? input.scopeId : null,
              modelId: input.scope === "MODEL" ? input.scopeId : null,
              vehicleId: input.scope === "VEHICLE" ? input.scopeId : null,
              minDays: t.minDays,
              maxDays: t.maxDays,
              tierMode: t.tierMode,
              // PER_WEEK rows leave tierTotal at the 0 default; PROGRESSIVE
              // rows leave pricePerWeek null. The DB CHECK enforces both.
              tierTotal:
                t.tierMode === "PROGRESSIVE"
                  ? new Prisma.Decimal(t.tierTotal)
                  : new Prisma.Decimal(0),
              pricePerWeek:
                t.tierMode === "PER_WEEK" && t.pricePerWeek != null
                  ? new Prisma.Decimal(t.pricePerWeek)
                  : null,
              isActive: t.isActive,
            })),
          });
        }
      });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return { ok: true, count: input.tiers.length };
    }),

  /** Clear the entire tier ladder for a scope so it falls back to the next
   *  layer (vehicle → model → category → flat). */
  deletePricingTiers: adminProcedure
    .input(pricingTierDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const where = tierScopeWhere(input.scope, input.scopeId);
      const result = await ctx.prisma.pricingTier.deleteMany({ where });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return { ok: true, deleted: result.count };
    }),

  // ----- Vehicle model rates (xpertmoto parity) -----
  /** List every catalogue model with its per-model base rate, base period,
   *  and tier-ladder count. Used by the admin Vehicle Models pricing tab. */
  modelRates: adminProcedure.query(async ({ ctx }) => {
    const [models, modelTiers] = await Promise.all([
      ctx.prisma.vehicleModel.findMany({
        orderBy: [{ make: "asc" }, { model: "asc" }, { year: "desc" }],
        include: {
          category: { select: { id: true, name: true } },
          _count: { select: { vehicles: true } },
        },
      }),
      // Tier rows scoped to a model — used for inline ladder previews on
      // the Models tab so operators can see the rate card at a glance.
      ctx.prisma.pricingTier.findMany({
        where: { modelId: { not: null }, isActive: true },
        orderBy: { minDays: "asc" },
      }),
    ]);
    const tiersByModel: Record<string, typeof modelTiers> = {};
    for (const t of modelTiers) {
      if (!t.modelId) continue;
      const list = tiersByModel[t.modelId] ?? [];
      list.push(t);
      tiersByModel[t.modelId] = list;
    }
    const tierCountByModel: Record<string, number> = {};
    for (const [id, list] of Object.entries(tiersByModel)) {
      tierCountByModel[id] = list.length;
    }
    return { models, tierCountByModel, tiersByModel };
  }),

  /** Update the per-model base rate / base period. Mirrors the existing
   *  `updateCategoryRates` pattern. Pass `null` to clear a field so the
   *  vehicle falls back to its category. */
  updateModelRates: adminProcedure
    .input(
      z.object({
        id: z.string(),
        baseRate: z.number().nonnegative().nullable().optional(),
        basePeriodHours: z.enum(["H24", "H48"]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const data: Prisma.VehicleModelUpdateInput = {};
      if (patch.baseRate !== undefined) {
        data.baseRate = patch.baseRate == null ? null : new Prisma.Decimal(patch.baseRate);
      }
      if (patch.basePeriodHours !== undefined) {
        data.basePeriodHours = patch.basePeriodHours;
      }
      const model = await ctx.prisma.vehicleModel.update({
        where: { id },
        data,
      });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return model;
    }),

  /** Update per-vehicle pricing overrides (override per-model defaults).
   *  Pass `null` to clear an override so the vehicle re-inherits from the
   *  model / category. */
  updateVehicleRateOverrides: adminProcedure
    .input(
      z.object({
        id: z.string(),
        baseRateOverride: z.number().nonnegative().nullable().optional(),
        basePeriodHoursOverride: z.enum(["H24", "H48"]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const data: Prisma.VehicleUpdateInput = {};
      if (patch.baseRateOverride !== undefined) {
        data.baseRateOverride =
          patch.baseRateOverride == null ? null : new Prisma.Decimal(patch.baseRateOverride);
      }
      if (patch.basePeriodHoursOverride !== undefined) {
        data.basePeriodHoursOverride = patch.basePeriodHoursOverride;
      }
      const vehicle = await ctx.prisma.vehicle.update({
        where: { id },
        data,
      });
      return vehicle;
    }),

  // ----- Category CRUD -----
  /** Lists every category (active AND archived) with fleet/booking counts
   *  so the admin list can show when archival is blocked. */
  listAllCategories: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const categories = await ctx.prisma.vehicleCategory.findMany({
      orderBy: [{ isActive: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { vehicles: { where: { isActive: true } } } },
      },
    });
    const futureCounts = await ctx.prisma.booking.groupBy({
      by: ["categoryId"],
      where: {
        pickupDateTime: { gt: now },
        status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"] },
      },
      _count: { _all: true },
    });
    const futureByCategory = new Map(futureCounts.map((r) => [r.categoryId, r._count._all]));
    return categories.map((c) => ({
      ...c,
      activeVehicleCount: c._count.vehicles,
      futureBookingCount: futureByCategory.get(c.id) ?? 0,
    }));
  }),

  createCategory: adminProcedure
    .input(categoryFormSchema)
    .mutation(async ({ ctx, input }) => {
      const existingSlug = await ctx.prisma.vehicleCategory.findUnique({ where: { slug: input.slug } });
      if (existingSlug) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Slug "${input.slug}" is already in use — pick a different one.`,
        });
      }
      const category = await ctx.prisma.vehicleCategory.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description?.trim() ? input.description : null,
          engineCapacity: input.engineCapacity,
          licenceRequired: input.licenceRequired,
          minAge: input.minAge,
          displayOrder: input.displayOrder,
          baseDailyRate: input.baseDailyRate,
          baseWeeklyRate: input.baseWeeklyRate,
          baseMonthlyRate: input.baseMonthlyRate,
          bondAmount: input.bondAmount,
          images: input.images,
          onlinePaymentStrategy: input.onlinePaymentStrategy,
          bookingFeeFlat: input.bookingFeeFlat ?? null,
          bookingFeePercent: input.bookingFeePercent ?? null,
          longTermMinDays: input.longTermMinDays ?? null,
          longTermDefaultFrequency: input.longTermDefaultFrequency,
        },
      });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return category;
    }),

  updateCategory: adminProcedure
    .input(categoryUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      if (patch.slug) {
        const conflict = await ctx.prisma.vehicleCategory.findFirst({
          where: { slug: patch.slug, NOT: { id } },
          select: { id: true },
        });
        if (conflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Slug "${patch.slug}" is already in use by another category.`,
          });
        }
      }
      const category = await ctx.prisma.vehicleCategory.update({
        where: { id },
        data: {
          ...patch,
          description:
            patch.description === undefined
              ? undefined
              : patch.description?.trim()
                ? patch.description
                : null,
          // Nullable strategy fields need explicit null passthrough so
          // switching a category from FLAT → FULL wipes the stored fee.
          bookingFeeFlat:
            patch.bookingFeeFlat === undefined ? undefined : (patch.bookingFeeFlat ?? null),
          bookingFeePercent:
            patch.bookingFeePercent === undefined
              ? undefined
              : (patch.bookingFeePercent ?? null),
          longTermMinDays:
            patch.longTermMinDays === undefined ? undefined : (patch.longTermMinDays ?? null),
        },
      });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return category;
    }),

  reorderCategories: adminProcedure
    .input(categoryReorderSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(
        input.orderedIds.map((id, idx) =>
          ctx.prisma.vehicleCategory.update({
            where: { id },
            data: { displayOrder: idx },
          }),
        ),
      );
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return { ok: true };
    }),

  /**
   * Archive a category after either reassigning or disposing every
   * vehicle that still references it. Runs inside a transaction so the
   * category flip and the vehicle actions commit together. Blocks if
   * any vehicle action conflicts with an active/future booking.
   */
  archiveCategory: managerProcedure
    .input(categoryArchiveSchema)
    .mutation(async ({ ctx, input }) => {
      const category = await ctx.prisma.vehicleCategory.findUniqueOrThrow({ where: { id: input.id } });

      const vehicles = await ctx.prisma.vehicle.findMany({
        where: { categoryId: input.id, isActive: true },
        select: { id: true, internalCode: true, status: true },
      });

      // Every active vehicle needs an action. If a caller supplies an
      // action for a vehicle that's already inactive or in another
      // category, we ignore it.
      const actionByVehicle = new Map(input.vehicleActions.map((a) => [a.vehicleId, a]));
      const unhandled = vehicles.filter((v) => !actionByVehicle.has(v.id));
      if (unhandled.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Decide what to do with ${unhandled.length} remaining vehicle(s) before archiving: ${unhandled
            .map((v) => v.internalCode)
            .join(", ")}.`,
        });
      }

      // Pre-flight: any vehicle marked for disposal that still holds
      // CHECKED_OUT/ACTIVE/OVERDUE bookings needs to be flagged clearly.
      // Future CONFIRMED bookings are OK — they get auto-reassigned.
      const disposalIds = input.vehicleActions
        .filter((a): a is Extract<typeof a, { action: "DISPOSE" }> => a.action === "DISPOSE")
        .map((a) => a.vehicleId);
      if (disposalIds.length > 0) {
        const activeRentals = await ctx.prisma.booking.findMany({
          where: {
            vehicleId: { in: disposalIds },
            status: { in: ["ACTIVE", "CHECKED_OUT", "OVERDUE"] },
          },
          select: { bookingReference: true, vehicle: { select: { internalCode: true } } },
        });
        if (activeRentals.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Cannot dispose vehicles that are currently rented: ${activeRentals
              .map((b) => `${b.vehicle?.internalCode ?? "?"} (${b.bookingReference})`)
              .join(", ")}. Complete the check-in first, then retry.`,
          });
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        for (const action of input.vehicleActions) {
          if (action.action === "REASSIGN") {
            await tx.vehicleCategory.findUniqueOrThrow({ where: { id: action.targetCategoryId } });
            await tx.vehicle.update({
              where: { id: action.vehicleId },
              data: { categoryId: action.targetCategoryId },
            });
            continue;
          }
          // DISPOSE: mirror the `decommission` procedure's behaviour.
          const previous = await tx.vehicle.findUniqueOrThrow({
            where: { id: action.vehicleId },
            select: { status: true, internalCode: true },
          });
          await tx.vehicle.update({
            where: { id: action.vehicleId },
            data: {
              status: action.targetStatus,
              isActive: false,
              deletedAt: new Date(),
              notes: action.salePrice
                ? `Archived with category ${category.name}: ${action.targetStatus}, sale price A$${action.salePrice}`
                : `Archived with category ${category.name}: ${action.targetStatus}`,
              statusLog: {
                create: {
                  previousStatus: previous.status,
                  newStatus: action.targetStatus,
                  changedById: ctx.user.id,
                  reason: action.reason,
                },
              },
            },
          });
          await reassignFutureBookings(
            tx,
            action.vehicleId,
            ctx.user.id,
            `Vehicle ${previous.internalCode} → ${action.targetStatus} (category archived)`,
          );
        }

        const archived = await tx.vehicleCategory.update({
          where: { id: input.id },
          data: { isActive: false },
        });
        await invalidateTag(CACHE_TAGS.CATEGORIES);
        return { category: archived, actioned: input.vehicleActions.length };
      });
    }),

  restoreCategory: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const category = await ctx.prisma.vehicleCategory.update({
        where: { id: input.id },
        data: { isActive: true },
      });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return category;
    }),

  /** Active vehicles currently assigned to a category — used by the
   *  archive wizard to list what needs reassigning or disposing. */
  categoryActiveVehicles: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.vehicle.findMany({
        where: { categoryId: input.id, isActive: true },
        select: { id: true, internalCode: true, make: true, model: true, rego: true },
        orderBy: { internalCode: "asc" },
      });
    }),

  upsertAddon: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        type: z.enum(["HELMET", "LOCK", "PHONE_MOUNT", "GPS", "PANNIERS", "RAIN_GEAR", "EXTRA_INSURANCE", "ROADSIDE_ASSIST", "DELIVERY", "PICKUP"]),
        dailyRate: z.number().optional(),
        flatRate: z.number().optional(),
        isPerDay: z.boolean().default(true),
        isRequired: z.boolean().default(false),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const addon = id
        ? await ctx.prisma.addon.update({ where: { id }, data })
        : await ctx.prisma.addon.create({ data });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return addon;
    }),

  upsertInsurance: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        dailyRate: z.number(),
        excessAmount: z.number(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const option = id
        ? await ctx.prisma.insuranceOption.update({ where: { id }, data })
        : await ctx.prisma.insuranceOption.create({ data });
      await invalidateTag(CACHE_TAGS.CATEGORIES);
      return option;
    }),

  upsertDiscount: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        code: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(["PERCENTAGE", "FIXED", "FREE_ADDON", "FREE_DAY"]),
        value: z.number(),
        maxUses: z.number().int().optional(),
        validFrom: z.coerce.date().optional(),
        validTo: z.coerce.date().optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return id
        ? ctx.prisma.discount.update({ where: { id }, data })
        : ctx.prisma.discount.create({ data });
    }),

  upsertSeason: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        multiplier: z.number(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return id
        ? ctx.prisma.season.update({ where: { id }, data })
        : ctx.prisma.season.create({ data });
    }),

  // ----- Finance (rebuilt) -----
  //
  // Overview summary on the SAME payment-weighted, settled-cash basis as the
  // Transactions / GST / Invoices tabs, so the headline figures reconcile across
  // the whole Finance section. Two date bases on purpose:
  //   - cash.*  — payments that MOVED in range, keyed on processedAt (what the
  //     business actually banked). Refunds subtract, bond authorisations count 0.
  //   - booking.* — gross pipeline by booking createdAt (commercial value booked).
  // Outstanding/aging are intentionally all-time AR (a balance owed isn't scoped
  // to the report window).
  financeSummary: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const bookingWhere = {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      };
      // Settled-cash statuses: a PARTIALLY_REFUNDED / REFUNDED original still
      // represents money that settled (the refund is its own REFUND row,
      // weighted -1). PENDING / FAILED never moved money.
      const cashPaymentWhere: Prisma.PaymentWhereInput = {
        status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
        processedAt: { gte: input.from, lte: input.to },
        deletedAt: null,
        ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
      };
      const invoiceWhere = {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
      };

      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 86400000);
      const d60 = new Date(now.getTime() - 60 * 86400000);
      const d90 = new Date(now.getTime() - 90 * 86400000);
      const depotClause = input.depotId
        ? Prisma.sql`AND "depotId" = ${input.depotId}`
        : Prisma.empty;

      const [gst, cashGroups, bookingAgg, byStatus, outstanding, agingRows, bondAgg, invoices] =
        await Promise.all([
          // Authoritative net cash + GST (shared with the GST/BAS tab + export).
          computeGstSummary({ from: input.from, to: input.to, depotId: input.depotId }),
          ctx.prisma.payment.groupBy({
            by: ["type"],
            where: cashPaymentWhere,
            _sum: { amount: true },
          }),
          ctx.prisma.booking.aggregate({
            where: { ...bookingWhere, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
            _sum: { totalAmount: true, addonTotal: true, insuranceTotal: true },
            _count: true,
            _avg: { totalAmount: true },
          }),
          ctx.prisma.booking.groupBy({ by: ["status"], where: bookingWhere, _count: true, _sum: { totalAmount: true } }),
          ctx.prisma.booking.aggregate({
            where: {
              balanceDue: { gt: 0 },
              status: { notIn: ["CANCELLED"] },
              ...(input.depotId ? { depotId: input.depotId } : {}),
            },
            _sum: { balanceDue: true },
            _count: true,
          }),
          ctx.prisma.$queryRaw<
            Array<{ under30: string; under60: string; under90: string; over90: string }>
          >(Prisma.sql`
            SELECT
              COALESCE(SUM("balanceDue") FILTER (WHERE "pickupDateTime" >= ${d30}), 0)::text AS under30,
              COALESCE(SUM("balanceDue") FILTER (WHERE "pickupDateTime" >= ${d60} AND "pickupDateTime" < ${d30}), 0)::text AS under60,
              COALESCE(SUM("balanceDue") FILTER (WHERE "pickupDateTime" >= ${d90} AND "pickupDateTime" < ${d60}), 0)::text AS under90,
              COALESCE(SUM("balanceDue") FILTER (WHERE "pickupDateTime" < ${d90}), 0)::text AS over90
            FROM "Booking"
            WHERE "balanceDue" > 0
              AND status NOT IN ('CANCELLED')
              ${depotClause}
          `),
          ctx.prisma.bondLedger.aggregate({
            where: {
              createdAt: { gte: input.from, lte: input.to },
              ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
            },
            _sum: { heldAmount: true, capturedAmount: true, releasedAmount: true },
          }),
          ctx.prisma.invoice.findMany({
            where: invoiceWhere,
            select: {
              bookingId: true,
              totalAmount: true,
              booking: { select: { status: true, balanceDue: true } },
              adjustmentNotes: {
                where: { status: { not: "VOID" }, deletedAt: null },
                select: { type: true, totalAmount: true },
              },
            },
          }),
        ]);

      // Cash flow + payment mix — weighted by paymentNetWeight (+1 in, -1 out,
      // 0 for non-cash bond holds/releases, which are dropped from the mix).
      const byType: Record<string, number> = {};
      let inflows = 0;
      let outflows = 0;
      let refunds = 0;
      let damage = 0;
      for (const g of cashGroups) {
        const amount = Number(g._sum?.amount ?? 0);
        if (g.type === "REFUND") refunds += amount;
        if (g.type === "DAMAGE_CHARGE") damage += amount;
        const w = paymentNetWeight(g.type);
        if (w === 0) continue;
        byType[g.type] = roundCents(w * amount).toNumber();
        if (w === 1) inflows += amount;
        else outflows += amount;
      }

      // Invoices outstanding — reconcile each in-window invoice against its
      // adjustment notes + net cash, exactly like the Invoices tab, then sum the
      // still-collectible balances so the tile ties out to that view.
      const invBookingIds = [
        ...new Set(invoices.map((i) => i.bookingId).filter((id): id is string => !!id)),
      ];
      const invPaymentGroups = invBookingIds.length
        ? await ctx.prisma.payment.groupBy({
            by: ["bookingId", "type"],
            where: {
              bookingId: { in: invBookingIds },
              status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
            },
            _sum: { amount: true },
          })
        : [];
      const invNetByBooking = netCashByBooking(
        invPaymentGroups.map((g) => ({
          bookingId: g.bookingId,
          type: g.type,
          amount: Number(g._sum.amount ?? 0),
        })),
      );
      let invoicesOutstandingAmount = 0;
      let invoicesOutstandingCount = 0;
      for (const inv of invoices) {
        const recon = reconcileInvoice(
          {
            bookingId: inv.bookingId,
            bookingStatus: inv.booking?.status ?? null,
            balanceDue: inv.booking ? Number(inv.booking.balanceDue) : null,
            totalAmount: Number(inv.totalAmount),
            adjustments: inv.adjustmentNotes.map((a) => ({ type: a.type, totalAmount: Number(a.totalAmount) })),
          },
          invNetByBooking,
        );
        if (recon.outstanding > 0.005) {
          invoicesOutstandingAmount += recon.outstanding;
          invoicesOutstandingCount += 1;
        }
      }

      const agingRow = agingRows[0] ?? { under30: "0", under60: "0", under90: "0", over90: "0" };

      return {
        cash: {
          revenueInc: gst.totalRevenueInc,
          revenueEx: gst.totalRevenueEx,
          gstCollected: gst.gstCollected,
          gstOnRefunds: gst.gstOnRefunds,
          netGst: gst.netGst,
          inflows: roundCents(inflows).toNumber(),
          outflows: roundCents(outflows).toNumber(),
          net: roundCents(inflows - outflows).toNumber(),
          byType,
        },
        booking: {
          grossBooked: Number(bookingAgg._sum.totalAmount ?? 0),
          bookingCount: bookingAgg._count,
          avgBookingValue: Number(bookingAgg._avg.totalAmount ?? 0),
          byStatus: byStatus.map((s) => ({
            status: s.status,
            count: s._count,
            revenue: Number(s._sum.totalAmount ?? 0),
          })),
        },
        outstanding: {
          balance: Number(outstanding._sum.balanceDue ?? 0),
          count: outstanding._count,
          aging: {
            under30: Number(agingRow.under30),
            under60: Number(agingRow.under60),
            under90: Number(agingRow.under90),
            over90: Number(agingRow.over90),
          },
        },
        invoicesOutstanding: {
          amount: roundCents(invoicesOutstandingAmount).toNumber(),
          count: invoicesOutstandingCount,
        },
        bonds: {
          held: Number(bondAgg._sum.heldAmount ?? 0),
          captured: Number(bondAgg._sum.capturedAmount ?? 0),
          released: Number(bondAgg._sum.releasedAmount ?? 0),
        },
        totals: {
          addons: Number(bookingAgg._sum.addonTotal ?? 0),
          insurance: Number(bookingAgg._sum.insuranceTotal ?? 0),
          refunds: roundCents(refunds).toNumber(),
          damage: roundCents(damage).toNumber(),
        },
      };
    }),

  // Year-over-year monthly net cash revenue: current year + the previous 3, as
  // separate series for a comparison line chart. Own 4-year window (independent
  // of the From/To filter); same payment-weighted settled-cash basis as
  // computeGstSummary. Current-year months beyond "now" are null so the line
  // ends at the present month rather than dropping to zero.
  financeRevenueTrend: adminProcedure
    .input(z.object({ depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1; // 1..12
      const startYear = currentYear - 3;
      const years = Array.from({ length: 4 }, (_, i) => startYear + i);
      const start = new Date(Date.UTC(startYear, 0, 1));
      const end = new Date(Date.UTC(currentYear + 1, 0, 1));

      const rows = await ctx.prisma.$queryRaw<
        Array<{ yr: number; mo: number; type: string; total: string }>
      >(Prisma.sql`
        SELECT
          EXTRACT(YEAR FROM p."processedAt")::int AS yr,
          EXTRACT(MONTH FROM p."processedAt")::int AS mo,
          p."type"::text AS type,
          COALESCE(SUM(p."amount"), 0)::text AS total
        FROM "Payment" p
        ${input.depotId ? Prisma.sql`JOIN "Booking" b ON b."id" = p."bookingId"` : Prisma.empty}
        WHERE p."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
          AND p."deletedAt" IS NULL
          AND p."processedAt" >= ${start}
          AND p."processedAt" < ${end}
          ${input.depotId ? Prisma.sql`AND b."depotId" = ${input.depotId}` : Prisma.empty}
        GROUP BY yr, mo, p."type"
      `);

      const months: Array<Record<string, number | null>> = Array.from({ length: 12 }, (_, i) => {
        const monthNo = i + 1;
        const row: Record<string, number | null> = { month: monthNo };
        for (const y of years) {
          row[String(y)] = y === currentYear && monthNo > currentMonth ? null : 0;
        }
        return row;
      });
      for (const r of rows) {
        const w = paymentNetWeight(r.type as PaymentType);
        if (w === 0) continue;
        const row = months[r.mo - 1];
        const key = String(r.yr);
        if (!row || !(key in row)) continue;
        row[key] = roundCents(Number(row[key] ?? 0) + w * Number(r.total)).toNumber();
      }
      return { years, months };
    }),

  financeTransactions: adminProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        take: z.number().int().min(1).max(500).default(200),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.type ? { type: input.type as never } : {}),
        ...(input.status ? { status: input.status as never } : {}),
        ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
      };
      const rows = await ctx.prisma.payment.findMany({
        where,
        include: {
          booking: { select: { bookingReference: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = rows.length > input.take ? rows.pop()!.id : null;
      // Net totals: amounts are stored positive regardless of direction, so a
      // plain SUM would count refunds as income. Group by type and weight each
      // by paymentNetWeight (+1 in, -1 out, 0 for non-cash bond holds/releases)
      // so the summary is a true cash net over the whole filtered set (not just
      // the current page). count still tallies every row, including bonds.
      const byType = await ctx.prisma.payment.groupBy({
        by: ["type"],
        where,
        _sum: { amount: true, gstAmount: true },
        _count: { _all: true },
      });
      let amountTotal = 0;
      let gstTotal = 0;
      let count = 0;
      for (const g of byType) {
        const weight = paymentNetWeight(g.type);
        amountTotal += weight * Number(g._sum.amount ?? 0);
        gstTotal += weight * Number(g._sum.gstAmount ?? 0);
        count += g._count._all;
      }
      return {
        rows: rows.map((p) => ({
          id: p.id,
          reference: p.reference,
          createdAt: p.createdAt,
          type: p.type,
          method: p.method,
          status: p.status,
          amount: signedPaymentAmount(p.type, Number(p.amount)),
          gst: signedPaymentAmount(p.type, Number(p.gstAmount)),
          bookingReference: p.booking?.bookingReference ?? null,
          customer: p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : null,
        })),
        nextCursor,
        totals: {
          amount: roundCents(amountTotal).toNumber(),
          gst: roundCents(gstTotal).toNumber(),
          count,
        },
      };
    }),

  // Recurring (long-term-hire) billing dashboard. Unlike the other finance
  // tabs this is a "state of the book" view — forward billing forecast,
  // portfolio health, frequency mix and a trailing collected-revenue trend —
  // so it takes no date window, only the depot filter. Data comes from
  // BookingBillingPlan (the recurring schedules) + SUBSCRIPTION_CHARGE payments
  // (what's actually been collected).
  financeRecurring: adminProcedure
    .input(z.object({ depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const HORIZON_DAYS = 14;
      const TREND_MONTHS = 6;
      const depotFilter = input.depotId ? { booking: { depotId: input.depotId } } : {};
      const periodDays = (f: string) => (f === "WEEKLY" ? 7 : f === "FORTNIGHTLY" ? 14 : 30);
      const dayKey = (d: Date) => d.toISOString().slice(0, 10);

      const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (TREND_MONTHS - 1), 1));

      const [statusGroups, freqGroups, activePlans, payGroups, trendRows] = await Promise.all([
        ctx.prisma.bookingBillingPlan.groupBy({
          by: ["status"],
          where: { ...depotFilter },
          _count: { _all: true },
        }),
        ctx.prisma.bookingBillingPlan.groupBy({
          by: ["frequency"],
          where: { status: "ACTIVE", ...depotFilter },
          _count: { _all: true },
          _sum: { amountPerPeriod: true },
        }),
        ctx.prisma.bookingBillingPlan.findMany({
          where: { status: "ACTIVE", ...depotFilter },
          orderBy: { nextChargeAt: "asc" },
          take: 500,
          include: {
            booking: {
              select: {
                bookingReference: true,
                customer: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        }),
        ctx.prisma.payment.groupBy({
          by: ["status"],
          where: { type: "SUBSCRIPTION_CHARGE", ...depotFilter },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        ctx.prisma.payment.findMany({
          where: {
            type: "SUBSCRIPTION_CHARGE",
            status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] },
            processedAt: { gte: trendStart },
            ...depotFilter,
          },
          select: { amount: true, processedAt: true },
        }),
      ]);

      // Plans by status (donut) + headline counts.
      const statusCounts: Record<string, number> = { ACTIVE: 0, PAUSED: 0, COMPLETED: 0, CANCELLED: 0 };
      for (const g of statusGroups) statusCounts[g.status] = g._count._all;

      // Cadence mix across ACTIVE plans.
      const frequencyMix = freqGroups.map((g) => ({
        frequency: g.frequency,
        count: g._count._all,
        perPeriod: roundCents(Number(g._sum.amountPerPeriod ?? 0)).toNumber(),
      }));

      // Forward billing forecast: project each ACTIVE plan's remaining charge
      // dates from nextChargeAt and bucket them into the next 14 days. Also tally
      // committed (contracted but not-yet-collected) revenue across all ACTIVE
      // plans = remaining periods × amount per period.
      const buckets = new Map<string, { amount: number; count: number }>();
      const base = new Date(now);
      base.setUTCHours(0, 0, 0, 0);
      for (let i = 0; i < HORIZON_DAYS; i++) {
        buckets.set(dayKey(new Date(base.getTime() + i * 86_400_000)), { amount: 0, count: 0 });
      }
      const lastKey = dayKey(new Date(base.getTime() + (HORIZON_DAYS - 1) * 86_400_000));
      let committedRevenue = 0;
      for (const p of activePlans) {
        const remaining = Math.max(0, p.periodsTotal - p.periodsCompleted);
        const amount = Number(p.amountPerPeriod);
        committedRevenue += remaining * amount;
        const stepMs = periodDays(p.frequency) * 86_400_000;
        let t = p.nextChargeAt.getTime();
        for (let k = 0; k < remaining; k++) {
          const key = dayKey(new Date(t));
          if (key > lastKey) break;
          const b = buckets.get(key);
          if (b) {
            b.amount += amount;
            b.count += 1;
          }
          t += stepMs;
        }
      }
      const forecast = [...buckets.entries()].map(([date, v]) => ({
        date,
        amount: roundCents(v.amount).toNumber(),
        count: v.count,
      }));
      const forecastTotal = roundCents(forecast.reduce((a, f) => a + f.amount, 0)).toNumber();
      const forecastCount = forecast.reduce((a, f) => a + f.count, 0);

      // Capture health + all-time collected, from the SUBSCRIPTION_CHARGE ledger.
      let collectedAllTime = 0;
      let succeeded = 0;
      let failed = 0;
      let pending = 0;
      for (const g of payGroups) {
        if (g.status === "SUCCEEDED" || g.status === "PARTIALLY_REFUNDED") {
          collectedAllTime += Number(g._sum.amount ?? 0);
          succeeded += g._count._all;
        } else if (g.status === "FAILED") {
          failed += g._count._all;
        } else if (g.status === "PENDING") {
          pending += g._count._all;
        }
      }
      const settled = succeeded + failed;
      const captureRate = settled > 0 ? succeeded / settled : 1;

      // Trailing collected-revenue trend (cash basis on processedAt) + last-30-day total.
      const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const trend = Array.from({ length: TREND_MONTHS }, (_, i) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (TREND_MONTHS - 1) + i, 1));
        return { key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: MONTH_LABELS[d.getUTCMonth()]!, amount: 0 };
      });
      const trendIdx = new Map(trend.map((t, i) => [t.key, i]));
      const cutoff30 = now.getTime() - 30 * 86_400_000;
      let collected30d = 0;
      for (const r of trendRows) {
        if (!r.processedAt) continue;
        const key = `${r.processedAt.getUTCFullYear()}-${r.processedAt.getUTCMonth()}`;
        const i = trendIdx.get(key);
        if (i !== undefined) trend[i]!.amount = roundCents(trend[i]!.amount + Number(r.amount)).toNumber();
        if (r.processedAt.getTime() >= cutoff30) collected30d += Number(r.amount);
      }

      return {
        kpis: {
          activePlans: statusCounts.ACTIVE ?? 0,
          pausedPlans: statusCounts.PAUSED ?? 0,
          committedRevenue: roundCents(committedRevenue).toNumber(),
          collected30d: roundCents(collected30d).toNumber(),
          collectedAllTime: roundCents(collectedAllTime).toNumber(),
          captureRate,
          captureSucceeded: succeeded,
          captureFailed: failed,
          capturePending: pending,
        },
        statusCounts,
        frequencyMix,
        forecast,
        forecastTotal,
        forecastCount,
        trend: trend.map((t) => ({ label: t.label, amount: t.amount })),
        plans: activePlans.slice(0, 100).map((p) => ({
          id: p.id,
          bookingId: p.bookingId,
          bookingReference: p.booking?.bookingReference ?? null,
          customerId: p.booking?.customer?.id ?? null,
          customer: p.booking?.customer
            ? `${p.booking.customer.firstName} ${p.booking.customer.lastName}`
            : null,
          frequency: p.frequency,
          amountPerPeriod: roundCents(Number(p.amountPerPeriod)).toNumber(),
          periodsCompleted: p.periodsCompleted,
          periodsTotal: p.periodsTotal,
          nextChargeAt: p.nextChargeAt,
          status: p.status,
        })),
      };
    }),

  financeInvoices: adminProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
        status: z.string().optional(),
        take: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.status ? { status: input.status as never } : {}),
        ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
      };
      const invoices = await ctx.prisma.invoice.findMany({
        where,
        include: {
          booking: {
            select: {
              bookingReference: true,
              status: true,
              balanceDue: true,
              customer: { select: { firstName: true, lastName: true } },
            },
          },
          creditNotes: { select: { amount: true } },
          adjustmentNotes: {
            where: { status: { not: "VOID" }, deletedAt: null },
            select: { type: true, totalAmount: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: input.take,
      });
      const totalAgg = await ctx.prisma.invoice.aggregate({
        where,
        _sum: { totalAmount: true, gstAmount: true, subtotal: true },
        _count: true,
      });
      // Reconciliation: join each invoice to net cash (Payment ledger,
      // weighted so refunds subtract and bond auths are zero — same basis as
      // the Transactions tab) and to its adjustment-note delta. Payments are
      // fetched all-time for the invoices' bookings, NOT date-filtered: a
      // refund issued today can settle an invoice from a prior period.
      const bookingIds = [
        ...new Set(invoices.map((i) => i.bookingId).filter((id): id is string => !!id)),
      ];
      const paymentGroups = bookingIds.length
        ? await ctx.prisma.payment.groupBy({
            by: ["bookingId", "type"],
            // Settled-cash statuses only: a PARTIALLY_REFUNDED / REFUNDED
            // original still represents cash that was collected (the refund is
            // its own REFUND row, weighted -1). PENDING / FAILED never moved
            // money, so they're excluded.
            where: {
              bookingId: { in: bookingIds },
              status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
            },
            _sum: { amount: true },
          })
        : [];
      const netByBooking = netCashByBooking(
        paymentGroups.map((g) => ({
          bookingId: g.bookingId,
          type: g.type,
          amount: Number(g._sum.amount ?? 0),
        })),
      );
      const rows = invoices.map((i) => {
        const recon = reconcileInvoice(
          {
            bookingId: i.bookingId,
            bookingStatus: i.booking?.status ?? null,
            balanceDue: i.booking ? Number(i.booking.balanceDue) : null,
            totalAmount: Number(i.totalAmount),
            adjustments: i.adjustmentNotes.map((a) => ({
              type: a.type,
              totalAmount: Number(a.totalAmount),
            })),
          },
          netByBooking,
        );
        return {
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          bookingReference: i.booking?.bookingReference ?? null,
          bookingStatus: i.booking?.status ?? null,
          customer: i.booking?.customer
            ? `${i.booking.customer.firstName} ${i.booking.customer.lastName}`
            : null,
          subtotal: Number(i.subtotal),
          gstAmount: Number(i.gstAmount),
          totalAmount: Number(i.totalAmount),
          creditNoteTotal: i.creditNotes.reduce((a, c) => a + Number(c.amount), 0),
          adjustmentTotal: recon.adjustmentTotal,
          netTotal: recon.netTotal,
          collected: recon.collected,
          outstanding: recon.outstanding,
          dueDate: i.dueDate,
          sentAt: i.sentAt,
          paidAt: i.paidAt,
          createdAt: i.createdAt,
        };
      });
      return {
        rows,
        totals: {
          subtotal: Number(totalAgg._sum.subtotal ?? 0),
          gst: Number(totalAgg._sum.gstAmount ?? 0),
          total: Number(totalAgg._sum.totalAmount ?? 0),
          // Reconciliation totals sum the per-row computed values so the
          // summary always ties out to the rows shown (not a separate aggregate).
          net: roundCents(rows.reduce((a, r) => a + r.netTotal, 0)).toNumber(),
          collected: roundCents(rows.reduce((a, r) => a + r.collected, 0)).toNumber(),
          outstanding: roundCents(rows.reduce((a, r) => a + r.outstanding, 0)).toNumber(),
          count: totalAgg._count,
        },
      };
    }),

  // Phase F — issue a credit note against an existing invoice. Credit
  // notes offset the invoice total and optionally flip the invoice to
  // CREDITED when fully covered. Does NOT refund the customer — that's a
  // separate Stripe refund via bookingSettlement.refund.
  issueCreditNote: adminProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        amount: z.number().positive("Amount must be positive"),
        reason: z.string().min(1, "Reason is required"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.prisma.invoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
        include: { creditNotes: { select: { amount: true } } },
      });
      const alreadyCredited = invoice.creditNotes.reduce(
        (sum, c) => sum + Number(c.amount),
        0,
      );
      const remaining = Number(invoice.totalAmount) - alreadyCredited;
      if (input.amount > remaining + 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only A$${remaining.toFixed(2)} remains to credit on this invoice.`,
        });
      }
      const fullyCredited =
        Math.abs(alreadyCredited + input.amount - Number(invoice.totalAmount)) < 0.01;
      const note = await ctx.prisma.$transaction(async (tx) => {
        const credit = await tx.creditNote.create({
          data: {
            invoiceId: invoice.id,
            amount: input.amount,
            reason: input.reason,
            issuedById: ctx.user.id,
          },
        });
        if (fullyCredited) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: "CREDITED" },
          });
        }
        return credit;
      });

      // Mirror the credit note as an ATO §29-75 adjustment note so it
      // appears in the booking documents list and the customer's tax
      // documents page. The CreditNote row remains the legacy ledger
      // entry; the AdjustmentNote is the customer-facing PDF.
      try {
        const { issueAdjustmentNote } = await import(
          "@/server/services/invoice-lifecycle"
        );
        await issueAdjustmentNote({
          invoiceId: invoice.id,
          type: "DECREASE",
          reason: "MANUAL",
          description: `Credit note — ${input.reason}`,
          lineItems: [
            {
              description: "Manual credit",
              detail: input.reason,
              quantity: 1,
              unitPrice: input.amount,
              totalPrice: input.amount,
              gstIncluded: true,
              negative: true,
            },
          ],
          issuedById: ctx.user.id,
        });
      } catch {
        // Non-blocking: the legacy CreditNote is already persisted.
      }

      return note;
    }),

  // Phase F — void an invoice. Used when an invoice was issued in error
  // (e.g., duplicate generation, wrong customer). Flips status to VOID
  // and creates a full-amount credit note for the audit trail.
  voidInvoice: adminProcedure
    .input(z.object({ invoiceId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.prisma.invoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
        include: { creditNotes: { select: { amount: true } } },
      });
      if (invoice.status === "VOID" || invoice.status === "CREDITED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invoice is already ${invoice.status}.`,
        });
      }
      const alreadyCredited = invoice.creditNotes.reduce(
        (sum, c) => sum + Number(c.amount),
        0,
      );
      const remaining = Number(invoice.totalAmount) - alreadyCredited;
      const voided = await ctx.prisma.$transaction(async (tx) => {
        if (remaining > 0) {
          await tx.creditNote.create({
            data: {
              invoiceId: invoice.id,
              amount: remaining,
              reason: `VOID: ${input.reason}`,
              issuedById: ctx.user.id,
            },
          });
        }
        return tx.invoice.update({
          where: { id: invoice.id },
          data: { status: "VOID" },
        });
      });

      // Mirror the void as a full-amount DECREASE adjustment note so the
      // customer / staff documents page reflects it. We don't reuse the
      // lifecycle's `voidInvoice` helper here because the legacy
      // CreditNote is already written above; we just need the document.
      if (remaining > 0) {
        try {
          const { issueAdjustmentNote } = await import(
            "@/server/services/invoice-lifecycle"
          );
          await issueAdjustmentNote({
            invoiceId: invoice.id,
            type: "DECREASE",
            reason: "MANUAL",
            description: `Invoice voided: ${input.reason}`,
            lineItems: [
              {
                description: `Void of tax invoice ${invoice.invoiceNumber}`,
                quantity: 1,
                unitPrice: remaining,
                totalPrice: remaining,
                gstIncluded: true,
                negative: true,
              },
            ],
            issuedById: ctx.user.id,
          });
        } catch {
          // Non-blocking.
        }
      }

      return voided;
    }),

  financeBonds: adminProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
        status: z.string().optional(),
        take: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.status ? { status: input.status as never } : {}),
        ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
      };
      const bonds = await ctx.prisma.bondLedger.findMany({
        where,
        include: {
          booking: {
            select: {
              bookingReference: true,
              customer: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: input.take,
      });
      const held = await ctx.prisma.bondLedger.aggregate({
        where,
        _sum: { heldAmount: true, capturedAmount: true, releasedAmount: true },
        _count: true,
      });
      return {
        rows: bonds.map((b) => ({
          id: b.id,
          bookingReference: b.booking?.bookingReference ?? null,
          customer: b.booking?.customer
            ? `${b.booking.customer.firstName} ${b.booking.customer.lastName}`
            : null,
          status: b.status,
          heldAmount: Number(b.heldAmount),
          capturedAmount: Number(b.capturedAmount),
          releasedAmount: Number(b.releasedAmount),
          createdAt: b.createdAt,
        })),
        totals: {
          held: Number(held._sum.heldAmount ?? 0),
          captured: Number(held._sum.capturedAmount ?? 0),
          released: Number(held._sum.releasedAmount ?? 0),
          count: held._count,
        },
      };
    }),

  // GST/BAS figures on a payment-ledger cash basis — see computeGstSummary in
  // gst-bas-export.ts (shared with the finance.gst export and generateBasCsv).
  financeGst: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ input }) =>
      computeGstSummary({ from: input.from, to: input.to, depotId: input.depotId }),
    ),

  // Transaction-level reconciliation: matches each cash-settling Payment to its
  // Stripe charge (via finance-reconciliation service). In dev we refresh the
  // Stripe mirror live so just-created test data shows; in prod we read the
  // mirror maintained by the nightly stripe-reconcile job (+ Refresh button).
  financeReconciliation: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ input }) => {
      return reconcilePayments({
        from: input.from,
        to: input.to,
        depotId: input.depotId,
        live: process.env.NODE_ENV !== "production",
      });
    }),

  // Operator-triggered Stripe reconcile (the prod "Refresh from Stripe" button).
  refreshStripeReconcile: adminProcedure.mutation(async ({ ctx }) => {
    const result = await runStripeReconcile();
    await writeAudit(ctx.prisma, {
      userId: ctx.session.user.id,
      category: "JOB",
      action: "stripe.reconcile.manual",
      entity: "StripeFeeLedger",
      entityId: "manual",
      newData: { ...result },
    });
    return result;
  }),

  // ----- Reports -----
  bookingsByPeriod: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), period: z.enum(["day", "week", "month"]).default("day") }))
    .query(async ({ ctx, input }) => {
      const bookings = await ctx.prisma.booking.findMany({
        where: { createdAt: { gte: input.from, lte: input.to } },
        select: { createdAt: true, totalAmount: true, status: true, source: true },
      });
      const buckets = new Map<string, { revenue: number; count: number }>();
      for (const b of bookings) {
        let key: string;
        if (input.period === "day") key = b.createdAt.toISOString().slice(0, 10);
        else if (input.period === "week") {
          const d = new Date(b.createdAt);
          const day = d.getDay();
          d.setDate(d.getDate() - day);
          key = d.toISOString().slice(0, 10);
        } else key = b.createdAt.toISOString().slice(0, 7);
        const e = buckets.get(key) ?? { revenue: 0, count: 0 };
        e.revenue += Number(b.totalAmount);
        e.count += 1;
        buckets.set(key, e);
      }
      return Array.from(buckets.entries()).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => a.key.localeCompare(b.key));
    }),

  fleetUtilisation: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: { isActive: true },
        include: {
          category: true,
          depot: true,
          bookings: {
            where: {
              status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "COMPLETED"] },
              pickupDateTime: { lt: input.to },
              returnDateTime: { gt: input.from },
            },
            select: { pickupDateTime: true, returnDateTime: true, totalAmount: true },
          },
        },
      });
      const periodMs = input.to.getTime() - input.from.getTime();
      return vehicles.map((v) => {
        const rentedMs = v.bookings.reduce((sum, b) => {
          const start = Math.max(b.pickupDateTime.getTime(), input.from.getTime());
          const end = Math.min(b.returnDateTime.getTime(), input.to.getTime());
          return sum + Math.max(0, end - start);
        }, 0);
        return {
          id: v.id,
          code: v.internalCode,
          category: v.category.name,
          depot: v.depot.name,
          utilisation: Math.round((rentedMs / periodMs) * 100),
          revenue: v.bookings.reduce((s, b) => s + Number(b.totalAmount), 0),
          bookingCount: v.bookings.length,
        };
      });
    }),

  topCustomers: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        bookings: {
          where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { totalAmount: true },
        },
      },
      take: 500,
    });
    return rows
      .map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        email: r.email,
        spend: r.bookings.reduce((s, b) => s + Number(b.totalAmount), 0),
        bookings: r.bookings.length,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 50);
  }),

  reportBookingsBySource: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const bookings = await ctx.prisma.booking.groupBy({
        by: ["source"],
        where: {
          createdAt: { gte: input.from, lte: input.to },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        _count: true,
        _sum: { totalAmount: true },
      });
      const total = bookings.reduce((a, b) => a + b._count, 0);
      return bookings.map((b) => ({
        source: b.source,
        count: b._count,
        revenue: Number(b._sum.totalAmount ?? 0),
        share: total > 0 ? b._count / total : 0,
      }));
    }),

  reportBookingsCancellations: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const cancellations = await ctx.prisma.booking.findMany({
        where: {
          status: { in: ["CANCELLED", "NO_SHOW"] },
          updatedAt: { gte: input.from, lte: input.to },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        select: {
          id: true,
          bookingReference: true,
          cancellationReason: true,
          totalAmount: true,
          createdAt: true,
          pickupDateTime: true,
          status: true,
        },
      });
      const byReason = new Map<string, { count: number; lostRevenue: number; totalLeadMs: number }>();
      for (const b of cancellations) {
        const key = b.cancellationReason ?? (b.status === "NO_SHOW" ? "No-show" : "Unspecified");
        const e = byReason.get(key) ?? { count: 0, lostRevenue: 0, totalLeadMs: 0 };
        e.count += 1;
        e.lostRevenue += Number(b.totalAmount);
        e.totalLeadMs += Math.max(0, b.pickupDateTime.getTime() - b.createdAt.getTime());
        byReason.set(key, e);
      }
      return [...byReason.entries()]
        .map(([reason, v]) => ({
          reason,
          count: v.count,
          lostRevenue: v.lostRevenue,
          avgLeadDays: v.count > 0 ? v.totalLeadMs / v.count / 86400000 : 0,
        }))
        .sort((a, b) => b.count - a.count);
    }),

  reportFleetRevenuePerVehicle: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: {
          isActive: true,
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        include: {
          category: { select: { name: true } },
          depot: { select: { name: true } },
          bookings: {
            where: {
              status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "COMPLETED"] },
              createdAt: { gte: input.from, lte: input.to },
            },
            select: { totalAmount: true, durationDays: true },
          },
        },
      });
      return vehicles
        .map((v) => {
          const rentalDays = v.bookings.reduce((a, b) => a + (b.durationDays ?? 0), 0);
          const revenue = v.bookings.reduce((a, b) => a + Number(b.totalAmount), 0);
          return {
            id: v.id,
            code: v.internalCode,
            category: v.category.name,
            depot: v.depot.name,
            rentals: v.bookings.length,
            days: rentalDays,
            revenue,
            avgPerDay: rentalDays > 0 ? revenue / rentalDays : 0,
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
    }),

  reportCustomersNewVsReturning: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const bookings = await ctx.prisma.booking.findMany({
        where: { createdAt: { gte: input.from, lte: input.to } },
        select: { customerId: true, createdAt: true, customer: { select: { createdAt: true } } },
      });
      const byMonth = new Map<string, { newCount: number; returningCount: number }>();
      for (const b of bookings) {
        const key = b.createdAt.toISOString().slice(0, 7);
        const e = byMonth.get(key) ?? { newCount: 0, returningCount: 0 };
        const isNew =
          b.customer && b.customer.createdAt.getTime() >= b.createdAt.getTime() - 30 * 86400000;
        if (isNew) e.newCount += 1;
        else e.returningCount += 1;
        byMonth.set(key, e);
      }
      return [...byMonth.entries()]
        .map(([month, v]) => ({
          month,
          newCount: v.newCount,
          returningCount: v.returningCount,
          ratio:
            v.newCount + v.returningCount > 0
              ? v.newCount / (v.newCount + v.returningCount)
              : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }),

  reportFinancialAging: adminProcedure
    .input(z.object({ depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const bookings = await ctx.prisma.booking.findMany({
        where: {
          balanceDue: { gt: 0 },
          status: { notIn: ["CANCELLED"] },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        select: { id: true, bookingReference: true, balanceDue: true, pickupDateTime: true, customer: { select: { firstName: true, lastName: true } } },
      });
      const d30 = now.getTime() - 30 * 86400000;
      const d60 = now.getTime() - 60 * 86400000;
      const d90 = now.getTime() - 90 * 86400000;
      return bookings
        .map((b) => {
          const t = b.pickupDateTime.getTime();
          const bucket = t >= d30 ? "0-30" : t >= d60 ? "31-60" : t >= d90 ? "61-90" : "90+";
          return {
            bookingReference: b.bookingReference,
            customer: b.customer ? `${b.customer.firstName} ${b.customer.lastName}` : "",
            balance: Number(b.balanceDue),
            pickupDate: b.pickupDateTime,
            ageBucket: bucket,
          };
        })
        .sort((a, b) => b.balance - a.balance);
    }),

  reportFinancialRefunds: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const refunds = await ctx.prisma.payment.findMany({
        where: {
          type: "REFUND",
          createdAt: { gte: input.from, lte: input.to },
        },
        select: { amount: true, createdAt: true },
      });
      const revenue = await ctx.prisma.booking.aggregate({
        where: { createdAt: { gte: input.from, lte: input.to } },
        _sum: { totalAmount: true },
      });
      const byMonth = new Map<string, { count: number; amount: number }>();
      for (const r of refunds) {
        const key = r.createdAt.toISOString().slice(0, 7);
        const e = byMonth.get(key) ?? { count: 0, amount: 0 };
        e.count += 1;
        e.amount += Number(r.amount);
        byMonth.set(key, e);
      }
      const totalRev = Number(revenue._sum.totalAmount ?? 0);
      return [...byMonth.entries()]
        .map(([month, v]) => ({
          month,
          count: v.count,
          amount: v.amount,
          share: totalRev > 0 ? v.amount / totalRev : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }),

  reportOperationalIncidentFrequency: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const incidents = await ctx.prisma.incident.findMany({
        where: { createdAt: { gte: input.from, lte: input.to } },
        select: { createdAt: true, severity: true, type: true },
      });
      const byMonth = new Map<string, Record<string, number>>();
      for (const i of incidents) {
        const key = i.createdAt.toISOString().slice(0, 7);
        const e = byMonth.get(key) ?? {};
        e.total = (e.total ?? 0) + 1;
        e[i.severity] = (e[i.severity] ?? 0) + 1;
        e[i.type] = (e[i.type] ?? 0) + 1;
        byMonth.set(key, e);
      }
      return [...byMonth.entries()]
        .map(([month, counts]) => ({ month, ...counts }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }),

  reportBookingsLeadTime: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const bookings = await ctx.prisma.booking.findMany({
        where: {
          createdAt: { gte: input.from, lte: input.to },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        select: { createdAt: true, pickupDateTime: true },
      });
      const buckets: Record<string, number> = {
        "0-1d": 0,
        "2-7d": 0,
        "8-30d": 0,
        "31-90d": 0,
        "90d+": 0,
      };
      for (const b of bookings) {
        const days = (b.pickupDateTime.getTime() - b.createdAt.getTime()) / 86400000;
        if (days < 2) buckets["0-1d"]!++;
        else if (days < 8) buckets["2-7d"]!++;
        else if (days < 31) buckets["8-30d"]!++;
        else if (days < 91) buckets["31-90d"]!++;
        else buckets["90d+"]!++;
      }
      const total = bookings.length;
      return Object.entries(buckets).map(([bucket, count]) => ({
        bucket,
        count,
        share: total > 0 ? count / total : 0,
      }));
    }),

  reportBookingsNoShow: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const bookings = await ctx.prisma.booking.findMany({
        where: {
          createdAt: { gte: input.from, lte: input.to },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        select: { createdAt: true, status: true },
      });
      const byMonth = new Map<string, { bookings: number; noShows: number }>();
      for (const b of bookings) {
        const key = b.createdAt.toISOString().slice(0, 7);
        const e = byMonth.get(key) ?? { bookings: 0, noShows: 0 };
        e.bookings += 1;
        if (b.status === "NO_SHOW") e.noShows += 1;
        byMonth.set(key, e);
      }
      return [...byMonth.entries()]
        .map(([month, v]) => ({
          month,
          bookings: v.bookings,
          noShows: v.noShows,
          rate: v.bookings > 0 ? v.noShows / v.bookings : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }),

  reportBookingsConversion: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const where = {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      };
      const grouped = await ctx.prisma.booking.groupBy({
        by: ["status"],
        where,
        _count: true,
      });
      const map: Record<string, number> = {};
      for (const g of grouped) map[g.status] = g._count;
      const steps = [
        { step: "1. Quote", count: map.QUOTE ?? 0 },
        { step: "2. Pending payment", count: map.PENDING_PAYMENT ?? 0 },
        { step: "3. Confirmed", count: map.CONFIRMED ?? 0 },
        { step: "4. Checked out", count: map.CHECKED_OUT ?? 0 },
        { step: "5. Active", count: map.ACTIVE ?? 0 },
        { step: "6. Completed", count: map.COMPLETED ?? 0 },
      ];
      const total = steps.reduce((a, s) => a + s.count, 0);
      return steps.map((s) => ({ ...s, share: total > 0 ? s.count / total : 0 }));
    }),

  reportFleetMaintenanceCost: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const wos = await ctx.prisma.maintenanceWorkOrder.findMany({
        where: {
          completedAt: { gte: input.from, lte: input.to },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        include: {
          vehicle: {
            select: { internalCode: true, currentOdometerKm: true, category: { select: { name: true } } },
          },
        },
      });
      const byVehicle = new Map<
        string,
        { code: string; category: string; woCount: number; labour: number; parts: number; total: number; odo: number }
      >();
      for (const w of wos) {
        const key = w.vehicleId;
        const e = byVehicle.get(key) ?? {
          code: w.vehicle.internalCode,
          category: w.vehicle.category.name,
          woCount: 0,
          labour: 0,
          parts: 0,
          total: 0,
          odo: w.vehicle.currentOdometerKm ?? 0,
        };
        e.woCount += 1;
        e.labour += Number(w.labourCost ?? 0);
        e.parts += Number(w.partsCost ?? 0);
        e.total += Number(w.actualCost ?? 0);
        byVehicle.set(key, e);
      }
      return [...byVehicle.entries()]
        .map(([id, v]) => ({
          id,
          code: v.code,
          category: v.category,
          woCount: v.woCount,
          labour: v.labour,
          parts: v.parts,
          total: v.total,
          costPerKm: v.odo > 0 ? v.total / v.odo : 0,
        }))
        .sort((a, b) => b.total - a.total);
    }),

  reportFleetDowntime: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const wos = await ctx.prisma.maintenanceWorkOrder.findMany({
        where: {
          startedAt: { lte: input.to },
          completedAt: { gte: input.from },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        include: { vehicle: { select: { internalCode: true } } },
      });
      return wos.map((w) => {
        const start = w.startedAt ? Math.max(w.startedAt.getTime(), input.from.getTime()) : input.from.getTime();
        const end = w.completedAt ? Math.min(w.completedAt.getTime(), input.to.getTime()) : input.to.getTime();
        const days = Math.max(0, (end - start) / 86400000);
        return {
          id: w.id,
          workOrderNumber: w.workOrderNumber,
          vehicle: w.vehicle.internalCode,
          type: w.type,
          days: Math.round(days * 10) / 10,
          startedAt: w.startedAt,
          completedAt: w.completedAt,
        };
      }).sort((a, b) => b.days - a.days);
    }),

  reportFleetProfitability: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date(), depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const [vehicles, maintenance] = await Promise.all([
        ctx.prisma.vehicle.findMany({
          where: { isActive: true, ...(input.depotId ? { depotId: input.depotId } : {}) },
          include: {
            category: true,
            bookings: {
              where: {
                status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "COMPLETED"] },
                createdAt: { gte: input.from, lte: input.to },
              },
              select: { totalAmount: true },
            },
          },
        }),
        ctx.prisma.maintenanceWorkOrder.groupBy({
          by: ["vehicleId"],
          where: { completedAt: { gte: input.from, lte: input.to } },
          _sum: { actualCost: true },
        }),
      ]);
      const costByVehicle = new Map<string, number>();
      for (const m of maintenance) costByVehicle.set(m.vehicleId, Number(m._sum.actualCost ?? 0));
      return vehicles
        .map((v) => {
          const revenue = v.bookings.reduce((a, b) => a + Number(b.totalAmount), 0);
          const maint = costByVehicle.get(v.id) ?? 0;
          return {
            id: v.id,
            code: v.internalCode,
            category: v.category.name,
            revenue,
            maintenance: maint,
            net: revenue - maint,
          };
        })
        .sort((a, b) => b.net - a.net);
    }),

  reportFleetAgeOdometer: adminProcedure
    .input(z.object({ depotId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: { isActive: true, ...(input.depotId ? { depotId: input.depotId } : {}) },
        include: {
          category: true,
          depot: true,
          bookings: { where: { status: "COMPLETED" }, select: { durationDays: true } },
        },
      });
      const nowYear = new Date().getFullYear();
      return vehicles
        .map((v) => {
          const rentalDays = v.bookings.reduce((a, b) => a + (b.durationDays ?? 0), 0);
          return {
            id: v.id,
            code: v.internalCode,
            category: v.category.name,
            depot: v.depot.name,
            year: v.year,
            age: nowYear - v.year,
            odometer: v.currentOdometerKm ?? 0,
            rentalDays,
            kmPerRentalDay: rentalDays > 0 ? (v.currentOdometerKm ?? 0) / rentalDays : 0,
          };
        })
        .sort((a, b) => b.odometer - a.odometer);
    }),

  reportCustomersLtv: adminProcedure.query(async ({ ctx }) => {
    const customers = await ctx.prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: {
        customerProfile: { select: { totalBookings: true, totalSpend: true, customerSince: true } },
      },
    });
    const totals = customers.reduce(
      (acc, c) => {
        const bookings = c.customerProfile?.totalBookings ?? 0;
        const spend = Number(c.customerProfile?.totalSpend ?? 0);
        if (bookings > 0) {
          acc.customersWithBookings += 1;
          acc.totalBookings += bookings;
          acc.totalSpend += spend;
        }
        acc.totalCustomers += 1;
        return acc;
      },
      { totalCustomers: 0, customersWithBookings: 0, totalBookings: 0, totalSpend: 0 },
    );
    const avgLtv =
      totals.customersWithBookings > 0
        ? totals.totalSpend / totals.customersWithBookings
        : 0;
    const avgBookingsPerCustomer =
      totals.customersWithBookings > 0
        ? totals.totalBookings / totals.customersWithBookings
        : 0;
    const repeatCount = customers.filter(
      (c) => (c.customerProfile?.totalBookings ?? 0) > 1,
    ).length;
    return [
      {
        metric: "Total customers",
        value: totals.totalCustomers,
        format: "number" as const,
      },
      {
        metric: "Customers with bookings",
        value: totals.customersWithBookings,
        format: "number" as const,
      },
      {
        metric: "Repeat customers (>1 booking)",
        value: repeatCount,
        format: "number" as const,
      },
      {
        metric: "Avg LTV",
        value: avgLtv,
        format: "currency" as const,
      },
      {
        metric: "Avg bookings per customer",
        value: avgBookingsPerCustomer,
        format: "number" as const,
      },
      {
        metric: "Repeat rate",
        value: totals.customersWithBookings > 0 ? repeatCount / totals.customersWithBookings : 0,
        format: "percent" as const,
      },
    ];
  }),

  reportCustomersAcquisition: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const customers = await ctx.prisma.user.findMany({
        where: {
          role: "CUSTOMER",
          createdAt: { gte: input.from, lte: input.to },
        },
        select: {
          id: true,
          bookings: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { source: true, totalAmount: true },
          },
        },
      });
      const bySource = new Map<string, { customers: number; revenue: number }>();
      for (const c of customers) {
        const first = c.bookings[0];
        const source = first?.source ?? "NO_BOOKING";
        const e = bySource.get(source) ?? { customers: 0, revenue: 0 };
        e.customers += 1;
        e.revenue += Number(first?.totalAmount ?? 0);
        bySource.set(source, e);
      }
      return [...bySource.entries()]
        .map(([source, v]) => ({ source, ...v }))
        .sort((a, b) => b.customers - a.customers);
    }),

  reportCustomersGeographic: adminProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.prisma.customerProfile.findMany({
      where: { postcode: { not: null } },
      select: {
        postcode: true,
        suburb: true,
        state: true,
        totalBookings: true,
        totalSpend: true,
      },
    });
    const byPostcode = new Map<
      string,
      { postcode: string; suburb: string; state: string; customers: number; bookings: number; revenue: number }
    >();
    for (const p of profiles) {
      const key = `${p.postcode}-${p.state ?? ""}`;
      const e = byPostcode.get(key) ?? {
        postcode: p.postcode ?? "",
        suburb: p.suburb ?? "",
        state: p.state ?? "",
        customers: 0,
        bookings: 0,
        revenue: 0,
      };
      e.customers += 1;
      e.bookings += p.totalBookings;
      e.revenue += Number(p.totalSpend);
      byPostcode.set(key, e);
    }
    return [...byPostcode.values()].sort((a, b) => b.revenue - a.revenue);
  }),

  reportFinancialPnlByDepot: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const [revenueByDepot, maintenanceByDepot, damageCharges, depots] = await Promise.all([
        ctx.prisma.booking.groupBy({
          by: ["depotId"],
          where: {
            createdAt: { gte: input.from, lte: input.to },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
          },
          _sum: { totalAmount: true, gstAmount: true },
        }),
        ctx.prisma.maintenanceWorkOrder.groupBy({
          by: ["depotId"],
          where: { completedAt: { gte: input.from, lte: input.to } },
          _sum: { actualCost: true },
        }),
        ctx.prisma.payment.aggregate({
          where: { type: "DAMAGE_CHARGE", createdAt: { gte: input.from, lte: input.to } },
          _sum: { amount: true },
        }),
        ctx.prisma.depot.findMany({ select: { id: true, name: true } }),
      ]);
      void damageCharges;
      const nameOf = new Map(depots.map((d) => [d.id, d.name]));
      const maintMap = new Map<string, number>();
      for (const m of maintenanceByDepot) maintMap.set(m.depotId, Number(m._sum.actualCost ?? 0));
      return revenueByDepot.map((r) => {
        const revenue = Number(r._sum.totalAmount ?? 0);
        const gst = Number(r._sum.gstAmount ?? 0);
        const maint = maintMap.get(r.depotId) ?? 0;
        return {
          depot: nameOf.get(r.depotId) ?? "Unknown",
          revenue,
          gst,
          maintenance: maint,
          net: revenue - gst - maint,
        };
      }).sort((a, b) => b.net - a.net);
    }),

  reportFinancialBondCapture: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const bonds = await ctx.prisma.bondLedger.findMany({
        where: { createdAt: { gte: input.from, lte: input.to } },
        select: { createdAt: true, heldAmount: true, capturedAmount: true, releasedAmount: true },
      });
      const byMonth = new Map<string, { held: number; captured: number; released: number }>();
      for (const b of bonds) {
        const key = b.createdAt.toISOString().slice(0, 7);
        const e = byMonth.get(key) ?? { held: 0, captured: 0, released: 0 };
        e.held += Number(b.heldAmount);
        e.captured += Number(b.capturedAmount);
        e.released += Number(b.releasedAmount);
        byMonth.set(key, e);
      }
      return [...byMonth.entries()]
        .map(([month, v]) => ({
          month,
          ...v,
          captureRate: v.held > 0 ? v.captured / v.held : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }),

  reportFinancialDamageRecovery: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const damageCharges = await ctx.prisma.payment.findMany({
        where: { type: "DAMAGE_CHARGE", createdAt: { gte: input.from, lte: input.to } },
        include: {
          booking: { select: { bookingReference: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
      });
      return damageCharges.map((p) => ({
        id: p.id,
        booking: p.booking?.bookingReference ?? "",
        customer: p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : "",
        charged: Number(p.amount),
        collected: p.status === "SUCCEEDED" ? Number(p.amount) : 0,
        status: p.status,
        createdAt: p.createdAt,
      }));
    }),

  reportOperationalInfringements: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const infringements = await ctx.prisma.infringement.findMany({
        where: { offenceDate: { gte: input.from, lte: input.to } },
        select: { type: true, status: true, amount: true, offenceDate: true },
      });
      const byType = new Map<string, { count: number; amount: number; recovered: number }>();
      for (const i of infringements) {
        const e = byType.get(i.type) ?? { count: 0, amount: 0, recovered: 0 };
        e.count += 1;
        e.amount += Number(i.amount);
        if (i.status === "PAID" || i.status === "CUSTOMER_CHARGED") e.recovered += Number(i.amount);
        byType.set(i.type, e);
      }
      return [...byType.entries()]
        .map(([type, v]) => ({
          type,
          ...v,
          recoveryRate: v.amount > 0 ? v.recovered / v.amount : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
    }),

  reportOperationalStaffPerformance: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const [checkouts, checkins, incidentsRaw] = await Promise.all([
        ctx.prisma.booking.groupBy({
          by: ["checkedOutById"],
          where: {
            actualPickupDateTime: { gte: input.from, lte: input.to },
            checkedOutById: { not: null },
          },
          _count: true,
        }),
        ctx.prisma.booking.groupBy({
          by: ["checkedInById"],
          where: {
            actualReturnDateTime: { gte: input.from, lte: input.to },
            checkedInById: { not: null },
          },
          _count: true,
        }),
        ctx.prisma.incident.groupBy({
          by: ["reportedById"],
          where: { createdAt: { gte: input.from, lte: input.to }, reportedById: { not: null } },
          _count: true,
        }),
      ]);
      const staffIds = new Set<string>();
      for (const c of checkouts) if (c.checkedOutById) staffIds.add(c.checkedOutById);
      for (const c of checkins) if (c.checkedInById) staffIds.add(c.checkedInById);
      for (const i of incidentsRaw) if (i.reportedById) staffIds.add(i.reportedById);
      const staff = await ctx.prisma.user.findMany({
        where: { id: { in: [...staffIds] } },
        select: { id: true, firstName: true, lastName: true, role: true },
      });
      const nameOf = new Map(staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
      const coMap = new Map(checkouts.filter((c) => c.checkedOutById).map((c) => [c.checkedOutById!, c._count]));
      const ciMap = new Map(checkins.filter((c) => c.checkedInById).map((c) => [c.checkedInById!, c._count]));
      const inMap = new Map(incidentsRaw.filter((i) => i.reportedById).map((i) => [i.reportedById!, i._count]));
      return [...staffIds]
        .map((id) => ({
          id,
          name: nameOf.get(id) ?? "Unknown",
          checkouts: coMap.get(id) ?? 0,
          checkins: ciMap.get(id) ?? 0,
          incidentsRaised: inMap.get(id) ?? 0,
        }))
        .sort((a, b) => b.checkouts + b.checkins - (a.checkouts + a.checkins));
    }),

  reportOperationalCheckTimes: adminProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const bookings = await ctx.prisma.booking.findMany({
        where: {
          OR: [
            { actualPickupDateTime: { gte: input.from, lte: input.to } },
            { actualReturnDateTime: { gte: input.from, lte: input.to } },
          ],
        },
        select: {
          pickupDateTime: true,
          actualPickupDateTime: true,
          returnDateTime: true,
          actualReturnDateTime: true,
          pickupDepot: { select: { name: true } },
          returnDepot: { select: { name: true } },
        },
      });
      const byDepot = new Map<
        string,
        { coSamples: number[]; ciSamples: number[] }
      >();
      for (const b of bookings) {
        if (b.actualPickupDateTime) {
          const diffMin =
            (b.actualPickupDateTime.getTime() - b.pickupDateTime.getTime()) / 60000;
          const e = byDepot.get(b.pickupDepot.name) ?? { coSamples: [], ciSamples: [] };
          e.coSamples.push(diffMin);
          byDepot.set(b.pickupDepot.name, e);
        }
        if (b.actualReturnDateTime) {
          const diffMin =
            (b.actualReturnDateTime.getTime() - b.returnDateTime.getTime()) / 60000;
          const e = byDepot.get(b.returnDepot.name) ?? { coSamples: [], ciSamples: [] };
          e.ciSamples.push(diffMin);
          byDepot.set(b.returnDepot.name, e);
        }
      }
      const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const p90 = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.9)] ?? 0;
      };
      return [...byDepot.entries()]
        .map(([depot, v]) => ({
          depot,
          avgCheckoutMin: Math.round(avg(v.coSamples) * 10) / 10,
          avgCheckinMin: Math.round(avg(v.ciSamples) * 10) / 10,
          p90CheckoutMin: Math.round(p90(v.coSamples) * 10) / 10,
          p90CheckinMin: Math.round(p90(v.ciSamples) * 10) / 10,
        }))
        .sort((a, b) => a.depot.localeCompare(b.depot));
    }),

  // ----- Settings -----
  listSettings: adminProcedure.query(({ ctx }) =>
    ctx.prisma.systemSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }),
  ),

  setSetting: adminProcedure
    .input(z.object({ key: z.string(), value: z.unknown(), group: z.string().optional(), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // SystemSetting.value is a JSON column; tRPC delivers any JSON-serialisable
      // value here. We trust it as JSON input after zod has ensured it parsed.
      const value = input.value as Prisma.InputJsonValue;
      const row = await ctx.prisma.systemSetting.upsert({
        where: { key: input.key },
        update: { value, group: input.group, description: input.description, updatedById: ctx.user.id },
        create: { key: input.key, value, group: input.group, description: input.description, updatedById: ctx.user.id },
      });
      if (BRANDING_SETTING_KEYS.has(input.key)) revalidateTag("branding", "max");
      return row;
    }),

  // ----- Audit log -----
  auditLogStats: adminProcedure
    .input(
      z
        .object({ range: z.enum(["24h", "7d", "14d", "30d", "90d"]).default("24h") })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const range = input?.range ?? "24h";
      const now = new Date();
      const rangeStart = new Date(now);
      if (range === "24h") rangeStart.setTime(now.getTime() - 24 * 60 * 60 * 1000);
      else if (range === "7d") rangeStart.setDate(rangeStart.getDate() - 7);
      else if (range === "14d") rangeStart.setDate(rangeStart.getDate() - 14);
      else if (range === "30d") rangeStart.setDate(rangeStart.getDate() - 30);
      else rangeStart.setDate(rangeStart.getDate() - 90);

      const [byCategoryRaw, byStatusRaw, mutationsInRange, queriesInRange, failedInRange, deniedInRange, eventsInRange] =
        await Promise.all([
          ctx.prisma.auditLog.groupBy({
            by: ["category"],
            where: { timestamp: { gte: rangeStart } },
            _count: { _all: true },
          }),
          ctx.prisma.auditLog.groupBy({
            by: ["status"],
            where: { timestamp: { gte: rangeStart } },
            _count: { _all: true },
          }),
          ctx.prisma.auditLog.count({
            where: { timestamp: { gte: rangeStart }, category: "MUTATION" },
          }),
          ctx.prisma.auditLog.count({
            where: { timestamp: { gte: rangeStart }, category: "QUERY" },
          }),
          ctx.prisma.auditLog.count({
            where: { timestamp: { gte: rangeStart }, status: "FAILURE" },
          }),
          ctx.prisma.auditLog.count({
            where: { timestamp: { gte: rangeStart }, status: "DENIED" },
          }),
          ctx.prisma.auditLog.count({ where: { timestamp: { gte: rangeStart } } }),
        ]);

      const catMap: Record<string, number> = {};
      for (const r of byCategoryRaw) catMap[r.category] = r._count._all;
      const statMap: Record<string, number> = {};
      for (const r of byStatusRaw) statMap[r.status] = r._count._all;

      return {
        range,
        rangeStart,
        eventsInRange,
        byCategory: {
          auth: catMap.AUTH ?? 0,
          pageView: catMap.PAGE_VIEW ?? 0,
          mutation: catMap.MUTATION ?? 0,
          query: catMap.QUERY ?? 0,
          job: catMap.JOB ?? 0,
          api: catMap.API ?? 0,
          webhook: catMap.WEBHOOK ?? 0,
        },
        byStatus: {
          success: statMap.SUCCESS ?? 0,
          failure: statMap.FAILURE ?? 0,
          denied: statMap.DENIED ?? 0,
        },
        mutationsInRange,
        queriesInRange,
        failedInRange,
        deniedInRange,
      };
    }),

  /**
   * Hourly (or daily) activity timeseries. Buckets AuditLog rows by
   * time + status so the Overview tab can stack success vs failure vs
   * denied as a bar chart. Pre-fills empty buckets so zero-activity
   * hours show as gaps instead of missing x-axis labels.
   */
  auditActivityTimeseries: adminProcedure
    .input(
      z
        .object({ range: z.enum(["24h", "7d", "14d", "30d", "90d"]).default("24h") })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const range = input?.range ?? "24h";
      const now = new Date();
      const since = new Date(now);
      // Pick bucket size so we get a readable chart at every range:
      // 24h → 24 hourly bars, 7d → 7 daily, 14d → 14 daily,
      // 30d → 30 daily, 90d → ~13 weekly bars.
      let bucket: "hour" | "day" | "week";
      if (range === "24h") {
        since.setTime(now.getTime() - 24 * 60 * 60 * 1000);
        bucket = "hour";
      } else if (range === "90d") {
        since.setDate(since.getDate() - 90);
        bucket = "week";
      } else {
        const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
        since.setDate(since.getDate() - days);
        bucket = "day";
      }

      const rows = await ctx.prisma.$queryRaw<
        { bucket: Date; status: "SUCCESS" | "FAILURE" | "DENIED"; count: bigint }[]
      >`
        SELECT
          date_trunc(${bucket}, "timestamp") AS "bucket",
          status,
          COUNT(*) AS "count"
        FROM "AuditLog"
        WHERE "timestamp" >= ${since}
        GROUP BY "bucket", status
        ORDER BY "bucket" ASC
      `;

      const byBucket = new Map<
        string,
        { bucket: Date; success: number; failure: number; denied: number }
      >();
      const stepMs =
        bucket === "hour"
          ? 60 * 60 * 1000
          : bucket === "day"
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;
      const first = new Date(since);
      first.setMinutes(0, 0, 0);
      if (bucket !== "hour") first.setHours(0, 0, 0, 0);
      for (let t = first.getTime(); t <= now.getTime(); t += stepMs) {
        const d = new Date(t);
        byBucket.set(d.toISOString(), { bucket: d, success: 0, failure: 0, denied: 0 });
      }
      for (const r of rows) {
        const key = r.bucket.toISOString();
        const entry =
          byBucket.get(key) ?? { bucket: r.bucket, success: 0, failure: 0, denied: 0 };
        const n = Number(r.count);
        if (r.status === "SUCCESS") entry.success = n;
        else if (r.status === "FAILURE") entry.failure = n;
        else entry.denied = n;
        byBucket.set(key, entry);
      }

      return {
        range,
        bucket,
        points: Array.from(byBucket.values()).sort(
          (a, b) => a.bucket.getTime() - b.bucket.getTime(),
        ),
      };
    }),

  /**
   * Security-focused rollup: lockouts, rate-limit trips, failed auth, denied
   * requests. Powers the Security tab on /admin/audit-log. Uses Prisma JSON
   * path filters on AuditLog.newData.reason to split AUTH failures by cause
   * (bad_password vs locked vs rate_limited).
   */
  auditSecurityStats: adminProcedure
    .input(
      z
        .object({ range: z.enum(["24h", "7d", "14d", "30d", "90d"]).default("24h") })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const range = input?.range ?? "24h";
      const now = new Date();
      const rangeStart = new Date(now);
      if (range === "24h") rangeStart.setTime(now.getTime() - 24 * 60 * 60 * 1000);
      else if (range === "7d") rangeStart.setDate(rangeStart.getDate() - 7);
      else if (range === "14d") rangeStart.setDate(rangeStart.getDate() - 14);
      else if (range === "30d") rangeStart.setDate(rangeStart.getDate() - 30);
      else rangeStart.setDate(rangeStart.getDate() - 90);

      const [
        lockouts,
        rateLimitTrips,
        failedAuth,
        badPassword,
        denied,
        successfulLogins,
        topIpsRaw,
        topActionsRaw,
      ] = await Promise.all([
        ctx.prisma.auditLog.count({
          where: {
            timestamp: { gte: rangeStart },
            category: "AUTH",
            status: "FAILURE",
            OR: [
              { newData: { path: ["reason"], equals: "locked" } },
              { newData: { path: ["reason"], equals: "locked_now" } },
            ],
          },
        }),
        ctx.prisma.auditLog.count({
          where: {
            timestamp: { gte: rangeStart },
            OR: [
              { action: "rate_limit.tripped" },
              {
                category: "AUTH",
                newData: { path: ["reason"], equals: "rate_limited" },
              },
            ],
          },
        }),
        ctx.prisma.auditLog.count({
          where: {
            timestamp: { gte: rangeStart },
            category: "AUTH",
            status: "FAILURE",
          },
        }),
        ctx.prisma.auditLog.count({
          where: {
            timestamp: { gte: rangeStart },
            category: "AUTH",
            status: "FAILURE",
            newData: { path: ["reason"], equals: "bad_password" },
          },
        }),
        ctx.prisma.auditLog.count({
          where: { timestamp: { gte: rangeStart }, status: "DENIED" },
        }),
        ctx.prisma.auditLog.count({
          where: {
            timestamp: { gte: rangeStart },
            category: "AUTH",
            status: "SUCCESS",
            action: "auth.login",
          },
        }),
        ctx.prisma.auditLog.groupBy({
          by: ["ipAddress"],
          where: {
            timestamp: { gte: rangeStart },
            status: { in: ["FAILURE", "DENIED"] },
            ipAddress: { not: null },
          },
          _count: { _all: true },
          orderBy: { _count: { ipAddress: "desc" } },
          take: 10,
        }),
        ctx.prisma.auditLog.groupBy({
          by: ["action"],
          where: {
            timestamp: { gte: rangeStart },
            OR: [
              { action: "rate_limit.tripped" },
              { category: "AUTH", status: "FAILURE" },
              { status: "DENIED" },
            ],
          },
          _count: { _all: true },
          orderBy: { _count: { action: "desc" } },
          take: 10,
        }),
      ]);

      return {
        range,
        rangeStart,
        lockouts,
        rateLimitTrips,
        failedAuth,
        badPassword,
        denied,
        successfulLogins,
        topIps: topIpsRaw.map((r) => ({ ip: r.ipAddress ?? "unknown", count: r._count._all })),
        topActions: topActionsRaw.map((r) => ({ action: r.action, count: r._count._all })),
      };
    }),

  // Admin "PII encryption status" summary. Counts CustomerProfile rows
  // that still have plaintext licence/passport numbers (i.e. need the
  // `scripts/encrypt-licence-data.ts` migration to run) vs rows that
  // have already been migrated into the *Enc columns. Used by the
  // admin settings page to visualise APP-11 rollout progress.
  encryptionStatus: adminProcedure.query(async ({ ctx }) => {
    // Prisma's Json nullable filter uses { not: Prisma.DbNull } / equals.
    // `DbNull` as the direct value on an optional Json column isn't a
    // valid filter in recent Prisma versions — we express "is null" via
    // { equals: Prisma.DbNull } and "is not null" via { not: Prisma.DbNull }.
    const [licenceEncrypted, licencePlaintextOnly, passportEncrypted, passportPlaintextOnly] =
      await Promise.all([
        ctx.prisma.customerProfile.count({
          where: { licenceNumberEnc: { not: Prisma.DbNull } },
        }),
        ctx.prisma.customerProfile.count({
          where: {
            licenceNumberEnc: { equals: Prisma.DbNull },
            licenceNumber: { not: null },
          },
        }),
        ctx.prisma.customerProfile.count({
          where: { passportNumberEnc: { not: Prisma.DbNull } },
        }),
        ctx.prisma.customerProfile.count({
          where: {
            passportNumberEnc: { equals: Prisma.DbNull },
            passportNumber: { not: null },
          },
        }),
      ]);
    return {
      licence: { encrypted: licenceEncrypted, plaintextOnly: licencePlaintextOnly },
      passport: { encrypted: passportEncrypted, plaintextOnly: passportPlaintextOnly },
    };
  }),

  auditLog: adminProcedure
    .input(
      z
        .object({
          from: z.date().optional(),
          to: z.date().optional(),
          category: z
            .enum(["AUTH", "PAGE_VIEW", "MUTATION", "QUERY", "JOB", "API", "WEBHOOK"])
            .optional(),
          // Array form — match any of the provided categories. Used by the
          // Security and Webhooks tabs which combine multiple buckets.
          categoryIn: z
            .array(z.enum(["AUTH", "PAGE_VIEW", "MUTATION", "QUERY", "JOB", "API", "WEBHOOK"]))
            .optional(),
          status: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
          statusIn: z.array(z.enum(["SUCCESS", "FAILURE", "DENIED"])).optional(),
          action: z.string().optional(),
          userId: z.string().optional(),
          entity: z.string().optional(),
          impersonatedOnly: z.boolean().optional(),
          cursor: z.object({ timestamp: z.date(), id: z.string() }).optional(),
          take: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const take = input?.take ?? 100;
      const where: Prisma.AuditLogWhereInput = buildAuditWhere(input);
      if (input?.impersonatedOnly) {
        where.impersonatorId = { not: null };
      }
      const rows = await ctx.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: take + 1,
      });
      const hasMore = rows.length > take;
      const page = hasMore ? rows.slice(0, take) : rows;
      const last = page[page.length - 1];
      return {
        rows: page,
        nextCursor: hasMore && last ? { timestamp: last.timestamp, id: last.id } : null,
      };
    }),

  auditLogExport: adminProcedure
    .input(
      z.object({
        from: z.date().optional(),
        to: z.date().optional(),
        category: z
          .enum(["AUTH", "PAGE_VIEW", "MUTATION", "QUERY", "JOB", "API", "WEBHOOK"])
          .optional(),
        status: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
        action: z.string().optional(),
        userId: z.string().optional(),
        entity: z.string().optional(),
        limit: z.number().int().min(1).max(50000).default(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const rows = await ctx.prisma.auditLog.findMany({
        where: buildAuditWhere(input),
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: input.limit,
      });
      const header = [
        "Timestamp",
        "Category",
        "Action",
        "Entity",
        "EntityId",
        "Status",
        "DurationMs",
        "User",
        "Email",
        "IP",
        "Method",
        "Path",
        "ErrorCode",
      ];
      const body = rows.map((r) => [
        r.timestamp.toISOString(),
        r.category,
        r.action,
        r.entity,
        r.entityId ?? "",
        r.status,
        r.durationMs == null ? "" : String(r.durationMs),
        r.user ? `${r.user.firstName} ${r.user.lastName}` : "system",
        r.user?.email ?? "",
        r.ipAddress ?? "",
        r.method ?? "",
        r.path ?? "",
        r.errorCode ?? "",
      ]);
      const csv = [header, ...body]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "admin.auditLogExport",
        entity: "AuditLog",
        status: "SUCCESS",
        newData: { filters: input, rowCount: rows.length },
      });
      return { csv, rowCount: rows.length };
    }),

  auditRetentionGet: adminProcedure.query(async ({ ctx }) => {
    const row = await ctx.prisma.systemSetting.findUnique({ where: { key: "audit.retention" } });
    return row?.value ?? null;
  }),

  auditRetentionSet: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        retention: z.object({
          PAGE_VIEW: z.number().int().min(0),
          QUERY: z.number().int().min(0),
          MUTATION: z.number().int().min(0),
          AUTH: z.number().int().min(0),
          JOB: z.number().int().min(0),
          API: z.number().int().min(0),
          WEBHOOK: z.number().int().min(0),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const prev = await ctx.prisma.systemSetting.findUnique({ where: { key: "audit.retention" } });
      await ctx.prisma.systemSetting.upsert({
        where: { key: "audit.retention" },
        create: {
          key: "audit.retention",
          group: "audit",
          description: "Per-category retention window for AuditLog.",
          value: input as never,
          updatedById: ctx.user.id,
        },
        update: { value: input as never, updatedById: ctx.user.id },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "admin.auditRetentionSet",
        entity: "SystemSetting",
        entityId: "audit.retention",
        status: "SUCCESS",
        previousData: prev?.value ?? null,
        newData: input,
      });
      return { ok: true };
    }),

  // ----- API keys -----
  listApiKeys: adminProcedure.query(({ ctx }) =>
    ctx.prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
  ),

  createApiKey: adminProcedure
    .input(z.object({ name: z.string().min(1), permissions: z.array(z.string()).default([]) }))
    .mutation(async ({ ctx, input }) => {
      const plaintext = `sk_${crypto.randomBytes(24).toString("base64url")}`;
      const keyHash = crypto.createHash("sha256").update(plaintext).digest("hex");
      const created = await ctx.prisma.apiKey.create({
        data: { name: input.name, keyHash, permissions: input.permissions, createdById: ctx.user.id },
      });
      return { id: created.id, plaintext };
    }),

  revokeApiKey: adminProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.prisma.apiKey.update({ where: { id: input.id }, data: { isActive: false } }),
  ),

  // ----- Integration status overview -----
  integrationsOverview: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      pushSubCount,
      pushDelivered24h,
      telemetryCount24h,
      telemetryDevices,
      etollAccountCount,
      etollLastSync,
      notificationsSent,
      notificationsDelivered,
      notificationsFailed,
      xeroTokens,
      vapidPublicKey,
      vapidPrivateKey,
    ] = await Promise.all([
      ctx.prisma.pushSubscription.count(),
      ctx.prisma.pushSubscription.count({ where: { lastDeliveredAt: { gte: dayAgo } } }),
      ctx.prisma.vehicleTelemetry.count({ where: { createdAt: { gte: dayAgo } } }),
      ctx.prisma.vehicleTelemetry.groupBy({
        by: ["deviceId"],
        where: { createdAt: { gte: weekAgo } },
      }),
      ctx.prisma.etollAccount.count({ where: { isActive: true } }),
      ctx.prisma.etollSync.findFirst({ orderBy: { startedAt: "desc" } }),
      ctx.prisma.notification.count({ where: { createdAt: { gte: weekAgo }, status: "SENT" } }),
      ctx.prisma.notification.count({ where: { createdAt: { gte: weekAgo }, status: "DELIVERED" } }),
      ctx.prisma.notification.count({ where: { createdAt: { gte: weekAgo }, status: "FAILED" } }),
      ctx.prisma.systemSetting.findUnique({ where: { key: "xero:tokens" } }),
      getString("integration:vapid:publicKey", "VAPID_PUBLIC_KEY"),
      getSecret("integration:vapid:privateKey", "VAPID_PRIVATE_KEY"),
    ]);

    const xeroRaw = xeroTokens?.value as
      | { expires_at?: number; tenant_id?: string | null }
      | null
      | undefined;

    return {
      stripe: {
        configured: !!process.env.STRIPE_SECRET_KEY,
        webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
        identityEnabled: !!process.env.STRIPE_SECRET_KEY,
      },
      twilio: {
        configured: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
        statusCallbackConfigured: !!process.env.NEXT_PUBLIC_APP_URL,
      },
      resend: {
        configured: !!process.env.RESEND_API_KEY,
        webhookConfigured: !!process.env.RESEND_WEBHOOK_SECRET,
      },
      notifications: {
        sentLast7d: notificationsSent,
        deliveredLast7d: notificationsDelivered,
        failedLast7d: notificationsFailed,
      },
      xero: {
        configured: !!process.env.XERO_CLIENT_ID && !!process.env.XERO_CLIENT_SECRET,
        connected: !!xeroRaw?.tenant_id,
        tokenExpiresAt: xeroRaw?.expires_at ? new Date(xeroRaw.expires_at) : null,
        tenantId: xeroRaw?.tenant_id ?? null,
      },
      regoCheck: {
        configured: true,
      },
      etoll: {
        configured: etollAccountCount > 0,
        accountCount: etollAccountCount,
        lastSyncAt: etollLastSync?.startedAt ?? null,
        lastSyncStatus: etollLastSync?.status ?? null,
      },
      linkt: {
        configured:
          (await ctx.prisma.systemSetting.count({
            where: { key: { startsWith: "linkt:account:" } },
          })) > 0,
      },
      weather: { configured: true, provider: "Open-Meteo" },
      calendar: { configured: true },
      push: {
        vapidConfigured: !!vapidPublicKey && !!vapidPrivateKey,
        browserKeyConfigured: !!vapidPublicKey,
        subscriptionCount: pushSubCount,
        deliveredLast24h: pushDelivered24h,
      },
      telemetry: {
        ingestConfigured: !!process.env.TELEMETRY_INGEST_TOKEN,
        pingsLast24h: telemetryCount24h,
        activeDevicesLast7d: telemetryDevices.length,
      },
      posthog: {
        configured: !!process.env.POSTHOG_KEY,
        browserConfigured: !!process.env.NEXT_PUBLIC_POSTHOG_KEY,
        host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
      },
    };
  }),

  disconnectXero: adminProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.systemSetting
      .delete({ where: { key: "xero:tokens" } })
      .catch(() => null);
    return { ok: true };
  }),
});
