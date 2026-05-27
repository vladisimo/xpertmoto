import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, staffProcedure, trpcRateLimit } from "../trpc";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { renderConsentDocumentPdf } from "@/lib/pdf/consent-document";
import {
  CONSENT_DOC_TYPE_MAP,
  getConsentDocument,
  type ConsentDocKey,
} from "@/lib/consent-documents";
import {
  createLicenceVerification,
  getLicenceVerificationStatus,
} from "@/lib/licence-verify";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/customers/filters";
import {
  CUSTOMER_DIRECTORY_SQL_PREDICATE,
  customerDirectoryUserWhere,
} from "@/lib/customer-identity";
import { strongPasswordField } from "@/lib/validators/auth";
import { deleteFile, downloadFile, getSignedUrl, uploadFile } from "@/lib/storage";
import {
  extractLicenceData,
  extractPassportData,
  type DetectedLicenceMetadata,
  type DetectedPassportMetadata,
} from "@/server/services/document-extract";
import { computeCustomerRewards } from "@/server/services/customer-rewards";
import {
  applyLatestDocumentToProfile,
  PROJECTABLE_IDENTITY_TYPES,
  type ProjectableIdentityType,
} from "@/server/services/identity-document";
import { cropImageRegion, rotateImage } from "@/lib/image-processing";
import { readPiiField, writePiiField } from "@/lib/customer-pii";
import {
  CUSTOMER_AUDIT_CHECKS,
  CUSTOMER_AUDIT_EXCLUDED_STATUSES,
  evaluateCustomerAudit,
  type CustomerAuditCheckKey,
  type CustomerAuditSeverity,
} from "@/server/services/customer-audit";
import {
  AUDIT_CATEGORIES,
  AUDIT_STATUSES,
  buildAuditWhere,
} from "@/server/services/audit-query";
import {
  captureCustomerId,
  readCapturedCustomerId,
  writeAuditAsync,
} from "@/server/services/audit";

const PENDING_HIRE_STATUSES: Prisma.BookingWhereInput["status"] = {
  in: ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"],
};

function isProjectableIdentityType(type: string): type is ProjectableIdentityType {
  return (PROJECTABLE_IDENTITY_TYPES as readonly string[]).includes(type);
}

// Decimal fields can't cross the Server→Client Component boundary via
// dehydrate/HydrationBoundary — React's prop serializer rejects them.
// Normalise to plain numbers at the API boundary.
function serializeCustomerProfile<T extends { totalSpend: Prisma.Decimal; referralCreditBalance: Prisma.Decimal } | null>(
  profile: T,
): T extends null ? null : Omit<NonNullable<T>, "totalSpend" | "referralCreditBalance"> & { totalSpend: number; referralCreditBalance: number } {
  if (!profile) return null as never;
  return {
    ...profile,
    totalSpend: profile.totalSpend.toNumber(),
    referralCreditBalance: profile.referralCreditBalance.toNumber(),
  } as never;
}

/**
 * Maps a verification-queue bucket to the `CustomerProfile` filter that
 * defines that bucket. Pure — extracted so the bucket policy can be
 * unit-tested without spinning up Prisma.
 */
export function verificationBucketProfileFilter(
  bucket: "awaitingReview" | "expiring" | "expired" | "noImages",
  now: Date,
): Prisma.CustomerProfileWhereInput {
  if (bucket === "awaitingReview") {
    return {
      licenceVerifiedAt: null,
      OR: [{ licenceImageFront: { not: null } }, { licenceImageBack: { not: null } }],
    };
  }
  if (bucket === "expiring") {
    const soon = new Date(now);
    soon.setDate(soon.getDate() + 30);
    return { licenceExpiry: { gte: now, lte: soon } };
  }
  if (bucket === "expired") {
    return { licenceExpiry: { lt: now } };
  }
  return { licenceImageFront: null, licenceImageBack: null };
}

/** Maps a missing-document requirement to its `CustomerProfile` filter. */
export function missingDocumentProfileFilter(
  requirement: "licenceImages" | "signature" | "emergency" | "address" | "terms",
): Prisma.CustomerProfileWhereInput {
  switch (requirement) {
    case "licenceImages":
      return { licenceImageFront: null, licenceImageBack: null };
    case "signature":
      return { signatureImage: null };
    case "emergency":
      return { emergencyContactName: null, emergencyContactPhone: null };
    case "address":
      return { OR: [{ addressLine1: null }, { postcode: null }] };
    case "terms":
      return { termsAcceptedAt: null };
  }
}

/**
 * Builds the `CustomerProfile` filter portion of the risk list query.
 * Pure — the wrapping `User` filter (search, suspended, base scope) is
 * applied by the caller.
 */
export function riskListProfileFilter(input: {
  rating?: "LOW" | "MEDIUM" | "HIGH";
  blacklisted?: boolean;
  minIncidents?: number;
}): Prisma.CustomerProfileWhereInput {
  const filter: Prisma.CustomerProfileWhereInput = {};
  if (input.rating) filter.riskRating = input.rating;
  if (input.blacklisted === true) filter.blacklistReason = { not: null };
  if (input.blacklisted === false) filter.blacklistReason = null;
  if (input.minIncidents != null) filter.incidentCount = { gte: input.minIncidents };
  return filter;
}

/**
 * Maps a non-bounce suppression kind to its `CustomerProfile` filter.
 * The "bounced" kind queries `CommunicationLog` instead and is handled
 * separately by the caller.
 */
export function suppressionProfileFilter(
  kind: "email" | "sms",
): Prisma.CustomerProfileWhereInput {
  return kind === "email"
    ? { marketingEmailUnsubscribedAt: { not: null } }
    : { marketingSmsUnsubscribedAt: { not: null } };
}

/**
 * Zero-fills missing months in an acquisition trend. Returns one entry
 * per month from `start` for `months` consecutive months, asc.
 */
export function fillAcquisitionTrend(
  rows: { month: Date; count: bigint | number }[],
  start: Date,
  months: number,
): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.month.toISOString().slice(0, 7), Number(r.count));
  }
  const out: { month: string; count: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ month: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

/**
 * Month-over-month percentage change. Returns null when the prior period
 * has no data (avoids divide-by-zero / spurious "infinite growth").
 */
export function momDelta(last: number, prev: number): number | null {
  if (prev <= 0) return null;
  return (last - prev) / prev;
}

export function buildCustomerListWhere(
  input: { search?: string; status: StatusFilter },
  now: Date,
): Prisma.UserWhereInput {
  // Directory membership is profile-based, not role-based: any user with a
  // CustomerProfile (incl. back-office users who carry one so they can rent).
  // Held in AND so the status facets below can still set `customerProfile`
  // without clobbering the membership clause.
  const where: Prisma.UserWhereInput = { AND: [customerDirectoryUserWhere()] };
  if (input.search) {
    where.OR = [
      { email: { contains: input.search, mode: "insensitive" } },
      { firstName: { contains: input.search, mode: "insensitive" } },
      { lastName: { contains: input.search, mode: "insensitive" } },
      { phone: { contains: input.search } },
    ];
  }
  switch (input.status) {
    case "PENDING_HIRE":
      where.bookings = { some: { status: PENDING_HIRE_STATUSES } };
      break;
    case "ACTIVE_RENTAL":
      where.bookings = { some: { status: { in: ["CHECKED_OUT", "ACTIVE", "OVERDUE"] } } };
      break;
    case "UNVERIFIED":
      where.customerProfile = { licenceVerifiedAt: null };
      break;
    case "LICENCE_EXPIRED":
      where.customerProfile = { licenceExpiry: { lt: now } };
      break;
    case "HIGH_RISK":
      where.customerProfile = { riskRating: "HIGH" };
      break;
    case "SUSPENDED":
      where.status = "SUSPENDED";
      break;
    case "ALL":
    default:
      break;
  }
  return where;
}

export const staffCustomerRouter = createTRPCRouter({
  list: staffProcedure
    .input(
      z.object({
        search: z.string().trim().optional(),
        status: z.enum(STATUS_FILTERS).default("ALL"),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(5).max(200).default(25),
        sortBy: z.enum(["name", "bookings", "createdAt"]).default("createdAt"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = buildCustomerListWhere(input, new Date());
      const orderBy: Prisma.UserOrderByWithRelationInput[] =
        input.sortBy === "name"
          ? [{ firstName: input.sortDir }, { lastName: input.sortDir }]
          : input.sortBy === "bookings"
          ? [{ bookings: { _count: input.sortDir } }]
          : [{ createdAt: input.sortDir }];
      const [items, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          include: { customerProfile: true, _count: { select: { bookings: true } } },
          orderBy,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);
      const pageCount = Math.max(1, Math.ceil(totalCount / input.pageSize));
      const normalised = items.map((u) => ({
        ...u,
        customerProfile: serializeCustomerProfile(u.customerProfile),
      }));
      return { items: normalised, totalCount, pageCount, page: input.page, pageSize: input.pageSize };
    }),

  // Lightweight search for autocomplete/picker UIs. Returns top-N matches
  // ordered by relevance (most-recently-created first), without the count()
  // round-trip that `list` runs for its DataTable. Callers that only need
  // "top N customers matching query" should use this, not `list`.
  search: staffProcedure
    .input(
      z.object({
        query: z.string().trim().min(1),
        take: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.user.findMany({
        where: {
          ...customerDirectoryUserWhere(),
          OR: [
            { email: { contains: input.query, mode: "insensitive" } },
            { firstName: { contains: input.query, mode: "insensitive" } },
            { lastName: { contains: input.query, mode: "insensitive" } },
            { phone: { contains: input.query } },
          ],
        },
        include: { customerProfile: true, _count: { select: { bookings: true } } },
        orderBy: { createdAt: "desc" },
        take: input.take,
      });
      const normalised = items.map((u) => ({
        ...u,
        customerProfile: serializeCustomerProfile(u.customerProfile),
      }));
      return { items: normalised };
    }),

  stats: staffProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const soon = new Date(now);
    soon.setDate(soon.getDate() + 30);
    // Directory membership predicate (cp.id IS NOT NULL) sourced from the
    // shared helper. Constant SQL with no user input, so Prisma.raw is safe;
    // reused across every FILTER clause below.
    const dir = Prisma.raw(CUSTOMER_DIRECTORY_SQL_PREDICATE);

    // Single round-trip: FILTER clauses over User LEFT JOIN CustomerProfile
    // for the user/profile-scoped metrics, plus two uncorrelated scalar
    // subqueries over Booking for the has-a-booking-in-status metrics.
    // Each aggregate/subquery picks its own plan; the wire-round-trip cost
    // is paid once instead of eight times.
    const rows = await ctx.prisma.$queryRaw<
      {
        total: bigint;
        verified: bigint;
        licenceExpired: bigint;
        licenceExpiringSoon: bigint;
        suspended: bigint;
        riskLow: bigint;
        riskMedium: bigint;
        riskHigh: bigint;
        pendingHire: bigint;
        activeRental: bigint;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE ${dir})
          AS "total",
        COUNT(*) FILTER (WHERE ${dir} AND cp."licenceVerifiedAt" IS NOT NULL)
          AS "verified",
        COUNT(*) FILTER (WHERE ${dir} AND cp."licenceExpiry" < ${now})
          AS "licenceExpired",
        COUNT(*) FILTER (WHERE ${dir} AND cp."licenceExpiry" >= ${now} AND cp."licenceExpiry" <= ${soon})
          AS "licenceExpiringSoon",
        COUNT(*) FILTER (WHERE ${dir} AND u.status = 'SUSPENDED')
          AS "suspended",
        COUNT(*) FILTER (WHERE ${dir} AND cp."riskRating" = 'LOW')
          AS "riskLow",
        COUNT(*) FILTER (WHERE ${dir} AND cp."riskRating" = 'MEDIUM')
          AS "riskMedium",
        COUNT(*) FILTER (WHERE ${dir} AND cp."riskRating" = 'HIGH')
          AS "riskHigh",
        (SELECT COUNT(DISTINCT b."customerId") FROM "Booking" b
          WHERE b.status IN ('PENDING_PAYMENT','CONFIRMED','CHECKED_OUT','ACTIVE','OVERDUE'))
          AS "pendingHire",
        (SELECT COUNT(DISTINCT b."customerId") FROM "Booking" b
          WHERE b.status IN ('CHECKED_OUT','ACTIVE','OVERDUE'))
          AS "activeRental"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
    `;
    const r = rows[0]!;
    const total = Number(r.total);
    const verified = Number(r.verified);
    return {
      total,
      verified,
      unverified: Math.max(0, total - verified),
      licenceExpired: Number(r.licenceExpired),
      licenceExpiringSoon: Number(r.licenceExpiringSoon),
      risk: {
        low: Number(r.riskLow),
        medium: Number(r.riskMedium),
        high: Number(r.riskHigh),
      },
      pendingHire: Number(r.pendingHire),
      activeRental: Number(r.activeRental),
      suspended: Number(r.suspended),
    };
  }),

  detail: staffProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: input.id },
      include: {
        customerProfile: true,
        bookings: {
          include: { category: true, pickupDepot: true, vehicle: true },
          orderBy: { pickupDateTime: "desc" },
          take: 20,
        },
      },
    });
    // Customer identity is profile-based: a back-office user who carries a
    // CustomerProfile is a valid customer detail page.
    if (!user || !user.customerProfile) throw new TRPCError({ code: "NOT_FOUND" });
    // Transparently decrypt PII fields before returning to the client.
    // Shape stays identical (plaintext string | null) so existing UI
    // code that reads `customerProfile.licenceNumber` keeps working;
    // it just gets the real value now regardless of how it's stored.
    if (user.customerProfile) {
      user.customerProfile.licenceNumber = readPiiField(
        user.customerProfile.licenceNumber,
        user.customerProfile.licenceNumberEnc,
      );
      user.customerProfile.passportNumber = readPiiField(
        user.customerProfile.passportNumber,
        user.customerProfile.passportNumberEnc,
      );
      // Reward counters (totalSpend / totalBookings / loyaltyPoints / tier) on the
      // profile are denormalized — only refreshed by the nightly rewards-recompute
      // and the booking-completion / no-show triggers. A customer whose only
      // bookings are in-flight (CONFIRMED/ACTIVE) would otherwise show stale zeros
      // on the detail card. Overlay a live, read-only snapshot so the card always
      // reflects truth; the persisted counters still serve the leaderboard.
      const rewards = await computeCustomerRewards(ctx.prisma, user.id);
      user.customerProfile.totalSpend = rewards.totalSpend;
      user.customerProfile.totalBookings = rewards.totalBookings;
      user.customerProfile.completedBookings = rewards.completedBookings;
      user.customerProfile.lastBookingAt = rewards.lastBookingAt;
      user.customerProfile.lifetimePoints = rewards.lifetimePoints;
      user.customerProfile.loyaltyPoints = rewards.loyaltyPoints;
      user.customerProfile.loyaltyTier = rewards.loyaltyTier;
    }
    return user;
  }),

  /**
   * Every AuditLog row attributable to this customer. Matches rows tagged
   * explicitly (entity='User', entityId=id) AND any AUTH / PAGE_VIEW row
   * where userId resolves to the customer, so login/logout/page-view events
   * show up even when their primary entity tag is 'Auth' or 'Page'.
   */
  activityLog: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        from: z.date().optional(),
        to: z.date().optional(),
        category: z.enum(AUDIT_CATEGORIES).optional(),
        status: z.enum(AUDIT_STATUSES).optional(),
        action: z.string().optional(),
        cursor: z.object({ timestamp: z.date(), id: z.string() }).optional(),
        take: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.AuditLogWhereInput = {
        AND: [
          buildAuditWhere(input),
          {
            OR: [
              { entity: "User", entityId: input.customerId },
              {
                userId: input.customerId,
                category: { in: ["AUTH", "PAGE_VIEW"] },
              },
            ],
          },
        ],
      };
      const rows = await ctx.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: input.take + 1,
      });
      const hasMore = rows.length > input.take;
      const page = hasMore ? rows.slice(0, input.take) : rows;
      const last = page[page.length - 1];
      return {
        rows: page,
        nextCursor: hasMore && last ? { timestamp: last.timestamp, id: last.id } : null,
      };
    }),

  verifyLicence: staffProcedure
    .input(z.object({ customerId: z.string(), verified: z.boolean() }))
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: {
          licenceVerifiedAt: input.verified ? new Date() : null,
          licenceVerifiedById: input.verified ? ctx.user.id : null,
        },
      });
      await trackServer({
        event: SERVER_EVENTS.licenceVerified,
        distinctId: input.customerId,
        properties: { verified: input.verified, actorUserId: ctx.user.id },
      });
      return { ok: true };
    }),

  /** Staff-confirms the passport matches in person. Mirrors verifyLicence —
   *  toggles the passportVerifiedAt/passportVerifiedById pair. */
  verifyPassport: staffProcedure
    .input(z.object({ customerId: z.string(), verified: z.boolean() }))
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: {
          passportVerifiedAt: input.verified ? new Date() : null,
          passportVerifiedById: input.verified ? ctx.user.id : null,
        },
      });
      return { ok: true };
    }),

  startLicenceVerification: staffProcedure
    .input(z.object({ customerId: z.string(), returnUrl: z.string().url() }))
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      const session = await createLicenceVerification({
        customerId: input.customerId,
        returnUrl: input.returnUrl,
      });
      const existing = await ctx.prisma.customerProfile.findUnique({
        where: { userId: input.customerId },
        select: { notes: true },
      });
      const noteLine = `[${new Date().toISOString()}] Stripe Identity verification started (session ${session.id})`;
      await ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: {
          notes: [existing?.notes, noteLine].filter(Boolean).join("\n"),
        },
      });
      await trackServer({
        event: SERVER_EVENTS.licenceVerificationStarted,
        distinctId: input.customerId,
        properties: { sessionId: session.id, method: "stripe_identity", actorUserId: ctx.user.id },
      });
      return session;
    }),

  refreshLicenceVerification: staffProcedure
    .input(z.object({ customerId: z.string(), sessionId: z.string() }))
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      const status = await getLicenceVerificationStatus(input.sessionId);
      if (status === "verified") {
        await ctx.prisma.customerProfile.update({
          where: { userId: input.customerId },
          data: {
            licenceVerifiedAt: new Date(),
            licenceVerifiedById: ctx.user.id,
          },
        });
      }
      await trackServer({
        event: SERVER_EVENTS.licenceVerificationRefreshed,
        distinctId: input.customerId,
        properties: { sessionId: input.sessionId, status, actorUserId: ctx.user.id },
      });
      return { status };
    }),

  addNote: staffProcedure
    .input(z.object({ customerId: z.string(), note: z.string().min(1) }))
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.customerProfile.findUniqueOrThrow({ where: { userId: input.customerId } });
      const appended = [existing.notes, `[${new Date().toISOString()}] ${ctx.user.name ?? ctx.user.email}: ${input.note}`]
        .filter(Boolean)
        .join("\n");
      await ctx.prisma.customerProfile.update({ where: { userId: input.customerId }, data: { notes: appended } });
      return { ok: true };
    }),

  setRiskRating: staffProcedure
    .input(z.object({ customerId: z.string(), riskRating: z.enum(["LOW", "MEDIUM", "HIGH"]) }))
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: { riskRating: input.riskRating },
      });
      return { ok: true };
    }),

  /**
   * Overwrite a customer's password. Staff-only, auditable. Used when a
   * customer can't complete self-serve reset (e.g. lost email access).
   * Only CUSTOMER-role accounts can be targeted from this procedure —
   * staff-on-staff password overrides belong in the admin router.
   */
  setCustomerPassword: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        password: strongPasswordField,
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.user.findUnique({
        where: { id: input.customerId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!target || target.deletedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }
      if (target.role !== "CUSTOMER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only customer passwords can be reset from this screen",
        });
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      await ctx.prisma.user.update({
        where: { id: target.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      return { ok: true };
    }),

  // Rental history — all bookings for this customer
  bookings: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.booking.findMany({
        where: { customerId: input.customerId },
        select: {
          id: true,
          bookingReference: true,
          status: true,
          pickupDateTime: true,
          returnDateTime: true,
          durationDays: true,
          totalAmount: true,
          category: { select: { id: true, name: true } },
          vehicle: { select: { id: true, make: true, model: true, rego: true } },
        },
        orderBy: { pickupDateTime: "desc" },
      });
      return rows.map((b) => ({ ...b, totalAmount: b.totalAmount.toNumber() }));
    }),

  // Transactions — payments linked to this customer
  transactions: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.payment.findMany({
        where: { customerId: input.customerId },
        include: { booking: { select: { bookingReference: true } } },
        orderBy: { createdAt: "desc" },
      });
    }),

  // Billing summary — powers the Billing tab. Consolidates per-booking
  // costings (total/paid/balance/overdue/extensions) + flat payment list +
  // top-level KPIs in one round-trip.
  billingSummary: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [bookings, transactions] = await Promise.all([
        ctx.prisma.booking.findMany({
          where: { customerId: input.customerId },
          select: {
            id: true,
            bookingReference: true,
            status: true,
            pickupDateTime: true,
            returnDateTime: true,
            actualReturnDateTime: true,
            totalAmount: true,
            amountPaid: true,
            balanceDue: true,
            overdueStage: true,
            extensionOfId: true,
            vehicle: { select: { id: true, make: true, model: true, rego: true } },
            extensionOf: { select: { id: true, bookingReference: true } },
            extensions: {
              select: {
                id: true,
                bookingReference: true,
                totalAmount: true,
                pickupDateTime: true,
                returnDateTime: true,
              },
              orderBy: { pickupDateTime: "asc" },
            },
          },
          orderBy: { pickupDateTime: "desc" },
        }),
        ctx.prisma.payment.findMany({
          where: { customerId: input.customerId },
          include: { booking: { select: { bookingReference: true } } },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      // Summary tiles. Exclude QUOTE, CANCELLED, NO_SHOW from outstanding
      // and active counts — those aren't monetary commitments owed.
      const EXCLUDED_FROM_OUTSTANDING = new Set(["QUOTE", "CANCELLED", "NO_SHOW"]);
      const ACTIVE_STATUSES = new Set(["CONFIRMED", "CHECKED_OUT", "ACTIVE"]);

      let lifetimeSpend = 0;
      let totalOutstanding = 0;
      let overdueBalance = 0;
      let activeRentalCount = 0;
      let overdueCount = 0;
      for (const b of bookings) {
        lifetimeSpend += b.amountPaid.toNumber();
        if (!EXCLUDED_FROM_OUTSTANDING.has(b.status)) {
          totalOutstanding += b.balanceDue.toNumber();
        }
        if (ACTIVE_STATUSES.has(b.status)) activeRentalCount += 1;
        if (b.status === "OVERDUE") {
          overdueCount += 1;
          overdueBalance += b.balanceDue.toNumber();
        }
      }

      return {
        summary: {
          lifetimeSpend,
          totalOutstanding,
          activeRentalCount,
          overdueCount,
          overdueBalance,
        },
        bookings: bookings.map((b) => ({
          ...b,
          totalAmount: b.totalAmount.toNumber(),
          amountPaid: b.amountPaid.toNumber(),
          balanceDue: b.balanceDue.toNumber(),
          extensions: b.extensions.map((e) => ({
            ...e,
            totalAmount: e.totalAmount.toNumber(),
          })),
        })),
        transactions: transactions.map((t) => ({
          ...t,
          amount: t.amount.toNumber(),
          gstAmount: t.gstAmount.toNumber(),
        })),
      };
    }),

  // Infringements linked to this customer via bookings
  infringements: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.infringement.findMany({
        where: { booking: { customerId: input.customerId } },
        include: {
          vehicle: { select: { internalCode: true, rego: true } },
          booking: { select: { bookingReference: true } },
        },
        orderBy: { offenceDate: "desc" },
      });
    }),

  // Tolls (Infringement.type = TOLL) attributed to this customer.
  // Joins the linked INFRINGEMENT_RECOVERY Payment so the UI can render
  // an accurate paid/unpaid badge derived from Payment.status. Matches
  // both bookings linked to the customer AND infringements pointed at
  // the customer directly (e.g. an orphan toll resolved against the
  // customer without a booking).
  tolls: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const tolls = await ctx.prisma.infringement.findMany({
        where: {
          type: "TOLL",
          deletedAt: null,
          OR: [
            { customerId: input.customerId },
            { booking: { customerId: input.customerId } },
          ],
        },
        include: {
          vehicle: { select: { internalCode: true, rego: true } },
          booking: { select: { id: true, bookingReference: true } },
        },
        orderBy: { offenceDate: "desc" },
      });
      if (tolls.length === 0) return [];

      const refs = tolls.map((t) => `INFR-${t.referenceNumber}`);
      const payments = await ctx.prisma.payment.findMany({
        where: { reference: { in: refs }, type: "INFRINGEMENT_RECOVERY" },
        select: {
          id: true,
          reference: true,
          status: true,
          amount: true,
          createdAt: true,
          processedAt: true,
        },
      });
      const paymentByRef = new Map(payments.map((p) => [p.reference, p]));

      return tolls.map((t) => {
        const payment = paymentByRef.get(`INFR-${t.referenceNumber}`) ?? null;
        return {
          id: t.id,
          referenceNumber: t.referenceNumber,
          issuer: t.issuer,
          offenceDate: t.offenceDate,
          amount: Number(t.amount),
          adminFee: Number(t.adminFee),
          status: t.status,
          notes: t.notes,
          vehicle: t.vehicle,
          booking: t.booking,
          payment: payment
            ? {
                id: payment.id,
                status: payment.status,
                amount: Number(payment.amount),
                createdAt: payment.createdAt,
                processedAt: payment.processedAt,
              }
            : null,
        };
      });
    }),

  // Incidents (accidents) linked to this customer
  incidents: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.incident.findMany({
        where: { customerId: input.customerId },
        include: {
          vehicle: { select: { internalCode: true, rego: true } },
          booking: { select: { bookingReference: true } },
          photos: true,
        },
        orderBy: { dateTime: "desc" },
      });
    }),

  // Communication log (SMS, emails) for this customer
  communications: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.communicationLog.findMany({
        where: { customerId: input.customerId },
        orderBy: { sentAt: "desc" },
      });
    }),

  // Inspections linked to this customer's bookings (logbook)
  inspections: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.inspection.findMany({
        where: { booking: { customerId: input.customerId } },
        include: {
          vehicle: { select: { internalCode: true, rego: true } },
          booking: { select: { bookingReference: true } },
          inspector: { select: { firstName: true, lastName: true } },
        },
        orderBy: { dateTime: "desc" },
      });
    }),

  // All documents associated with this customer — CustomerDocument rows
  // plus the single-slot profile fields (licence front/back, passport,
  // signature) that pre-date the generic documents table.
  documents: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [docs, profile] = await Promise.all([
        ctx.prisma.customerDocument.findMany({
          where: { customerId: input.customerId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            type: true,
            fileUrl: true,
            label: true,
            expiryDate: true,
            notes: true,
            metadata: true,
            createdAt: true,
          },
        }),
        ctx.prisma.customerProfile.findUnique({
          where: { userId: input.customerId },
          select: {
            licenceImageFront: true,
            licenceImageBack: true,
            passportImage: true,
            signatureImage: true,
            licenceExpiry: true,
            passportExpiry: true,
          },
        }),
      ]);

      type DocRow = {
        id: string;
        source: "document" | "profile";
        profileSlot: string | null;
        type: string;
        label: string | null;
        url: string;
        expiryDate: Date | null;
        notes: string | null;
        createdAt: Date | null;
        detection:
          | (DetectedLicenceMetadata & { faceImageUrl: string | null })
          | (DetectedPassportMetadata & { faceImageUrl: null })
          | null;
      };

      const resolvedDocs: DocRow[] = await Promise.all(
        docs.map(async (d) => {
          const meta = d.metadata as
            | DetectedLicenceMetadata
            | DetectedPassportMetadata
            | null;
          let detection: DocRow["detection"] = null;
          if (meta?.kind === "licence") {
            detection = {
              ...meta,
              faceImageUrl: meta.faceImageKey
                ? await resolveStorageUrl(meta.faceImageKey)
                : null,
            };
          } else if (meta?.kind === "passport") {
            detection = {
              ...meta,
              faceImageUrl: null,
            };
          }
          return {
            id: d.id,
            source: "document" as const,
            profileSlot: null,
            type: d.type,
            label: d.label,
            url: await resolveStorageUrl(d.fileUrl),
            expiryDate: d.expiryDate,
            notes: d.notes,
            createdAt: d.createdAt,
            detection,
          };
        }),
      );

      const profileRows: DocRow[] = [];
      async function addProfileRow(
        slot: "licenceImageFront" | "licenceImageBack" | "passportImage" | "signatureImage",
        type: string,
        label: string,
        expiry: Date | null,
      ) {
        const key = profile?.[slot];
        if (!key) return;
        profileRows.push({
          id: `profile:${slot}`,
          source: "profile",
          profileSlot: slot,
          type,
          label,
          url: await resolveStorageUrl(key),
          expiryDate: expiry,
          notes: null,
          createdAt: null,
          detection: null,
        });
      }

      await addProfileRow("licenceImageFront", "LICENCE_FRONT", "Licence — front", profile?.licenceExpiry ?? null);
      await addProfileRow("licenceImageBack", "LICENCE_BACK", "Licence — back", profile?.licenceExpiry ?? null);
      await addProfileRow("passportImage", "PASSPORT", "Passport", profile?.passportExpiry ?? null);
      await addProfileRow("signatureImage", "OTHER", "Signature", null);

      return [...resolvedDocs, ...profileRows];
    }),

  addDocument: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        type: z.enum([
          "PASSPORT",
          "PASSPORT_STYLE_DL",
          "LICENCE_FRONT",
          "LICENCE_BACK",
          "VISA",
          "INTL_DRIVING_PERMIT",
          "PROOF_OF_ADDRESS",
          "OTHER",
        ]),
        fileUrl: z.string().min(1),
        label: z.string().max(200).optional().nullable(),
        expiryDate: z.string().optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const created = await tx.customerDocument.create({
          data: {
            customerId: input.customerId,
            type: input.type,
            fileUrl: input.fileUrl,
            label: input.label || null,
            expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
            notes: input.notes || null,
            uploadedById: ctx.user.id,
          },
          select: { id: true },
        });
        // Newest-wins invariant: project this type back onto the profile
        // cache columns so eligibility + check-out see the latest image.
        if (isProjectableIdentityType(input.type)) {
          await applyLatestDocumentToProfile(tx, input.customerId, input.type);
        }
        return created;
      });
    }),

  updateDocument: staffProcedure
    .input(
      z.object({
        documentId: z.string(),
        type: z
          .enum([
            "PASSPORT",
            "PASSPORT_STYLE_DL",
            "LICENCE_FRONT",
            "LICENCE_BACK",
            "VISA",
            "INTL_DRIVING_PERMIT",
            "PROOF_OF_ADDRESS",
            "OTHER",
          ])
          .optional(),
        label: z.string().max(200).optional().nullable(),
        expiryDate: z.string().optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const { documentId, ...rest } = input;
      const existing = await ctx.prisma.customerDocument.findUnique({
        where: { id: documentId },
        select: { customerId: true },
      });
      captureCustomerId(ctx, existing?.customerId);
      const data: Prisma.CustomerDocumentUpdateInput = {};
      if (rest.type !== undefined) data.type = rest.type;
      if (rest.label !== undefined) data.label = rest.label || null;
      if (rest.expiryDate !== undefined)
        data.expiryDate = rest.expiryDate ? new Date(rest.expiryDate) : null;
      if (rest.notes !== undefined) data.notes = rest.notes || null;
      await ctx.prisma.customerDocument.update({
        where: { id: documentId },
        data,
      });
      return { ok: true };
    }),

  deleteDocument: staffProcedure
    .input(z.object({ documentId: z.string() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.customerDocument.findUnique({
        where: { id: input.documentId },
        select: { customerId: true, type: true },
      });
      captureCustomerId(ctx, existing?.customerId);
      await ctx.prisma.$transaction(async (tx) => {
        await tx.customerDocument.delete({ where: { id: input.documentId } });
        // Recompute the projection — when the deleted row was the newest,
        // the next-newest (or null) becomes the profile cache value.
        if (existing && isProjectableIdentityType(existing.type)) {
          await applyLatestDocumentToProfile(tx, existing.customerId, existing.type);
        }
      });
      return { ok: true };
    }),

  /**
   * Run Claude vision on an identity document. Persists the detection
   * payload on `CustomerDocument.metadata`. For LICENCE_FRONT /
   * PASSPORT_STYLE_DL, also crops + uploads a face thumbnail. Empty
   * CustomerProfile fields are filled from the detection; staff-entered
   * values are never overwritten.
   */
  detectDocument: staffProcedure
    .input(z.object({ documentId: z.string() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.prisma.customerDocument.findUnique({
        where: { id: input.documentId },
        select: { id: true, customerId: true, type: true, fileUrl: true, expiryDate: true },
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      captureCustomerId(ctx, doc.customerId);
      const allowedTypes = ["LICENCE_FRONT", "PASSPORT_STYLE_DL", "PASSPORT"];
      if (!allowedTypes.includes(doc.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Detection only runs on licence or passport documents.",
        });
      }

      const key = doc.fileUrl.startsWith("/uploads/")
        ? doc.fileUrl.slice("/uploads/".length)
        : doc.fileUrl;
      const buffer = await downloadFile(key);

      // Passport branch — no face-crop (different photo position), no
      // licence-class / address extraction, just the identity fields we
      // project onto the profile passport triplet.
      if (doc.type === "PASSPORT") {
        const detection = await extractPassportData(buffer, {
          log: {
            prisma: ctx.prisma,
            customerId: doc.customerId,
            triggeredById: ctx.user.id,
          },
        });
        if (detection.confidence === 0) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: "Couldn't read the passport — try a clearer image.",
          });
        }

        const metadata: DetectedPassportMetadata = {
          kind: "passport",
          detectedAt: new Date().toISOString(),
          detectedById: ctx.user.id,
          confidence: detection.confidence,
          ...(detection.passportNumber ? { passportNumber: detection.passportNumber } : {}),
          ...(detection.country ? { country: detection.country } : {}),
          ...(detection.firstName ? { firstName: detection.firstName } : {}),
          ...(detection.lastName ? { lastName: detection.lastName } : {}),
          ...(detection.dateOfBirth
            ? { dateOfBirth: detection.dateOfBirth.toISOString().slice(0, 10) }
            : {}),
          ...(detection.expiryDate
            ? { expiryDate: detection.expiryDate.toISOString().slice(0, 10) }
            : {}),
        };

        const shouldFillDocExpiry = !doc.expiryDate && !!detection.expiryDate;
        const appliedFields: string[] = [];
        if (shouldFillDocExpiry) appliedFields.push("documentExpiryDate");

        await ctx.prisma.$transaction(async (tx) => {
          await tx.customerDocument.update({
            where: { id: doc.id },
            data: {
              metadata: metadata as unknown as Prisma.InputJsonValue,
              ...(shouldFillDocExpiry ? { expiryDate: detection.expiryDate } : {}),
            },
          });

          // Fill empty passport profile fields (never overwrite).
          const profile = await tx.customerProfile.findUnique({
            where: { userId: doc.customerId },
            select: {
              passportNumber: true,
              passportNumberEnc: true,
              passportCountry: true,
              passportExpiry: true,
            },
          });
          if (profile) {
            const profileUpdate: Prisma.CustomerProfileUpdateInput = {};
            const existingNumber = profile.passportNumber || profile.passportNumberEnc;
            if (!existingNumber && detection.passportNumber) {
              Object.assign(
                profileUpdate,
                writePiiField("passportNumber", "passportNumberEnc", detection.passportNumber),
              );
              appliedFields.push("passportNumber");
            }
            if (!profile.passportCountry && detection.country) {
              profileUpdate.passportCountry = detection.country;
              appliedFields.push("passportCountry");
            }
            if (!profile.passportExpiry && detection.expiryDate) {
              profileUpdate.passportExpiry = detection.expiryDate;
              appliedFields.push("passportExpiry");
            }
            if (Object.keys(profileUpdate).length > 0) {
              await tx.customerProfile.update({
                where: { userId: doc.customerId },
                data: profileUpdate,
              });
            }
          }

          // Re-run the newest-wins projection so passportImage picks up
          // this row if it's the latest.
          await applyLatestDocumentToProfile(tx, doc.customerId, "PASSPORT");
        });

        const inDate = detection.expiryDate ? detection.expiryDate > new Date() : false;
        return {
          metadata,
          faceImageUrl: null,
          inDate,
          appliedFields,
        };
      }

      const detection = await extractLicenceData(buffer, {
        log: {
          prisma: ctx.prisma,
          customerId: doc.customerId,
          triggeredById: ctx.user.id,
        },
      });

      if (detection.confidence === 0) {
        throw new TRPCError({
          code: "UNPROCESSABLE_CONTENT",
          message: "Couldn't read the licence — try a clearer image.",
        });
      }

      let faceImageKey: string | undefined;
      let faceImageUrl: string | undefined;
      if (detection.faceBoundingBox) {
        try {
          const face = await cropImageRegion(buffer, detection.faceBoundingBox, {
            maxWidth: 400,
            maxHeight: 400,
            quality: 85,
          });
          const uploaded = await uploadFile({
            folder: `drivers/${doc.customerId}/faces`,
            filename: `${doc.id}.jpg`,
            contentType: "image/jpeg",
            body: face.buffer,
          });
          faceImageKey = uploaded.key;
          faceImageUrl = uploaded.url;
        } catch {
          // Face crop is best-effort; if sharp can't extract, we still
          // keep the rest of the detection payload.
        }
      }

      const metadata: DetectedLicenceMetadata = {
        kind: "licence",
        detectedAt: new Date().toISOString(),
        detectedById: ctx.user.id,
        confidence: detection.confidence,
        ...(detection.licenceNumber ? { licenceNumber: detection.licenceNumber } : {}),
        ...(detection.state ? { state: detection.state } : {}),
        ...(detection.firstName ? { firstName: detection.firstName } : {}),
        ...(detection.lastName ? { lastName: detection.lastName } : {}),
        ...(detection.dateOfBirth
          ? { dateOfBirth: detection.dateOfBirth.toISOString().slice(0, 10) }
          : {}),
        ...(detection.expiryDate
          ? { expiryDate: detection.expiryDate.toISOString().slice(0, 10) }
          : {}),
        ...(detection.licenceClass ? { licenceClass: detection.licenceClass } : {}),
        ...(detection.conditions ? { conditions: detection.conditions } : {}),
        ...(detection.country ? { country: detection.country } : {}),
        ...(detection.addressLine1 ? { addressLine1: detection.addressLine1 } : {}),
        ...(detection.addressLine2 ? { addressLine2: detection.addressLine2 } : {}),
        ...(detection.suburb ? { suburb: detection.suburb } : {}),
        ...(detection.addressState ? { addressState: detection.addressState } : {}),
        ...(detection.postcode ? { postcode: detection.postcode } : {}),
        ...(detection.faceBoundingBox ? { faceBoundingBox: detection.faceBoundingBox } : {}),
        ...(faceImageKey ? { faceImageKey } : {}),
      };

      const shouldFillDocExpiry = !doc.expiryDate && !!detection.expiryDate;
      await ctx.prisma.customerDocument.update({
        where: { id: doc.id },
        data: {
          metadata: metadata as unknown as Prisma.InputJsonValue,
          ...(shouldFillDocExpiry ? { expiryDate: detection.expiryDate } : {}),
        },
      });

      // Use the detected face as the customer's avatar. Set it when empty
      // OR when the existing value is one of OUR detector-generated crops
      // (so Re-run detect refreshes the avatar after we tighten the crop).
      // A user- or staff-chosen avatar is never overwritten.
      if (faceImageUrl) {
        const existing = await ctx.prisma.user.findUnique({
          where: { id: doc.customerId },
          select: { avatarUrl: true },
        });
        const currentlyDetectorCrop =
          !!existing?.avatarUrl && existing.avatarUrl.includes(`/drivers/${doc.customerId}/faces/`);
        if (!existing?.avatarUrl || currentlyDetectorCrop) {
          await ctx.prisma.user.update({
            where: { id: doc.customerId },
            data: { avatarUrl: faceImageUrl },
          });
        }
      }

      // Fill any empty profile field that the detector returned a value for.
      // We never overwrite staff-entered values, and we don't auto-verify the
      // licence — `licenceVerifiedAt` stays null until staff tick it. Expired
      // licences still auto-fill: their number/class/address are a fine source
      // of truth for the profile, they're just not valid for check-out.
      const inDate = detection.expiryDate ? detection.expiryDate > new Date() : false;
      const appliedFields: string[] = [];
      if (shouldFillDocExpiry) appliedFields.push("documentExpiryDate");
      const profile = await ctx.prisma.customerProfile.findUnique({
        where: { userId: doc.customerId },
        select: {
          licenceNumber: true,
          licenceState: true,
          licenceExpiry: true,
          licenceClass: true,
          addressLine1: true,
          addressLine2: true,
          suburb: true,
          state: true,
          postcode: true,
          country: true,
        },
      });
      if (profile) {
        const profileUpdate: Prisma.CustomerProfileUpdateInput = {};
        if (!profile.licenceNumber && detection.licenceNumber) {
          profileUpdate.licenceNumber = detection.licenceNumber;
          appliedFields.push("licenceNumber");
        }
        if (!profile.licenceState && detection.state) {
          profileUpdate.licenceState = detection.state;
          appliedFields.push("licenceState");
        }
        if (!profile.licenceExpiry && detection.expiryDate) {
          profileUpdate.licenceExpiry = detection.expiryDate;
          appliedFields.push("licenceExpiry");
        }
        if (!profile.licenceClass && detection.licenceClass) {
          profileUpdate.licenceClass = detection.licenceClass;
          appliedFields.push("licenceClass");
        }
        if (!profile.addressLine1 && detection.addressLine1) {
          profileUpdate.addressLine1 = detection.addressLine1;
          appliedFields.push("addressLine1");
        }
        if (!profile.addressLine2 && detection.addressLine2) {
          profileUpdate.addressLine2 = detection.addressLine2;
          appliedFields.push("addressLine2");
        }
        if (!profile.suburb && detection.suburb) {
          profileUpdate.suburb = detection.suburb;
          appliedFields.push("suburb");
        }
        if (!profile.state && detection.addressState) {
          profileUpdate.state = detection.addressState;
          appliedFields.push("state");
        }
        if (!profile.postcode && detection.postcode) {
          profileUpdate.postcode = detection.postcode;
          appliedFields.push("postcode");
        }
        // country has a DB default of "Australia" — only overwrite when the
        // detector found a non-Australian issuing country, otherwise we'd
        // spam appliedFields with a no-op on every run.
        if (
          detection.country &&
          (!profile.country || profile.country === "Australia") &&
          detection.country !== profile.country
        ) {
          profileUpdate.country = detection.country;
          appliedFields.push("country");
        }
        if (Object.keys(profileUpdate).length > 0) {
          await ctx.prisma.customerProfile.update({
            where: { userId: doc.customerId },
            data: profileUpdate,
          });
        }
      }

      return {
        metadata,
        faceImageUrl: faceImageKey ? await resolveStorageUrl(faceImageKey) : null,
        inDate,
        appliedFields,
      };
    }),

  /**
   * Clear one of the profile-level image slots (licence front/back,
   * passport, signature). The slot fields pre-date CustomerDocument rows
   * and many legacy-migrated customers keep their signature only here.
   */
  clearProfileImage: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        slot: z.enum([
          "licenceImageFront",
          "licenceImageBack",
          "passportImage",
          "signatureImage",
        ]),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: { [input.slot]: null },
      });
      return { ok: true };
    }),

  /**
   * Rotate a stored document image 90° clockwise and persist the result
   * to a new storage key. Driven by the rotate button on document cards
   * so staff can correct sideways phone uploads in-place — repeated
   * clicks step through the four orientations.
   */
  rotateDocument: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        target: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("document"), documentId: z.string() }),
          z.object({
            kind: z.literal("profile"),
            slot: z.enum([
              "licenceImageFront",
              "licenceImageBack",
              "passportImage",
              "signatureImage",
            ]),
          }),
        ]),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      let currentRef: string;
      if (input.target.kind === "document") {
        const doc = await ctx.prisma.customerDocument.findUnique({
          where: { id: input.target.documentId },
          select: { customerId: true, fileUrl: true },
        });
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        if (doc.customerId !== input.customerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Document does not belong to this customer." });
        }
        currentRef = doc.fileUrl;
      } else {
        const profile = await ctx.prisma.customerProfile.findUnique({
          where: { userId: input.customerId },
          select: {
            licenceImageFront: true,
            licenceImageBack: true,
            passportImage: true,
            signatureImage: true,
          },
        });
        const value = profile?.[input.target.slot];
        if (!value) throw new TRPCError({ code: "NOT_FOUND", message: "No image in this profile slot." });
        currentRef = value;
      }

      if (!isImageRef(currentRef)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only image files can be rotated.",
        });
      }

      const currentKey = keyFromStorageRef(currentRef);
      const folder = currentKey.includes("/")
        ? currentKey.slice(0, currentKey.lastIndexOf("/"))
        : "customer-documents";

      const buffer = await downloadFile(currentKey);
      const rotated = await rotateImage(buffer, 90);
      const uploaded = await uploadFile({
        folder,
        contentType: rotated.contentType,
        body: rotated.buffer,
      });

      if (input.target.kind === "document") {
        await ctx.prisma.customerDocument.update({
          where: { id: input.target.documentId },
          data: {
            fileUrl: uploaded.url,
            // Detection bounding boxes are normalised to the source
            // image's pixel grid; rotating invalidates them.
            metadata: Prisma.DbNull,
          },
        });
      } else {
        await ctx.prisma.customerProfile.update({
          where: { userId: input.customerId },
          data: { [input.target.slot]: uploaded.url },
        });
      }

      // Best-effort: the new key is already persisted, so an orphan
      // blob is the worst case if cleanup fails.
      try {
        await deleteFile(currentKey);
      } catch {
        // swallow
      }

      return { ok: true };
    }),

  // Update customer profile fields
  updateProfile: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        phone: z.string().optional(),
        dateOfBirth: z.string().optional(),
        email: z.string().email().optional(),
        addressLine1: z.string().optional(),
        addressLine2: z.string().optional(),
        suburb: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),
        licenceNumber: z.string().optional(),
        licenceState: z.string().optional(),
        licenceExpiry: z.string().optional(),
        licenceClass: z.string().optional(),
        passportNumber: z.string().optional(),
        passportCountry: z.string().optional(),
        passportExpiry: z.string().optional(),
        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
        companyName: z.string().max(120).optional(),
        abn: z
          .string()
          .optional()
          .refine(
            (v) => v == null || v === "" || /^\d{11}$/.test(v.replace(/\D/g, "")),
            { message: "ABN must be 11 digits." },
          )
          .transform((v) => (v ? v.replace(/\D/g, "") : v)),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      const { customerId, firstName, lastName, phone, dateOfBirth, email, ...profileFields } = input;
      const userData: Record<string, unknown> = {};
      if (firstName !== undefined) userData.firstName = firstName;
      if (lastName !== undefined) userData.lastName = lastName;
      if (phone !== undefined) userData.phone = phone;
      if (email !== undefined) userData.email = email;
      if (dateOfBirth !== undefined) userData.dateOfBirth = new Date(dateOfBirth);

      // Snapshot the existing values BEFORE we update so the customer
      // notification can render a "Was → Now" diff. We only need the
      // fields that actually change, but it's cheaper to fetch them all
      // in one round-trip than to build a dynamic select.
      const previousSnapshot = await ctx.prisma.user.findUnique({
        where: { id: customerId },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          dateOfBirth: true,
          customerProfile: {
            select: {
              addressLine1: true,
              addressLine2: true,
              suburb: true,
              state: true,
              postcode: true,
              country: true,
              emergencyContactName: true,
              emergencyContactPhone: true,
              companyName: true,
              abn: true,
              licenceNumber: true,
              licenceState: true,
              licenceExpiry: true,
              licenceClass: true,
              passportNumber: true,
              passportCountry: true,
              passportExpiry: true,
            },
          },
        },
      });

      if (Object.keys(userData).length > 0) {
        await ctx.prisma.user.update({ where: { id: customerId }, data: userData });
      }

      const profileData: Record<string, unknown> = {};
      if (profileFields.licenceExpiry !== undefined) {
        profileData.licenceExpiry = new Date(profileFields.licenceExpiry);
      }
      if (profileFields.licenceState !== undefined) profileData.licenceState = profileFields.licenceState;
      if (profileFields.licenceClass !== undefined) profileData.licenceClass = profileFields.licenceClass;
      if (profileFields.addressLine1 !== undefined) profileData.addressLine1 = profileFields.addressLine1;
      if (profileFields.addressLine2 !== undefined) profileData.addressLine2 = profileFields.addressLine2;
      if (profileFields.suburb !== undefined) profileData.suburb = profileFields.suburb;
      if (profileFields.state !== undefined) profileData.state = profileFields.state;
      if (profileFields.postcode !== undefined) profileData.postcode = profileFields.postcode;
      if (profileFields.country !== undefined) profileData.country = profileFields.country;
      if (profileFields.emergencyContactName !== undefined)
        profileData.emergencyContactName = profileFields.emergencyContactName;
      if (profileFields.emergencyContactPhone !== undefined)
        profileData.emergencyContactPhone = profileFields.emergencyContactPhone;
      if (profileFields.companyName !== undefined) {
        profileData.companyName = profileFields.companyName || null;
      }
      if (profileFields.abn !== undefined) {
        profileData.abn = profileFields.abn ? profileFields.abn.replace(/\D/g, "") : null;
      }
      // PII: route licence number through the encryption helper so new
      // writes land in the *Enc column and clear the plaintext. The read
      // path (detail query above) transparently decrypts.
      if (profileFields.licenceNumber !== undefined) {
        Object.assign(
          profileData,
          writePiiField(
            "licenceNumber",
            "licenceNumberEnc",
            profileFields.licenceNumber || null,
          ),
        );
      }
      // Passport fields — same pattern as licence. Country is free-text.
      if (profileFields.passportCountry !== undefined) {
        profileData.passportCountry = profileFields.passportCountry || null;
      }
      if (profileFields.passportExpiry !== undefined) {
        profileData.passportExpiry = profileFields.passportExpiry
          ? new Date(profileFields.passportExpiry)
          : null;
      }
      if (profileFields.passportNumber !== undefined) {
        Object.assign(
          profileData,
          writePiiField(
            "passportNumber",
            "passportNumberEnc",
            profileFields.passportNumber || null,
          ),
        );
      }

      if (Object.keys(profileData).length > 0) {
        await ctx.prisma.customerProfile.update({
          where: { userId: customerId },
          data: profileData,
        });
      }

      const changedFields = [...Object.keys(userData), ...Object.keys(profileData)];
      if (changedFields.length > 0) {
        const { sendNotification } = await import("@/server/services/notification-sender");
        const { getBranding } = await import("@/lib/branding");
        const { siteName } = await getBranding();
        const { default: ProfileUpdatedEmail } = await import(
          "../../../../emails/profile-updated"
        );
        const { render: renderEmail } = await import("@react-email/render");
        const { createElement } = await import("react");
        const { buildProfileChangeRows } = await import("@/lib/profile-change-display");

        // Build the customer-facing diff payload from the pre-update
        // snapshot. previousData mirrors the audit-side snapshot but is
        // formatted for human reading by the email helper.
        const previousData: Record<string, unknown> = {};
        const newData: Record<string, unknown> = {};
        const prevUser = (previousSnapshot ?? {}) as Record<string, unknown>;
        const prevProfile =
          (previousSnapshot?.customerProfile ?? {}) as Record<string, unknown>;
        for (const k of Object.keys(userData)) {
          previousData[k] = prevUser[k] ?? null;
          newData[k] = userData[k];
        }
        for (const k of Object.keys(profileData)) {
          // Skip the *Enc companion column — buildProfileChangeRows
          // collapses it onto the human-readable field name.
          if (k === "licenceNumberEnc" || k === "passportNumberEnc") continue;
          previousData[k] = prevProfile[k] ?? null;
          newData[k] = profileData[k];
        }

        const changes = buildProfileChangeRows({ previousData, newData });
        const [recipient, staff] = await Promise.all([
          ctx.prisma.user.findUnique({
            where: { id: customerId },
            select: { firstName: true },
          }),
          ctx.prisma.user.findUnique({
            where: { id: ctx.user.id },
            select: { firstName: true, lastName: true },
          }),
        ]);
        const staffName = staff
          ? [staff.firstName, staff.lastName].filter(Boolean).join(" ").trim() || null
          : null;
        const html = await renderEmail(
          createElement(ProfileUpdatedEmail, {
            customerName: recipient?.firstName ?? "there",
            actor: "staff",
            staffName,
            changes,
            siteName,
          }),
        );
        await sendNotification({
          userId: customerId,
          type: "PROFILE_UPDATED_STAFF",
          channels: ["EMAIL"],
          subject: `Your ${siteName} profile was updated`,
          title: "Profile updated by staff",
          body:
            `${staffName ?? "Our team"} updated ${changes.length} field(s) on your account: ` +
            changes.map((c) => `${c.label}: ${c.previous} → ${c.current}`).join("; ") +
            `. If this wasn't expected, please contact us immediately.`,
          html,
          templateKey: "profile-updated",
          data: { fields: changedFields, staffId: ctx.user.id },
          sentById: ctx.user.id,
        });
      }

      return { ok: true };
    }),

  quickCreate: staffProcedure
    .input(
      z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().optional(),
        licenceNumber: z.string().optional(),
        licenceState: z.string().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.user.findUnique({ where: { email: input.email } });
      if (existing) {
        captureCustomerId(ctx, existing.id);
        return existing;
      }
      const user = await ctx.prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          role: "CUSTOMER",
          customerProfile: {
            create: {
              licenceNumber: input.licenceNumber,
              licenceState: input.licenceState,
            },
          },
        },
      });
      captureCustomerId(ctx, user.id);
      return user;
    }),

  createDetailed: staffProcedure
    .input(
      z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        dateOfBirth: z.string().optional(),

        addressLine1: z.string().optional(),
        addressLine2: z.string().optional(),
        suburb: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),

        isInternational: z.boolean().default(false),
        licenceNumber: z.string().optional(),
        licenceState: z.string().optional(),
        licenceClass: z.string().optional(),
        licenceExpiry: z.string().optional(),
        licenceImageFront: z.string().optional(),
        licenceImageBack: z.string().optional(),

        passportNumber: z.string().optional(),
        passportCountry: z.string().optional(),
        passportExpiry: z.string().optional(),
        passportImage: z.string().optional(),

        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
        emergencyContactRelationship: z.string().optional(),

        termsAccepted: z.boolean(),
        privacyAccepted: z.boolean(),
        marketingEmailOptIn: z.boolean().default(false),
        marketingSmsOptIn: z.boolean().default(false),

        staffNote: z.string().optional(),

        documents: z
          .array(
            z.object({
              type: z.enum([
                "PASSPORT",
                "LICENCE_FRONT",
                "LICENCE_BACK",
                "VISA",
                "INTL_DRIVING_PERMIT",
                "PROOF_OF_ADDRESS",
                "OTHER",
              ]),
              fileUrl: z.string().min(1),
              label: z.string().optional(),
              expiryDate: z.string().optional(),
            }),
          )
          .default([]),

        // Primary signature captured during the consent flow — stored on
        // CustomerProfile.signatureImage so future agreements can reuse it.
        signatureImage: z.string().optional(),

        // Photo taken during onboarding. URL or relative /uploads path;
        // also mirrored to User.avatarUrl so it appears throughout the UI.
        customerPhotoUrl: z.string().optional(),

        // Signed consent PDFs produced via `generateConsentPdf` earlier in
        // the wizard. Each becomes a CONSENT_* CustomerDocument row.
        signedConsents: z
          .array(
            z.object({
              docKey: z.enum(["TERMS", "PRIVACY", "CANCELLATION", "MARKETING"]),
              fileUrl: z.string().min(1),
              fileKey: z.string().min(1),
              docVersion: z.string().min(1),
              signedAt: z.string().datetime(),
            }),
          )
          .default([]),
      })
      .refine((v) => v.termsAccepted, { path: ["termsAccepted"], message: "Terms must be accepted" })
      .refine((v) => v.privacyAccepted, { path: ["privacyAccepted"], message: "Privacy policy must be accepted" }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists" });
      }

      const now = new Date();
      const termsConsent = input.signedConsents.find((c) => c.docKey === "TERMS");
      const privacyConsent = input.signedConsents.find((c) => c.docKey === "PRIVACY");
      const user = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
            avatarUrl: input.customerPhotoUrl,
            role: "CUSTOMER",
            customerProfile: {
              create: {
                licenceNumber: input.licenceNumber,
                licenceState: input.licenceState,
                licenceClass: input.licenceClass,
                licenceExpiry: input.licenceExpiry ? new Date(input.licenceExpiry) : undefined,
                licenceImageFront: input.licenceImageFront,
                licenceImageBack: input.licenceImageBack,
                passportNumber: input.passportNumber,
                passportCountry: input.passportCountry,
                passportExpiry: input.passportExpiry ? new Date(input.passportExpiry) : undefined,
                passportImage: input.passportImage,
                addressLine1: input.addressLine1,
                addressLine2: input.addressLine2,
                suburb: input.suburb,
                state: input.state,
                postcode: input.postcode,
                country: input.country || "Australia",
                emergencyContactName: input.emergencyContactName,
                emergencyContactPhone: input.emergencyContactPhone,
                emergencyContactRelationship: input.emergencyContactRelationship,
                termsAcceptedAt: termsConsent
                  ? new Date(termsConsent.signedAt)
                  : input.termsAccepted
                    ? now
                    : null,
                termsVersion: termsConsent?.docVersion ?? (input.termsAccepted ? "v1" : null),
                privacyAcceptedAt: privacyConsent
                  ? new Date(privacyConsent.signedAt)
                  : input.privacyAccepted
                    ? now
                    : null,
                privacyVersion: privacyConsent?.docVersion ?? (input.privacyAccepted ? "v1" : null),
                marketingOptIn: input.marketingEmailOptIn,
                marketingSmsOptIn: input.marketingSmsOptIn,
                signatureImage: input.signatureImage,
                notes: input.staffNote
                  ? `[${now.toISOString()}] ${ctx.user.name ?? ctx.user.email}: ${input.staffNote}`
                  : null,
              },
            },
          },
        });

        const extraDocRows: Prisma.CustomerDocumentCreateManyInput[] = [];

        if (input.customerPhotoUrl) {
          extraDocRows.push({
            customerId: created.id,
            type: "CUSTOMER_PHOTO",
            fileUrl: input.customerPhotoUrl,
            label: "Onboarding photo",
            uploadedById: ctx.user.id,
          });
        }

        for (const c of input.signedConsents) {
          extraDocRows.push({
            customerId: created.id,
            type: CONSENT_DOC_TYPE_MAP[c.docKey] as Prisma.CustomerDocumentCreateManyInput["type"],
            fileUrl: c.fileUrl,
            label: `${getConsentDocument(c.docKey).title} (${c.docVersion})`,
            uploadedById: ctx.user.id,
            metadata: {
              kind: "consent",
              docKey: c.docKey,
              docVersion: c.docVersion,
              signedAt: c.signedAt,
              fileKey: c.fileKey,
            } as Prisma.InputJsonValue,
          });
        }

        if (input.documents.length > 0) {
          for (const d of input.documents) {
            extraDocRows.push({
              customerId: created.id,
              type: d.type,
              fileUrl: d.fileUrl,
              label: d.label,
              expiryDate: d.expiryDate ? new Date(d.expiryDate) : null,
              uploadedById: ctx.user.id,
            });
          }
        }

        if (extraDocRows.length > 0) {
          await tx.customerDocument.createMany({ data: extraDocRows });
        }

        return created;
      });
      captureCustomerId(ctx, user.id);

      // Fire-and-acknowledge welcome email. A failure here must not roll back
      // the customer record — log + move on; the staff can manually resend.
      try {
        const { sendNotification } = await import("@/server/services/notification-sender");
        const { getBranding } = await import("@/lib/branding");
        const { siteName } = await getBranding();
        const { default: CustomerWelcomeEmail } = await import(
          "../../../../emails/customer-welcome"
        );
        const { render: renderEmail } = await import("@react-email/render");
        const { createElement } = await import("react");
        const appBase =
          process.env.AUTH_URL ??
          process.env.APP_URL ??
          process.env.NEXTAUTH_URL ??
          "http://localhost:3000";
        const html = await renderEmail(
          createElement(CustomerWelcomeEmail, {
            customerName: input.firstName,
            siteName,
            fleetUrl: `${appBase}/fleet`,
            signInUrl: `${appBase}/login`,
          }),
        );
        await sendNotification({
          userId: user.id,
          type: "CUSTOMER_WELCOME",
          channels: ["EMAIL"],
          subject: `Welcome to ${siteName}`,
          title: `Welcome to ${siteName}`,
          body:
            `Hi ${input.firstName}, your ${siteName} account has been created by our team. ` +
            `Browse the fleet at ${appBase}/fleet. ` +
            `To set your password, use "Forgot password" at ${appBase}/login.`,
          html,
          templateKey: "customer-welcome",
          sentById: ctx.user.id,
        });
      } catch (err) {
        // Swallow — notification-sender already logs; customer creation succeeded.
        void err;
      }

      return user;
    }),

  /**
   * Render a signed consent document (Terms / Privacy / Cancellation /
   * Marketing) as a PDF for a customer in the onboarding flow. The
   * customer hasn't been created yet when this fires, so we upload the
   * PDF to `customer-consents/` and hand the key + URL back to the
   * client. At `createDetailed` submit time, the client passes these
   * references in `signedConsents` and we attach them as CONSENT_*
   * CustomerDocument rows.
   *
   * The raw signature PNG is also uploaded on the FIRST call and its
   * storage key returned so subsequent docs can reuse it — that's the
   * "single signature image" captured per customer.
   *
   * Rate-limited per staff member to 60/hr (4 docs × typical onboardings
   * per hour × margin) to bound PDF renders in the rare abuse path.
   */
  generateConsentPdf: staffProcedure
    .use(
      trpcRateLimit({
        bucket: "staff:consent-pdf",
        limit: 60,
        windowSec: 60 * 60,
      }),
    )
    .input(
      z.object({
        docKey: z.enum(["TERMS", "PRIVACY", "CANCELLATION", "MARKETING"]),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        signatureDataUrl: z
          .string()
          .regex(/^data:image\/png;base64,/, "signatureDataUrl must be a PNG data-URL")
          .optional(),
        signatureKey: z.string().min(1).optional(),
        signedAt: z.string().datetime(),
        marketingChoices: z
          .object({ email: z.boolean(), sms: z.boolean() })
          .optional(),
      }).refine((v) => v.signatureDataUrl || v.signatureKey, {
        path: ["signatureDataUrl"],
        message: "Either signatureDataUrl or signatureKey is required",
      }),
    )
    .mutation(async ({ input }) => {
      const doc = getConsentDocument(input.docKey as ConsentDocKey);

      // Resolve the signature source. Either a fresh PNG data-URL (first
      // doc in the sequence) or a key from an earlier call in this flow.
      // Always convert to a data-URL before embedding so @react-pdf's
      // Image element doesn't have to fetch anything at render time
      // (relative /uploads paths in dev would break).
      let signatureKey: string;
      let signatureUrl: string;
      let signatureDataUrl: string;
      if (input.signatureDataUrl) {
        const base64 = input.signatureDataUrl.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        const uploaded = await uploadFile({
          folder: "signatures",
          filename: "signature.png",
          contentType: "image/png",
          body: buffer,
        });
        signatureKey = uploaded.key;
        signatureUrl = uploaded.url;
        signatureDataUrl = input.signatureDataUrl;
      } else {
        signatureKey = input.signatureKey!;
        signatureUrl = await getSignedUrl(signatureKey, 60 * 10);
        const buffer = await downloadFile(signatureKey);
        signatureDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
      }

      const fullName = `${input.firstName} ${input.lastName}`.trim();
      const pdf = await renderConsentDocumentPdf({
        title: doc.title,
        version: doc.version,
        body: doc.body,
        customerFullName: fullName,
        signatureUrl: signatureDataUrl,
        signedAt: new Date(input.signedAt),
        marketingChoices: input.docKey === "MARKETING" ? input.marketingChoices : undefined,
      });

      const uploaded = await uploadFile({
        folder: "customer-consents",
        filename: `${input.docKey.toLowerCase()}-${doc.version}.pdf`,
        contentType: "application/pdf",
        body: pdf,
      });

      return {
        fileKey: uploaded.key,
        fileUrl: uploaded.url,
        docVersion: doc.version,
        signatureKey,
        signatureUrl,
      };
    }),

  /**
   * Customer audit — scans active customers for data-quality, compliance
   * and consent issues (expired licence, blacklisted-on-hire, missing
   * emergency contact, etc.). Pure in-memory evaluation via
   * `evaluateCustomerAudit` after a single Prisma round-trip per filter.
   *
   * Default scope is "customers with at least one booking in the last
   * 12 months OR a currently-active rental"; pass `includeAll: true` to
   * scan every active customer (slower at scale).
   */
  audit: staffProcedure
    .input(
      z
        .object({
          severity: z.enum(["critical", "warning", "info"]).optional(),
          checkKey: z.string().optional(),
          search: z.string().trim().optional(),
          includeAll: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const twelveMonthsAgo = new Date(now);
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      // Scope: active customers, optionally narrowed to "engaged in last
      // 12 months". Excluded statuses (BANNED) are dispositions where
      // missing fields are expected.
      const where: Prisma.UserWhereInput = {
        role: "CUSTOMER",
        status: { notIn: [...CUSTOMER_AUDIT_EXCLUDED_STATUSES] },
        deletedAt: null,
        ...(input?.includeAll
          ? {}
          : {
              OR: [
                { customerProfile: { lastBookingAt: { gte: twelveMonthsAgo } } },
                { bookings: { some: { status: { in: ["CHECKED_OUT", "ACTIVE", "OVERDUE"] } } } },
              ],
            }),
        ...(input?.search
          ? {
              AND: [
                {
                  OR: [
                    { email: { contains: input.search, mode: "insensitive" } },
                    { firstName: { contains: input.search, mode: "insensitive" } },
                    { lastName: { contains: input.search, mode: "insensitive" } },
                    { phone: { contains: input.search } },
                  ],
                },
              ],
            }
          : {}),
      };

      const customers = await ctx.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          emailVerified: true,
          dateOfBirth: true,
          customerProfile: {
            select: {
              licenceNumber: true,
              licenceExpiry: true,
              licenceImageFront: true,
              licenceImageBack: true,
              licenceVerifiedAt: true,
              passportExpiry: true,
              emergencyContactName: true,
              emergencyContactPhone: true,
              termsAcceptedAt: true,
              privacyAcceptedAt: true,
              addressLine1: true,
              postcode: true,
              marketingOptIn: true,
              marketingSmsOptIn: true,
              marketingEmailUnsubscribedAt: true,
              marketingSmsUnsubscribedAt: true,
              notes: true,
              riskRating: true,
              blacklistReason: true,
              lifetimePoints: true,
              referralCode: true,
              signatureImage: true,
              stripePaymentMethodExpMonth: true,
              stripePaymentMethodExpYear: true,
              incidentCount: true,
              totalBookings: true,
            },
          },
          _count: {
            select: {
              bookings: { where: { status: { in: ["CHECKED_OUT", "ACTIVE", "OVERDUE"] } } },
            },
          },
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      });

      type Row = {
        customerId: string;
        firstName: string;
        lastName: string;
        email: string;
        checkKey: CustomerAuditCheckKey;
        severity: CustomerAuditSeverity;
        remedy: "identity" | "compliance" | "consent" | "contact";
        label: string;
        description: string;
        detectedAt: string | null;
        daysDelta: number | null;
      };

      const rows: Row[] = [];
      const customersWithIssues = new Set<string>();

      for (const c of customers) {
        // Customers without a profile haven't completed onboarding —
        // their audit picture would be entirely "missing X" noise.
        if (!c.customerProfile) continue;
        const issues = evaluateCustomerAudit(
          { emailVerified: c.emailVerified, dateOfBirth: c.dateOfBirth },
          c.customerProfile,
          {
            activeRentalCount: c._count.bookings,
            incidentCount: c.customerProfile.incidentCount,
            totalBookingCount: c.customerProfile.totalBookings,
          },
          now,
        );
        if (issues.length === 0) continue;
        customersWithIssues.add(c.id);
        for (const issue of issues) {
          if (input?.severity && issue.severity !== input.severity) continue;
          if (input?.checkKey && issue.checkKey !== input.checkKey) continue;
          rows.push({
            customerId: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            checkKey: issue.checkKey,
            severity: issue.severity,
            remedy: issue.remedy,
            label: issue.label,
            description: issue.description,
            detectedAt: issue.detectedAt,
            daysDelta: issue.daysDelta,
          });
        }
      }

      const summary = {
        totalActive: customers.length,
        customersWithIssues: customersWithIssues.size,
        critical: rows.filter((r) => r.severity === "critical").length,
        warning: rows.filter((r) => r.severity === "warning").length,
        info: rows.filter((r) => r.severity === "info").length,
      };

      return { summary, issues: rows, checks: CUSTOMER_AUDIT_CHECKS };
    }),

  /**
   * Verification funnel — single round-trip producing the journey from
   * "no licence captured" through "manually verified". Numbers do not
   * sum (a customer can be verified AND expiring within 30 days); the
   * funnel is a per-stage population.
   */
  verificationFunnel: staffProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const soon = new Date(now);
    soon.setDate(soon.getDate() + 30);

    const rows = await ctx.prisma.$queryRaw<
      {
        total: bigint;
        noLicenceNumber: bigint;
        noLicenceImages: bigint;
        awaitingReview: bigint;
        verified: bigint;
        expiringSoon: bigint;
        expired: bigint;
      }[]
    >`
      SELECT
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER')                                              AS "total",
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER'
                  AND (cp."licenceNumber" IS NULL OR cp."licenceNumber" = ''))            AS "noLicenceNumber",
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER'
                  AND cp."licenceImageFront" IS NULL
                  AND cp."licenceImageBack" IS NULL)                                       AS "noLicenceImages",
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER'
                  AND cp."licenceVerifiedAt" IS NULL
                  AND (cp."licenceImageFront" IS NOT NULL OR cp."licenceImageBack" IS NOT NULL)) AS "awaitingReview",
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER' AND cp."licenceVerifiedAt" IS NOT NULL)        AS "verified",
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER'
                  AND cp."licenceExpiry" >= ${now} AND cp."licenceExpiry" <= ${soon})      AS "expiringSoon",
        COUNT(*)
          FILTER (WHERE u.role = 'CUSTOMER' AND cp."licenceExpiry" < ${now})               AS "expired"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;
    const r = rows[0]!;
    return {
      total: Number(r.total),
      noLicenceNumber: Number(r.noLicenceNumber),
      noLicenceImages: Number(r.noLicenceImages),
      awaitingReview: Number(r.awaitingReview),
      verified: Number(r.verified),
      expiringSoon: Number(r.expiringSoon),
      expired: Number(r.expired),
    };
  }),

  /**
   * Verification queue — paginated list of customers that need staff
   * attention for licence verification.
   *
   * Buckets:
   *   awaitingReview — has uploaded licence images but not verified
   *   expiring       — verified, but expires within 30 days
   *   expired        — licence expiry date has passed
   *   noImages       — no licence images uploaded yet (lowest urgency)
   */
  verificationQueue: staffProcedure
    .input(
      z.object({
        bucket: z.enum(["awaitingReview", "expiring", "expired", "noImages"]),
        search: z.string().trim().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const soon = new Date(now);
      soon.setDate(soon.getDate() + 30);

      const profileFilter = verificationBucketProfileFilter(input.bucket, now);

      const where: Prisma.UserWhereInput = {
        role: "CUSTOMER",
        deletedAt: null,
        customerProfile: profileFilter,
        ...(input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: "insensitive" } },
                { firstName: { contains: input.search, mode: "insensitive" } },
                { lastName: { contains: input.search, mode: "insensitive" } },
                { phone: { contains: input.search } },
              ],
            }
          : {}),
      };

      const [items, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            customerProfile: {
              select: {
                licenceNumber: true,
                licenceState: true,
                licenceExpiry: true,
                licenceImageFront: true,
                licenceImageBack: true,
                licenceVerifiedAt: true,
                lastBookingAt: true,
              },
            },
            _count: { select: { bookings: true } },
          },
          orderBy:
            input.bucket === "expired" || input.bucket === "expiring"
              ? [{ customerProfile: { licenceExpiry: "asc" } }]
              : [{ createdAt: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      const pageCount = Math.max(1, Math.ceil(totalCount / input.pageSize));
      return {
        items,
        totalCount,
        pageCount,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Cross-customer expiring-documents queue. Returns one row per
   * (customer × document) combination so a single customer with both an
   * expiring licence and an expiring passport appears twice. Combines
   * inline `CustomerProfile.{licenceExpiry,passportExpiry}` with rows from
   * the dedicated `CustomerDocument` table; the inline fields are the
   * verified primary, the table covers visas, IDPs, etc.
   */
  expiringDocuments: staffProcedure
    .input(
      z.object({
        kind: z.enum(["licence", "passport", "all"]).default("all"),
        windowDays: z.number().int().min(1).max(365).default(60),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() + input.windowDays);

      type Row = {
        customerId: string;
        firstName: string;
        lastName: string;
        email: string;
        documentType: string;
        documentLabel: string;
        expiryDate: Date;
        daysUntil: number;
        source: "profile" | "document";
      };

      const rows: Row[] = [];

      const wantLicence = input.kind === "licence" || input.kind === "all";
      const wantPassport = input.kind === "passport" || input.kind === "all";

      // ── inline expiry fields on CustomerProfile (the verified primary) ──
      if (wantLicence) {
        const licenceCustomers = await ctx.prisma.customerProfile.findMany({
          where: { licenceExpiry: { gte: now, lte: cutoff } },
          select: {
            licenceExpiry: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        });
        for (const c of licenceCustomers) {
          if (!c.licenceExpiry) continue;
          rows.push({
            customerId: c.user.id,
            firstName: c.user.firstName,
            lastName: c.user.lastName,
            email: c.user.email,
            documentType: "LICENCE",
            documentLabel: "Driver licence",
            expiryDate: c.licenceExpiry,
            daysUntil: Math.ceil((c.licenceExpiry.getTime() - now.getTime()) / 86_400_000),
            source: "profile",
          });
        }
      }
      if (wantPassport) {
        const passportCustomers = await ctx.prisma.customerProfile.findMany({
          where: { passportExpiry: { gte: now, lte: cutoff } },
          select: {
            passportExpiry: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        });
        for (const c of passportCustomers) {
          if (!c.passportExpiry) continue;
          rows.push({
            customerId: c.user.id,
            firstName: c.user.firstName,
            lastName: c.user.lastName,
            email: c.user.email,
            documentType: "PASSPORT",
            documentLabel: "Passport",
            expiryDate: c.passportExpiry,
            daysUntil: Math.ceil((c.passportExpiry.getTime() - now.getTime()) / 86_400_000),
            source: "profile",
          });
        }
      }

      // ── CustomerDocument table (visa, IDP, etc.) ──
      const docTypeFilter: Prisma.EnumCustomerDocumentTypeFilter | undefined =
        wantPassport && wantLicence
          ? undefined
          : wantPassport
          ? { in: ["PASSPORT", "VISA"] }
          : { in: ["LICENCE_FRONT", "LICENCE_BACK", "INTL_DRIVING_PERMIT", "PASSPORT_STYLE_DL"] };

      const docs = await ctx.prisma.customerDocument.findMany({
        where: {
          expiryDate: { gte: now, lte: cutoff },
          ...(docTypeFilter ? { type: docTypeFilter } : {}),
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      for (const d of docs) {
        if (!d.expiryDate) continue;
        rows.push({
          customerId: d.customer.id,
          firstName: d.customer.firstName,
          lastName: d.customer.lastName,
          email: d.customer.email,
          documentType: d.type,
          documentLabel: d.label ?? d.type.replace(/_/g, " ").toLowerCase(),
          expiryDate: d.expiryDate,
          daysUntil: Math.ceil((d.expiryDate.getTime() - now.getTime()) / 86_400_000),
          source: "document",
        });
      }

      rows.sort((a, b) => a.daysUntil - b.daysUntil);
      const totalCount = rows.length;
      const pageCount = Math.max(1, Math.ceil(totalCount / input.pageSize));
      const start = (input.page - 1) * input.pageSize;
      return {
        items: rows.slice(start, start + input.pageSize),
        totalCount,
        pageCount,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Cross-customer missing-documents queue. Each `requirement` corresponds
   * to one specific gap that staff can chase the customer to fix. Scoped
   * to active customers (not banned/deleted) only.
   */
  missingDocuments: staffProcedure
    .input(
      z.object({
        requirement: z.enum(["licenceImages", "signature", "emergency", "address", "terms"]),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profileFilter = missingDocumentProfileFilter(input.requirement);

      const where: Prisma.UserWhereInput = {
        role: "CUSTOMER",
        deletedAt: null,
        status: { notIn: ["BANNED"] },
        customerProfile: profileFilter,
      };

      const [items, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            customerProfile: {
              select: {
                customerSince: true,
                lastBookingAt: true,
                totalBookings: true,
              },
            },
          },
          orderBy: [{ customerProfile: { lastBookingAt: "desc" } }, { createdAt: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        items,
        totalCount,
        pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Risk & compliance overview — KPI tiles for the Risk tab. Single
   * round-trip; the list/segmented controls below page through results.
   */
  riskStats: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.$queryRaw<
      {
        riskHigh: bigint;
        riskMedium: bigint;
        blacklisted: bigint;
        repeatIncidents: bigint;
        suspended: bigint;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."riskRating" = 'HIGH')                             AS "riskHigh",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."riskRating" = 'MEDIUM')                           AS "riskMedium",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."blacklistReason" IS NOT NULL AND cp."blacklistReason" <> '') AS "blacklisted",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."incidentCount" >= 2)                              AS "repeatIncidents",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND u.status = 'SUSPENDED')                               AS "suspended"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;
    const r = rows[0]!;
    return {
      riskHigh: Number(r.riskHigh),
      riskMedium: Number(r.riskMedium),
      blacklisted: Number(r.blacklisted),
      repeatIncidents: Number(r.repeatIncidents),
      suspended: Number(r.suspended),
    };
  }),

  /**
   * Risk-filtered customer list. Supports rating, blacklisted, minimum
   * incident count, and search. Returns the same shape as `list` for
   * row reuse.
   */
  riskList: staffProcedure
    .input(
      z.object({
        rating: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
        blacklisted: z.boolean().optional(),
        minIncidents: z.number().int().min(0).optional(),
        suspended: z.boolean().optional(),
        search: z.string().trim().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profileFilter = riskListProfileFilter(input);

      const where: Prisma.UserWhereInput = {
        role: "CUSTOMER",
        deletedAt: null,
        ...(input.suspended ? { status: "SUSPENDED" } : {}),
        ...(Object.keys(profileFilter).length ? { customerProfile: profileFilter } : {}),
        ...(input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: "insensitive" } },
                { firstName: { contains: input.search, mode: "insensitive" } },
                { lastName: { contains: input.search, mode: "insensitive" } },
                { phone: { contains: input.search } },
              ],
            }
          : {}),
      };

      const [items, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
            customerProfile: {
              select: {
                riskRating: true,
                blacklistReason: true,
                incidentCount: true,
                lastBookingAt: true,
                notes: true,
              },
            },
            _count: { select: { bookings: true } },
          },
          orderBy: [{ customerProfile: { incidentCount: "desc" } }, { createdAt: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        items,
        totalCount,
        pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Bulk-update risk rating across the selected customer IDs. Returns
   * the count actually updated. Reuses the same Prisma constraint as
   * the per-customer `setRiskRating` mutation.
   */
  bulkSetRiskRating: staffProcedure
    .input(
      z.object({
        customerIds: z.array(z.string()).min(1).max(500),
        riskRating: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.prisma.customerProfile.updateMany({
        where: { userId: { in: input.customerIds } },
        data: { riskRating: input.riskRating },
      });
      for (const customerId of input.customerIds) {
        writeAuditAsync(ctx.prisma, {
          userId: ctx.user.id,
          category: "MUTATION",
          action: "staffCustomer.bulkSetRiskRating",
          entity: "User",
          entityId: customerId,
          method: "tRPC",
          path: "staffCustomer.bulkSetRiskRating",
          status: "SUCCESS",
          reqId: ctx.reqId,
          newData: { riskRating: input.riskRating },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
      }
      return { updated: count };
    }),

  /**
   * Set or clear the blacklist reason on a single customer. Passing null
   * clears the flag; any non-empty string sets it.
   */
  setBlacklist: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        reason: z.string().trim().min(1).max(500).nullable(),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: { blacklistReason: input.reason },
      });
      return { ok: true };
    }),

  /**
   * Marketing-consent KPI tiles. Snapshot of opt-in/out + hard-bounce
   * populations across customers, in a single $queryRaw round-trip.
   */
  consentStats: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.$queryRaw<
      {
        emailOptIn: bigint;
        smsOptIn: bigint;
        emailUnsubs: bigint;
        smsUnsubs: bigint;
        hardBounces: bigint;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."marketingOptIn" = TRUE)                        AS "emailOptIn",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."marketingSmsOptIn" = TRUE)                     AS "smsOptIn",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."marketingEmailUnsubscribedAt" IS NOT NULL)     AS "emailUnsubs",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."marketingSmsUnsubscribedAt" IS NOT NULL)       AS "smsUnsubs",
        (
          SELECT COUNT(DISTINCT cl."customerId")
          FROM "CommunicationLog" cl
          WHERE cl.status = 'BOUNCED' AND cl."customerId" IS NOT NULL
        )                                                                                                  AS "hardBounces"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;
    const r = rows[0]!;
    return {
      emailOptIn: Number(r.emailOptIn),
      smsOptIn: Number(r.smsOptIn),
      emailUnsubs: Number(r.emailUnsubs),
      smsUnsubs: Number(r.smsUnsubs),
      hardBounces: Number(r.hardBounces),
    };
  }),

  /**
   * Suppression list — paginated set of customers that should not be
   * messaged on the chosen channel.
   *
   *   email — has `marketingEmailUnsubscribedAt` set
   *   sms   — has `marketingSmsUnsubscribedAt` set
   *   bounced — has at least one CommunicationLog row with status=BOUNCED
   */
  suppressionList: staffProcedure
    .input(
      z.object({
        kind: z.enum(["email", "sms", "bounced"]),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.kind === "bounced") {
        // Customers with at least one BOUNCED communication. Distinct
        // via groupBy → user lookup; orderBy "most recent bounce first".
        const grouped = await ctx.prisma.communicationLog.groupBy({
          by: ["customerId"],
          where: { status: "BOUNCED", customerId: { not: null } },
          _max: { sentAt: true },
          orderBy: { _max: { sentAt: "desc" } },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        });
        const totalCount = await ctx.prisma.communicationLog
          .findMany({
            where: { status: "BOUNCED", customerId: { not: null } },
            select: { customerId: true },
            distinct: ["customerId"],
          })
          .then((rs) => rs.length);

        const ids = grouped.map((g) => g.customerId).filter((v): v is string => v !== null);
        const users = await ctx.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));
        const items = grouped
          .map((g) => {
            if (!g.customerId) return null;
            const u = userMap.get(g.customerId);
            if (!u) return null;
            return { ...u, lastEventAt: g._max.sentAt };
          })
          .filter(<T>(v: T | null): v is T => v !== null);

        return {
          items,
          totalCount,
          pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
          page: input.page,
          pageSize: input.pageSize,
        };
      }

      const profileFilter = suppressionProfileFilter(input.kind);
      const orderField =
        input.kind === "email" ? "marketingEmailUnsubscribedAt" : "marketingSmsUnsubscribedAt";

      const where: Prisma.UserWhereInput = {
        role: "CUSTOMER",
        deletedAt: null,
        customerProfile: profileFilter,
      };

      const [items, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            customerProfile: {
              select: {
                marketingEmailUnsubscribedAt: true,
                marketingSmsUnsubscribedAt: true,
                unsubscribeReason: true,
              },
            },
          },
          orderBy: { customerProfile: { [orderField]: "desc" } } as Prisma.UserOrderByWithRelationInput,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        items: items.map((u) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: u.phone,
          lastEventAt:
            input.kind === "email"
              ? u.customerProfile?.marketingEmailUnsubscribedAt ?? null
              : u.customerProfile?.marketingSmsUnsubscribedAt ?? null,
          reason: u.customerProfile?.unsubscribeReason ?? null,
        })),
        totalCount,
        pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Loyalty & referral KPI tiles. Single round-trip — counts by tier,
   * outstanding points balance, and referral funnel snapshot.
   */
  loyaltyStats: staffProcedure.query(async ({ ctx }) => {
    const tierRows = await ctx.prisma.$queryRaw<
      {
        silver: bigint;
        gold: bigint;
        platinum: bigint;
        outstandingPoints: bigint;
        lifetimePoints: bigint;
        totalCredit: number;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."loyaltyTier" = 'SILVER')   AS "silver",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."loyaltyTier" = 'GOLD')     AS "gold",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."loyaltyTier" = 'PLATINUM') AS "platinum",
        COALESCE(SUM(cp."loyaltyPoints") FILTER (WHERE u.role = 'CUSTOMER'), 0)        AS "outstandingPoints",
        COALESCE(SUM(cp."lifetimePoints") FILTER (WHERE u.role = 'CUSTOMER'), 0)       AS "lifetimePoints",
        COALESCE(SUM(cp."referralCreditBalance") FILTER (WHERE u.role = 'CUSTOMER'), 0)::float AS "totalCredit"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;
    const refRows = await ctx.prisma.$queryRaw<
      {
        pending: bigint;
        qualified: bigint;
        paid: bigint;
        rewardIssued: number;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'PENDING')                                  AS "pending",
        COUNT(*) FILTER (WHERE r.status = 'QUALIFIED')                                AS "qualified",
        COUNT(*) FILTER (WHERE r.status = 'PAID')                                     AS "paid",
        COALESCE(SUM(r."rewardAmount") FILTER (WHERE r.status IN ('QUALIFIED', 'PAID')), 0)::float AS "rewardIssued"
      FROM "Referral" r
    `;
    const t = tierRows[0]!;
    const r = refRows[0]!;
    return {
      tiers: {
        silver: Number(t.silver),
        gold: Number(t.gold),
        platinum: Number(t.platinum),
      },
      outstandingPoints: Number(t.outstandingPoints),
      lifetimePoints: Number(t.lifetimePoints),
      totalCreditBalance: Number(t.totalCredit),
      referrals: {
        pending: Number(r.pending),
        qualified: Number(r.qualified),
        paid: Number(r.paid),
        rewardIssued: Number(r.rewardIssued),
      },
    };
  }),

  /**
   * Loyalty leaderboard — top customers by current or lifetime points.
   * Default ordering is by `lifetimePoints` to surface long-term value.
   */
  loyaltyLeaderboard: staffProcedure
    .input(
      z.object({
        kind: z.enum(["points", "lifetime"]).default("lifetime"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.UserWhereInput = { role: "CUSTOMER", deletedAt: null };
      const orderBy =
        input.kind === "points"
          ? { customerProfile: { loyaltyPoints: "desc" as const } }
          : { customerProfile: { lifetimePoints: "desc" as const } };

      const [items, totalCount] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            customerProfile: {
              select: {
                loyaltyPoints: true,
                lifetimePoints: true,
                loyaltyTier: true,
                totalSpend: true,
                completedBookings: true,
                totalBookings: true,
              },
            },
          },
          orderBy,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        items: items.map((u) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          loyaltyPoints: u.customerProfile?.loyaltyPoints ?? 0,
          lifetimePoints: u.customerProfile?.lifetimePoints ?? 0,
          loyaltyTier: u.customerProfile?.loyaltyTier ?? "SILVER",
          totalSpend: u.customerProfile?.totalSpend.toNumber() ?? 0,
          completedBookings: u.customerProfile?.completedBookings ?? 0,
          // Bookings column: completed + in-flight (current) engagements.
          totalBookings: u.customerProfile?.totalBookings ?? 0,
        })),
        totalCount,
        pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Referral leaderboard — top referrers ranked by *qualified* referrals
   * (not pending). Includes pending count for context plus the
   * referrer's current credit balance.
   */
  referralLeaderboard: staffProcedure
    .input(z.object({ take: z.number().int().min(5).max(100).default(25) }))
    .query(async ({ ctx, input }) => {
      const grouped = await ctx.prisma.referral.groupBy({
        by: ["referrerId"],
        _count: { _all: true },
        orderBy: { _count: { referrerId: "desc" } },
        take: input.take * 2, // over-fetch in case some referrerIds are stale
      });
      const referrerIds = grouped.map((g) => g.referrerId);
      if (referrerIds.length === 0) return [];

      const [users, qualifiedCounts, pendingCounts] = await Promise.all([
        ctx.prisma.user.findMany({
          where: { id: { in: referrerIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            customerProfile: { select: { referralCreditBalance: true } },
          },
        }),
        ctx.prisma.referral.groupBy({
          by: ["referrerId"],
          _count: { _all: true },
          where: {
            referrerId: { in: referrerIds },
            status: { in: ["QUALIFIED", "PAID"] },
          },
        }),
        ctx.prisma.referral.groupBy({
          by: ["referrerId"],
          _count: { _all: true },
          where: { referrerId: { in: referrerIds }, status: "PENDING" },
        }),
      ]);

      const userMap = new Map(users.map((u) => [u.id, u]));
      const qMap = new Map(qualifiedCounts.map((q) => [q.referrerId, q._count._all]));
      const pMap = new Map(pendingCounts.map((p) => [p.referrerId, p._count._all]));

      return referrerIds
        .map((id) => {
          const u = userMap.get(id);
          if (!u) return null;
          return {
            id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            qualifiedCount: qMap.get(id) ?? 0,
            pendingCount: pMap.get(id) ?? 0,
            creditBalance: u.customerProfile?.referralCreditBalance.toNumber() ?? 0,
          };
        })
        .filter(<T>(v: T | null): v is T => v !== null)
        .sort((a, b) => b.qualifiedCount - a.qualifiedCount)
        .slice(0, input.take);
    }),

  /**
   * Overview KPI tiles. Single round-trip via `$queryRaw` to keep the
   * dashboard load cost flat regardless of customer count.
   */
  overviewStats: staffProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const last30Start = new Date(now);
    last30Start.setDate(last30Start.getDate() - 30);
    const prev30Start = new Date(now);
    prev30Start.setDate(prev30Start.getDate() - 60);

    const rows = await ctx.prisma.$queryRaw<
      {
        total: bigint;
        newLast30d: bigint;
        newPrev30d: bigint;
        verified: bigint;
        highRisk: bigint;
        blacklisted: bigint;
        totalLifetimeRevenue: number;
        avgLifetimeValue: number;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER')                                      AS "total",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND u."createdAt" >= ${last30Start})  AS "newLast30d",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER'
                          AND u."createdAt" >= ${prev30Start}
                          AND u."createdAt" <  ${last30Start})                            AS "newPrev30d",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."licenceVerifiedAt" IS NOT NULL) AS "verified",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."riskRating" = 'HIGH')          AS "highRisk",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER' AND cp."blacklistReason" IS NOT NULL AND cp."blacklistReason" <> '') AS "blacklisted",
        COALESCE(SUM(cp."totalSpend") FILTER (WHERE u.role = 'CUSTOMER'), 0)::float       AS "totalLifetimeRevenue",
        COALESCE(AVG(NULLIF(cp."totalSpend", 0)) FILTER (WHERE u.role = 'CUSTOMER'), 0)::float AS "avgLifetimeValue"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;
    const r = rows[0]!;
    const newLast30d = Number(r.newLast30d);
    const newPrev30d = Number(r.newPrev30d);
    return {
      total: Number(r.total),
      newLast30d,
      newPrev30d,
      momDelta: momDelta(newLast30d, newPrev30d),
      verified: Number(r.verified),
      highRisk: Number(r.highRisk),
      blacklisted: Number(r.blacklisted),
      totalLifetimeRevenue: Number(r.totalLifetimeRevenue),
      avgLifetimeValue: Number(r.avgLifetimeValue),
    };
  }),

  /**
   * Customer acquisition trend — count of new customers per month for
   * the requested window. Returns ascending months (oldest first) with
   * zero-fill for empty months.
   */
  acquisitionTrend: staffProcedure
    .input(
      z.object({
        months: z
          .union([
            z.literal(6),
            z.literal(12),
            z.literal(24),
            z.literal(36),
            z.literal(48),
          ])
          .default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.months + 1, 1));

      const rows = await ctx.prisma.$queryRaw<
        { month: Date; count: bigint }[]
      >`
        SELECT
          DATE_TRUNC('month', u."createdAt") AS "month",
          COUNT(*) AS "count"
        FROM "User" u
        WHERE u.role = 'CUSTOMER'
          AND u."deletedAt" IS NULL
          AND u."createdAt" >= ${start}
        GROUP BY 1
        ORDER BY 1 ASC
      `;
      return fillAcquisitionTrend(rows, start, input.months);
    }),

  /** Top spenders — leaderboard by lifetime spend. */
  topSpenders: staffProcedure
    .input(z.object({ take: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.user.findMany({
        // Customer identity is profile-based, not role-based: back-office
        // users carry a CustomerProfile so they can rent and must appear in
        // the leaderboard. See src/lib/customer-identity.ts.
        where: { deletedAt: null, ...customerDirectoryUserWhere() },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          customerProfile: {
            select: {
              totalSpend: true,
              totalBookings: true,
              completedBookings: true,
              loyaltyTier: true,
              lastBookingAt: true,
            },
          },
        },
        orderBy: { customerProfile: { totalSpend: "desc" } },
        take: input.take,
      });
      return items.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        totalSpend: u.customerProfile?.totalSpend.toNumber() ?? 0,
        // Count all non-cancelled hires so it matches the spend basis (which
        // counts collected money across ACTIVE bookings, not just COMPLETED).
        totalBookings: u.customerProfile?.totalBookings ?? 0,
        completedBookings: u.customerProfile?.completedBookings ?? 0,
        loyaltyTier: u.customerProfile?.loyaltyTier ?? "SILVER",
        lastBookingAt: u.customerProfile?.lastBookingAt ?? null,
      }));
    }),

  /**
   * Four geographic distribution buckets in a single round-trip:
   *   - states:    top Australian states
   *   - countries: top countries worldwide
   *   - postcodes: top Australian postcodes (with state)
   *   - suburbs:   top Australian suburbs (with state)
   */
  geoDistribution: staffProcedure
    .input(z.object({ take: z.number().int().min(5).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const take = input.take;

      const [stateRows, countryRows, postcodeRows, suburbRows] = await Promise.all([
        ctx.prisma.$queryRaw<{ state: string | null; count: bigint }[]>`
          SELECT cp.state, COUNT(*) AS "count"
          FROM "CustomerProfile" cp
          JOIN "User" u ON u.id = cp."userId"
          WHERE u.role = 'CUSTOMER'
            AND u."deletedAt" IS NULL
            AND cp.country = 'Australia'
            AND cp.state IS NOT NULL
            AND cp.state <> ''
          GROUP BY cp.state
          ORDER BY COUNT(*) DESC
          LIMIT ${take}
        `,
        ctx.prisma.$queryRaw<{ country: string | null; count: bigint }[]>`
          SELECT cp.country, COUNT(*) AS "count"
          FROM "CustomerProfile" cp
          JOIN "User" u ON u.id = cp."userId"
          WHERE u.role = 'CUSTOMER'
            AND u."deletedAt" IS NULL
            AND cp.country IS NOT NULL
            AND cp.country <> ''
          GROUP BY cp.country
          ORDER BY COUNT(*) DESC
          LIMIT ${take}
        `,
        ctx.prisma.$queryRaw<
          { postcode: string | null; state: string | null; count: bigint }[]
        >`
          SELECT cp.postcode, cp.state, COUNT(*) AS "count"
          FROM "CustomerProfile" cp
          JOIN "User" u ON u.id = cp."userId"
          WHERE u.role = 'CUSTOMER'
            AND u."deletedAt" IS NULL
            AND cp.country = 'Australia'
            AND cp.postcode IS NOT NULL
            AND cp.postcode <> ''
          GROUP BY cp.postcode, cp.state
          ORDER BY COUNT(*) DESC
          LIMIT ${take}
        `,
        ctx.prisma.$queryRaw<
          { suburb: string | null; state: string | null; count: bigint }[]
        >`
          SELECT cp.suburb, cp.state, COUNT(*) AS "count"
          FROM "CustomerProfile" cp
          JOIN "User" u ON u.id = cp."userId"
          WHERE u.role = 'CUSTOMER'
            AND u."deletedAt" IS NULL
            AND cp.country = 'Australia'
            AND cp.suburb IS NOT NULL
            AND cp.suburb <> ''
          GROUP BY cp.suburb, cp.state
          ORDER BY COUNT(*) DESC
          LIMIT ${take}
        `,
      ]);

      return {
        states: stateRows.map((r) => ({
          state: r.state ?? "—",
          count: Number(r.count),
        })),
        countries: countryRows.map((r) => ({
          country: r.country ?? "—",
          count: Number(r.count),
        })),
        postcodes: postcodeRows.map((r) => ({
          postcode: r.postcode ?? "—",
          state: r.state ?? "—",
          count: Number(r.count),
        })),
        suburbs: suburbRows.map((r) => ({
          suburb: r.suburb ?? "—",
          state: r.state ?? "—",
          count: Number(r.count),
        })),
      };
    }),

  /**
   * Four customer-mix buckets in a single round-trip:
   *   - licenceVerification: Verified vs Unverified
   *   - licenceClass:        C / RE / R (+ other / unknown)
   *   - licenceExpiry:       Expired / ≤30d / ≤6mo / >6mo / Unknown
   *   - ageBand:             18–25 / 26–35 / 36–50 / 50+ / Unknown
   */
  customerMixDistribution: staffProcedure.query(async ({ ctx }) => {
    const [verificationRows, classRows, expiryRows, ageRows] = await Promise.all([
      ctx.prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
        SELECT
          CASE WHEN cp."licenceVerifiedAt" IS NOT NULL THEN 'Verified' ELSE 'Unverified' END AS "bucket",
          COUNT(*) AS "count"
        FROM "CustomerProfile" cp
        JOIN "User" u ON u.id = cp."userId"
        WHERE u.role = 'CUSTOMER'
          AND u."deletedAt" IS NULL
        GROUP BY 1
        ORDER BY COUNT(*) DESC
      `,
      ctx.prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
        SELECT "bucket", COUNT(*) AS "count"
        FROM (
          SELECT TRIM(UNNEST(STRING_TO_ARRAY(cp."licenceClass", ','))) AS "bucket"
          FROM "CustomerProfile" cp
          JOIN "User" u ON u.id = cp."userId"
          WHERE u.role = 'CUSTOMER'
            AND u."deletedAt" IS NULL
            AND cp."licenceClass" IS NOT NULL
            AND cp."licenceClass" <> ''
        ) t
        WHERE "bucket" <> ''
        GROUP BY "bucket"
        ORDER BY COUNT(*) DESC
      `,
      ctx.prisma.$queryRaw<{ bucket: string; order_key: number; count: bigint }[]>`
        SELECT
          CASE
            WHEN cp."licenceExpiry" IS NULL THEN 'Unknown'
            WHEN cp."licenceExpiry" < NOW() THEN 'Expired'
            WHEN cp."licenceExpiry" < NOW() + INTERVAL '30 days' THEN 'Expiring ≤30d'
            WHEN cp."licenceExpiry" < NOW() + INTERVAL '180 days' THEN 'Valid ≤6mo'
            ELSE 'Valid >6mo'
          END AS "bucket",
          CASE
            WHEN cp."licenceExpiry" IS NULL THEN 5
            WHEN cp."licenceExpiry" < NOW() THEN 1
            WHEN cp."licenceExpiry" < NOW() + INTERVAL '30 days' THEN 2
            WHEN cp."licenceExpiry" < NOW() + INTERVAL '180 days' THEN 3
            ELSE 4
          END AS "order_key",
          COUNT(*) AS "count"
        FROM "CustomerProfile" cp
        JOIN "User" u ON u.id = cp."userId"
        WHERE u.role = 'CUSTOMER'
          AND u."deletedAt" IS NULL
        GROUP BY 1, 2
        ORDER BY "order_key" ASC
      `,
      ctx.prisma.$queryRaw<{ bucket: string; order_key: number; count: bigint }[]>`
        SELECT
          CASE
            WHEN u."dateOfBirth" IS NULL THEN 'Unknown'
            WHEN EXTRACT(YEAR FROM AGE(u."dateOfBirth")) < 26 THEN '18–25'
            WHEN EXTRACT(YEAR FROM AGE(u."dateOfBirth")) < 36 THEN '26–35'
            WHEN EXTRACT(YEAR FROM AGE(u."dateOfBirth")) < 51 THEN '36–50'
            ELSE '50+'
          END AS "bucket",
          CASE
            WHEN u."dateOfBirth" IS NULL THEN 5
            WHEN EXTRACT(YEAR FROM AGE(u."dateOfBirth")) < 26 THEN 1
            WHEN EXTRACT(YEAR FROM AGE(u."dateOfBirth")) < 36 THEN 2
            WHEN EXTRACT(YEAR FROM AGE(u."dateOfBirth")) < 51 THEN 3
            ELSE 4
          END AS "order_key",
          COUNT(*) AS "count"
        FROM "CustomerProfile" cp
        JOIN "User" u ON u.id = cp."userId"
        WHERE u.role = 'CUSTOMER'
          AND u."deletedAt" IS NULL
        GROUP BY 1, 2
        ORDER BY "order_key" ASC
      `,
    ]);

    return {
      licenceVerification: verificationRows.map((r) => ({
        label: r.bucket,
        count: Number(r.count),
      })),
      licenceClass: classRows.map((r) => ({
        label: r.bucket,
        count: Number(r.count),
      })),
      licenceExpiry: expiryRows.map((r) => ({
        label: r.bucket,
        count: Number(r.count),
      })),
      ageBand: ageRows.map((r) => ({
        label: r.bucket,
        count: Number(r.count),
      })),
    };
  }),

  /** Document KPI tiles for the Documents tab. Single round-trip. */
  documentStats: staffProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in90 = new Date(now);
    in90.setDate(in90.getDate() + 90);

    const rows = await ctx.prisma.$queryRaw<
      {
        licencesExpiring30d: bigint;
        passportsExpiring90d: bigint;
        missingLicenceImages: bigint;
        missingSignature: bigint;
        missingTerms: bigint;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER'
                         AND cp."licenceExpiry" >= ${now} AND cp."licenceExpiry" <= ${in30})  AS "licencesExpiring30d",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER'
                         AND cp."passportExpiry" >= ${now} AND cp."passportExpiry" <= ${in90}) AS "passportsExpiring90d",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER'
                         AND cp."licenceImageFront" IS NULL AND cp."licenceImageBack" IS NULL) AS "missingLicenceImages",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER'
                         AND cp."signatureImage" IS NULL)                                       AS "missingSignature",
        COUNT(*) FILTER (WHERE u.role = 'CUSTOMER'
                         AND cp."termsAcceptedAt" IS NULL)                                      AS "missingTerms"
      FROM "User" u
      LEFT JOIN "CustomerProfile" cp ON cp."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;
    const r = rows[0]!;
    return {
      licencesExpiring30d: Number(r.licencesExpiring30d),
      passportsExpiring90d: Number(r.passportsExpiring90d),
      missingLicenceImages: Number(r.missingLicenceImages),
      missingSignature: Number(r.missingSignature),
      missingTerms: Number(r.missingTerms),
    };
  }),
});

/**
 * Storage references in the DB come in two flavours: an S3/local key
 * (imported via the driver migration) or a direct URL (`/uploads/...` or
 * `https://...`, written by the upload endpoint). Normalise to a fetchable
 * URL so the client never has to care.
 */
async function resolveStorageUrl(raw: string): Promise<string> {
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return raw;
  return getSignedUrl(raw);
}

/**
 * Reduce any storage reference (bare key, /uploads/ URL, or absolute
 * https URL) to the bucket key used by `downloadFile` / `deleteFile`.
 */
function keyFromStorageRef(raw: string): string {
  if (raw.startsWith("/uploads/")) return raw.slice("/uploads/".length);
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const u = new URL(raw);
      const parts = u.pathname.replace(/^\//, "").split("/");
      const bucket = process.env.S3_BUCKET ?? "xpertmoto";
      if (parts[0] === bucket) parts.shift();
      return parts.join("/");
    } catch {
      return raw;
    }
  }
  return raw;
}

function isImageRef(raw: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(raw);
}
