import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  staffProcedure,
  trpcRateLimit,
} from "../trpc";
import {
  quote as quotePricing,
  quoteExtension,
  OneWayDisallowedError,
  MinimumRentalPeriodError,
} from "@/server/services/pricing";
import {
  countAvailable,
  listAvailableVehicles,
  isVehicleFree,
  isBookingOverlapViolation,
} from "@/server/services/availability";
import { checkEligibility } from "@/server/services/eligibility";
import { canRentAsCustomer } from "@/lib/customer-identity";
import {
  enforceBookingTimesWithinHours,
  enforceDateTimeWithinDepotHours,
} from "@/server/services/booking-times-guard";
import { createPaymentIntent, createBondHold } from "@/lib/stripe";
import {
  createSetupIntentForUser,
  ensureStripeCustomer,
} from "@/server/services/stripe-customer";
import { sendNotification } from "@/server/services/notification-sender";
import {
  cancel as cancelBookingService,
  quoteCancellation as quoteCancellationService,
} from "@/server/services/booking-cancellation";
import {
  confirmBookingPayment,
  PaymentNotSucceededError,
  BondNotHeldError,
  BookingNotConfirmableError,
} from "@/server/services/booking-confirmation";
import {
  skipAutoAudit,
  writeAudit,
  writeBookingAuditAsync,
  writeCustomerAuditAsync,
} from "@/server/services/audit";
import { trackServer } from "@/lib/analytics";
import { gstFromInclusive } from "@/lib/money";
import { generateBookingReference, withUniqueRetry } from "@/lib/id-gen";
import { applyReferral } from "@/server/services/referral";
import { attachByTrackingCode } from "@/server/services/partner";
import { render as renderEmail } from "@react-email/render";
import { createElement } from "react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { getBranding } from "@/lib/branding";
import BookingModified from "../../../../emails/booking-modified";

const quoteInput = z.object({
  categoryId: z.string(),
  // Optional: a specific vehicle the customer pre-selected in the wizard.
  // When set, quote() resolves the base rate through the
  // vehicle → model → category cascade and renders the model name in the
  // base line item. Not used to allocate stock — allocation still happens
  // at check-out unless the staff flow pre-allocates explicitly.
  vehicleId: z.string().optional(),
  pickupDepotId: z.string(),
  returnDepotId: z.string(),
  pickupDateTime: z.coerce.date(),
  returnDateTime: z.coerce.date(),
  addons: z
    .array(z.object({ addonId: z.string(), quantity: z.number().int().min(1) }))
    .optional(),
  insuranceOptionId: z.string().optional(),
  discountCode: z.string().optional(),
  isDelivery: z.boolean().optional(),
  deliveryFee: z.number().optional(),
});

export const bookingRouter = createTRPCRouter({
  mine: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          cursor: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const rows = await ctx.prisma.booking.findMany({
        where: { customerId: ctx.user.id },
        include: {
          category: true,
          vehicle: {
            include: {
              category: true,
              depot: true,
              images: { orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }] },
            },
          },
          pickupDepot: true,
          returnDepot: true,
        },
        orderBy: { pickupDateTime: "desc" },
        take: limit + 1,
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUnique({
        where: { id: input.id },
        include: {
          category: true,
          vehicle: true,
          pickupDepot: true,
          returnDepot: true,
          addons: { include: { addon: true } },
          insurance: { include: { insuranceOption: true } },
          payments: true,
        },
      });
      if (!b) throw new TRPCError({ code: "NOT_FOUND" });
      if (
        b.customerId !== ctx.user.id &&
        !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(ctx.user.role)
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return b;
    }),

  byReference: protectedProcedure
    .input(z.object({ reference: z.string() }))
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUnique({
        where: { bookingReference: input.reference },
        include: {
          category: true,
          pickupDepot: true,
          returnDepot: true,
          addons: { include: { addon: true } },
        },
      });
      if (!b) return null;
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (b.customerId !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return b;
    }),

  /**
   * List every persisted document tied to a booking — tax invoices,
   * adjustment notes, branded payment receipts, signed rental
   * agreements, return assessments, and swap agreements. Sorted newest
   * first. Owners see their own bookings; staff see any booking in
   * their depot scope.
   */
  listDocuments: protectedProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: { id: true, customerId: true, bookingReference: true, depotId: true },
      });
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (!isStaff && booking.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const [invoices, adjustments, receipts, agreements, returns, swaps] =
        await Promise.all([
          ctx.prisma.invoice.findMany({
            where: { bookingId: booking.id, deletedAt: null },
            select: {
              id: true,
              invoiceNumber: true,
              issuedAt: true,
              createdAt: true,
              totalAmount: true,
              status: true,
              pdfUrl: true,
              pdfKey: true,
            },
          }),
          ctx.prisma.adjustmentNote.findMany({
            where: { bookingId: booking.id, deletedAt: null },
            select: {
              id: true,
              adjustmentNumber: true,
              issuedAt: true,
              type: true,
              reason: true,
              description: true,
              totalAmount: true,
              status: true,
              pdfUrl: true,
              pdfKey: true,
            },
          }),
          ctx.prisma.payment.findMany({
            where: {
              bookingId: booking.id,
              receiptNumber: { not: null },
              deletedAt: null,
            },
            select: {
              id: true,
              receiptNumber: true,
              processedAt: true,
              createdAt: true,
              amount: true,
              type: true,
              receiptPdfUrl: true,
              receiptPdfKey: true,
            },
          }),
          ctx.prisma.rentalAgreement.findMany({
            where: { bookingId: booking.id },
            select: {
              id: true,
              version: true,
              signedAt: true,
              createdAt: true,
              pdfUrl: true,
              pdfKey: true,
            },
          }),
          ctx.prisma.returnAssessment.findMany({
            where: { bookingId: booking.id },
            select: {
              id: true,
              version: true,
              signedAt: true,
              createdAt: true,
              pdfUrl: true,
              pdfKey: true,
            },
          }),
          ctx.prisma.bookingSwap.findMany({
            // Only committed swaps produce an agreement document. DRAFT (still
            // in the wizard) and VOIDED (cancelled) swaps have no document and
            // must not show up as phantom "Pending" rows.
            where: { bookingId: booking.id, deletedAt: null, status: "COMMITTED" },
            select: {
              id: true,
              swappedAt: true,
              reason: true,
              documentUrl: true,
            },
          }),
        ]);

      // Build a same-origin download URL when we know the storage key —
      // bypasses CORS / private-IP issues with direct MinIO/S3 URLs and
      // gives us a place to enforce auth + audit on every fetch. Falls
      // back to the raw URL for legacy rows that pre-date pdfKey.
      const proxy = (key: string | null, raw: string | null) =>
        key ? `/api/documents?key=${encodeURIComponent(key)}` : raw;

      type Doc = {
        id: string;
        kind:
          | "TAX_INVOICE"
          | "ADJUSTMENT_INCREASE"
          | "ADJUSTMENT_DECREASE"
          | "RECEIPT"
          | "AGREEMENT"
          | "ASSESSMENT"
          | "SWAP_AGREEMENT";
        title: string;
        number: string | null;
        issuedAt: Date;
        totalAud: number | null;
        pdfUrl: string | null;
        meta: Record<string, string | null>;
      };

      const docs: Doc[] = [];

      for (const inv of invoices) {
        docs.push({
          id: `invoice-${inv.id}`,
          kind: "TAX_INVOICE",
          title: inv.status === "VOID" ? "Tax invoice (void)" : "Tax invoice",
          number: inv.invoiceNumber,
          issuedAt: inv.issuedAt ?? inv.createdAt,
          totalAud: Number(inv.totalAmount),
          pdfUrl: proxy(inv.pdfKey, inv.pdfUrl),
          meta: { status: inv.status },
        });
      }

      for (const adj of adjustments) {
        docs.push({
          id: `adjustment-${adj.id}`,
          kind: adj.type === "INCREASE" ? "ADJUSTMENT_INCREASE" : "ADJUSTMENT_DECREASE",
          title: adj.description,
          number: adj.adjustmentNumber,
          issuedAt: adj.issuedAt,
          totalAud: Number(adj.totalAmount),
          pdfUrl: proxy(adj.pdfKey, adj.pdfUrl),
          meta: { reason: adj.reason, status: adj.status },
        });
      }

      for (const r of receipts) {
        docs.push({
          id: `receipt-${r.id}`,
          kind: "RECEIPT",
          title: "Payment receipt",
          number: r.receiptNumber,
          issuedAt: r.processedAt ?? r.createdAt,
          totalAud: Number(r.amount),
          pdfUrl: proxy(r.receiptPdfKey, r.receiptPdfUrl),
          meta: { paymentType: r.type },
        });
      }

      for (const a of agreements) {
        docs.push({
          id: `agreement-${a.id}`,
          kind: "AGREEMENT",
          title: "Rental agreement",
          number: a.version != null ? `v${a.version}` : null,
          issuedAt: a.signedAt ?? a.createdAt,
          totalAud: null,
          pdfUrl: proxy(a.pdfKey, a.pdfUrl),
          meta: {},
        });
      }

      for (const r of returns) {
        docs.push({
          id: `assessment-${r.id}`,
          kind: "ASSESSMENT",
          title: "Return assessment",
          number: r.version != null ? `v${r.version}` : null,
          issuedAt: r.signedAt ?? r.createdAt,
          totalAud: null,
          pdfUrl: proxy(r.pdfKey, r.pdfUrl),
          meta: {},
        });
      }

      for (const s of swaps) {
        // Swap agreements stored a raw URL historically; if the URL
        // looks like an object key (starts with `swaps/`) we proxy it.
        const swapKey =
          s.documentUrl && /^swaps\//.test(s.documentUrl) ? s.documentUrl : null;
        docs.push({
          id: `swap-${s.id}`,
          kind: "SWAP_AGREEMENT",
          title: `Vehicle swap (${s.reason.toLowerCase()})`,
          number: null,
          issuedAt: s.swappedAt,
          totalAud: null,
          pdfUrl: proxy(swapKey, s.documentUrl),
          meta: { reason: s.reason },
        });
      }

      docs.sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());

      return { bookingReference: booking.bookingReference, documents: docs };
    }),

  availability: publicProcedure
    .use(trpcRateLimit({ bucket: "booking:avail", limit: 60, windowSec: 60 }))
    .input(
      z.object({
        categoryId: z.string(),
        depotId: z.string(),
        pickupDateTime: z.coerce.date(),
        returnDateTime: z.coerce.date(),
      }),
    )
    .query(({ ctx, input }) =>
      countAvailable(ctx.prisma, {
        categoryId: input.categoryId,
        depotId: input.depotId,
        pickup: input.pickupDateTime,
        ret: input.returnDateTime,
      }),
    ),

  listAvailableVehicles: publicProcedure
    .use(trpcRateLimit({ bucket: "booking:list", limit: 60, windowSec: 60 }))
    .input(
      z.object({
        pickupDateTime: z.coerce.date(),
        returnDateTime: z.coerce.date(),
        categoryId: z.string().optional(),
        depotId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listAvailableVehicles(ctx.prisma, {
        pickup: input.pickupDateTime,
        ret: input.returnDateTime,
        categoryId: input.categoryId,
        depotId: input.depotId,
        limit: input.limit ?? 200,
      }),
    ),

  popularPicks: publicProcedure
    .use(trpcRateLimit({ bucket: "booking:popular", limit: 60, windowSec: 60 }))
    .input(z.object({ days: z.number().int().min(7).max(365).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const windowDays = input?.days ?? 90;
      const since = new Date();
      since.setDate(since.getDate() - windowDays);
      const rows = await ctx.prisma.$queryRaw<
        Array<{ make: string; model: string; count: bigint }>
      >`
        SELECT v.make, v.model, COUNT(b.id)::bigint AS count
        FROM "Booking" b
        JOIN "Vehicle" v ON v.id = b."vehicleId"
        WHERE b."vehicleId" IS NOT NULL
          AND b."createdAt" >= ${since}
          AND b.status IN ('CONFIRMED','CHECKED_OUT','ACTIVE','OVERDUE','RETURNED','COMPLETED')
        GROUP BY v.make, v.model
        ORDER BY count DESC
        LIMIT 5
      `;
      return rows.map((r) => ({
        make: r.make,
        model: r.model,
        count: Number(r.count),
      }));
    }),

  quote: publicProcedure
    .use(trpcRateLimit({ bucket: "booking:quote", limit: 60, windowSec: 60 }))
    .input(quoteInput).query(async ({ ctx, input }) => {
    await enforceBookingTimesWithinHours(ctx.prisma, {
      pickupDepotId: input.pickupDepotId,
      returnDepotId: input.returnDepotId,
      pickupDateTime: input.pickupDateTime,
      returnDateTime: input.returnDateTime,
    });
    try {
      return await quotePricing(ctx.prisma, {
        categoryId: input.categoryId,
        vehicleId: input.vehicleId,
        pickupDateTime: input.pickupDateTime,
        returnDateTime: input.returnDateTime,
        pickupDepotId: input.pickupDepotId,
        returnDepotId: input.returnDepotId,
        addons: input.addons,
        insuranceOptionId: input.insuranceOptionId,
        discountCode: input.discountCode,
        deliveryFee: input.deliveryFee ?? 0,
      });
    } catch (err) {
      // Pricing-cascade validation outcomes (one-way not allowed, vehicle's
      // minimum-rental period not met) are normal customer-input rejections,
      // not server faults. Surface them as BAD_REQUEST so the wizard can show
      // the message — leaving them to escape turns a 1-day-on-a-2-day-minimum
      // bike into a 500 and a Sentry exception (see MIN_RENTAL_PERIOD noise).
      if (
        err instanceof OneWayDisallowedError ||
        err instanceof MinimumRentalPeriodError
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
      throw err;
    }
  }),

  create: protectedProcedure
    // Money path: every call writes a booking row and creates up to two
    // Stripe PaymentIntents. The read endpoints above run at 60/min — this
    // must be far tighter, per-user as well as per-IP (one human checkout
    // is 1 create; a couple of retries at most).
    .use(
      trpcRateLimit({
        bucket: "booking:create",
        limit: 5,
        windowSec: 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(
      quoteInput.extend({
        agreedToTerms: z.literal(true),
        termsVersion: z.string().default("v1.0"),
        notes: z.string().optional(),
        signatureDataUrl: z.string().optional(),
        // Lever 5: attach a referral code the customer arrived with.
        referralCode: z.string().optional(),
        // Lever 4: attach a partner tracking code (?ref= on public site).
        partnerTrackingCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);

      // Customer identity is profile-based, not role-based: this flow pins
      // customerId to the caller (ctx.user.id), so the caller must be a
      // bookable customer — i.e. own a CustomerProfile AND have completed
      // onboarding (licence + signed agreements). This admits CUSTOMER users
      // and back-office users (STAFF/MANAGER/ADMIN/SUPER_ADMIN) who carry a
      // profile and have onboarded; it rejects un-onboarded staff and any
      // profile-less account, keeping the booking resolvable in the
      // back-office customer directory. protectedProcedure does NOT gate
      // back-office sessions on onboarding (it would lock them out of the
      // back office), so we enforce it here. Staff booking on a customer's
      // behalf must use staffBooking.createWalkIn.
      const customerForEligibility = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: {
          dateOfBirth: true,
          customerProfile: {
            select: {
              onboardedAt: true,
              onboardingVersion: true,
              licenceClass: true,
              licenceExpiry: true,
              passportNumber: true,
              passportExpiry: true,
              licenceType: true,
              licenceImageFront: true,
              passportImage: true,
            },
          },
        },
      });
      if (!canRentAsCustomer(customerForEligibility.customerProfile)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Complete customer onboarding before booking online.",
        });
      }

      // Depot hours gate — pickup + return must fall inside the respective
      // depot's published operating hours (timezone + holiday overrides
      // respected). Runs before eligibility so the error surfaces on the
      // date field rather than leaking through as an age/licence failure.
      await enforceBookingTimesWithinHours(ctx.prisma, {
        pickupDepotId: input.pickupDepotId,
        returnDepotId: input.returnDepotId,
        pickupDateTime: input.pickupDateTime,
        returnDateTime: input.returnDateTime,
      });

      // A3 + A4: eligibility (age + licence class/expiry) before we commit
      // a booking. Reject impossible quotes early so we don't create a row
      // that will fail at check-out anyway. Reuses customerForEligibility
      // fetched above for the onboarding guard.
      const categoryForEligibility =
        await ctx.prisma.vehicleCategory.findUniqueOrThrow({
          where: { id: input.categoryId },
          select: { name: true, licenceRequired: true, minAge: true },
        });
      const eligibility = checkEligibility({
        customer: {
          dateOfBirth: customerForEligibility.dateOfBirth,
          licenceClass:
            customerForEligibility.customerProfile?.licenceClass ?? null,
          licenceExpiry:
            customerForEligibility.customerProfile?.licenceExpiry ?? null,
          passportNumber:
            customerForEligibility.customerProfile?.passportNumber ?? null,
          passportExpiry:
            customerForEligibility.customerProfile?.passportExpiry ?? null,
          licenceType:
            customerForEligibility.customerProfile?.licenceType ?? null,
          licenceImageFront:
            customerForEligibility.customerProfile?.licenceImageFront ?? null,
          passportImage:
            customerForEligibility.customerProfile?.passportImage ?? null,
        },
        category: categoryForEligibility,
        pickupDate: input.pickupDateTime,
      });
      if (eligibility.failure) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: eligibility.failure.message,
        });
      }
      // Stash the basis + warnings on the request so downstream audit / UI
      // can see which document carried the decision. `basis: "passport"` for
      // a motorcycle category is the scenario staff need to pay attention to.
      const eligibilityBasis = eligibility.basis;
      const eligibilityWarnings = eligibility.warnings;

      const avail = await countAvailable(ctx.prisma, {
        categoryId: input.categoryId,
        depotId: input.pickupDepotId,
        pickup: input.pickupDateTime,
        ret: input.returnDateTime,
      });
      if (avail.available <= 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "No vehicles available for selected dates",
        });
      }

      let pricing;
      try {
        pricing = await quotePricing(ctx.prisma, {
          categoryId: input.categoryId,
          pickupDateTime: input.pickupDateTime,
          returnDateTime: input.returnDateTime,
          pickupDepotId: input.pickupDepotId,
          returnDepotId: input.returnDepotId,
          addons: input.addons,
          insuranceOptionId: input.insuranceOptionId,
          discountCode: input.discountCode,
          deliveryFee: input.deliveryFee ?? 0,
        });
      } catch (err) {
        if (
          err instanceof OneWayDisallowedError ||
          err instanceof MinimumRentalPeriodError
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

      const addonsCreate = input.addons
        ? await Promise.all(
            input.addons.map(async (a) => {
              const addon = await ctx.prisma.addon.findUniqueOrThrow({
                where: { id: a.addonId },
              });
              const unit = addon.isPerDay
                ? Number(addon.dailyRate ?? 0)
                : Number(addon.flatRate ?? 0);
              return {
                addonId: a.addonId,
                quantity: a.quantity,
                unitPrice: unit,
                totalPrice: addon.isPerDay
                  ? unit * pricing.durationDays * a.quantity
                  : unit * a.quantity,
              };
            }),
          )
        : undefined;

      const booking = await withUniqueRetry(
        () =>
          ctx.prisma.booking.create({
            data: {
              bookingReference: generateBookingReference(),
              customerId: ctx.user.id,
              categoryId: input.categoryId,
              depotId: input.pickupDepotId,
              pickupDepotId: input.pickupDepotId,
              returnDepotId: input.returnDepotId,
              pickupDateTime: input.pickupDateTime,
              returnDateTime: input.returnDateTime,
              durationDays: pricing.durationDays,
              subtotal: pricing.baseSubtotal,
              discountAmount: pricing.discountAmount,
              addonTotal: pricing.addonTotal,
              insuranceTotal: pricing.insuranceTotal,
              deliveryFee: pricing.deliveryFee,
              bondAmount: pricing.bondAmount,
              gstAmount: pricing.gstAmount,
              totalAmount: pricing.totalAmount,
              // Phase A1 — snapshot the online portion on the booking so
              // admin finance and the staff payment console can reconcile
              // "paid online vs. due at pickup" without re-running pricing.
              payOnlineAmount: pricing.payOnlineAmount,
              balanceDue: pricing.totalAmount,
              pricingSnapshot: JSON.parse(JSON.stringify(pricing)),
              status: "PENDING_PAYMENT",
              source: "WEBSITE",
              agreedToTerms: true,
              termsVersion: input.termsVersion,
              signatureUrl: input.signatureDataUrl,
              isDelivery: input.isDelivery ?? false,
              notes: input.notes,
              createdById: ctx.user.id,
              addons: addonsCreate ? { create: addonsCreate } : undefined,
              insurance: input.insuranceOptionId
                ? {
                    create: {
                      insuranceOptionId: input.insuranceOptionId,
                      dailyRate: pricing.insuranceTotal / pricing.durationDays,
                      totalPrice: pricing.insuranceTotal,
                    },
                  }
                : undefined,
              statusLog: {
                create: { newStatus: "PENDING_PAYMENT", changedById: ctx.user.id },
              },
            },
          }),
        { constraintFields: ["bookingReference"] },
      );

      // Ensure the Stripe Customer exists before creating PaymentIntents.
      // Attaching both the rental PI and the bond hold to the same
      // Customer + saving the rental PM (setup_future_usage) is what lets
      // us reuse the card across both confirmations. Non-fatal: a Stripe
      // hiccup here just means we skip attachment and fall through to
      // stub-style handling (rare; typically means the sandbox is down).
      let stripeCustomerId: string | null = null;
      try {
        stripeCustomerId = await ensureStripeCustomer(ctx.user.id, {
          prisma: ctx.prisma,
        });
      } catch {
        // non-fatal — PI creation below will still work for stub ids
      }

      // Phase A1 — if strategy is ZERO we still need to create the
      // booking, but there's no online charge to authorise. Skip the
      // PaymentIntent in that case; the booking's balanceDue will be
      // collected in full at pickup via the staff console.
      const { getBranding } = await import("@/lib/branding");
      const { siteName } = await getBranding();
      const paymentIntent =
        pricing.payOnlineAmount > 0
          ? await createPaymentIntent({
              amount: pricing.payOnlineAmount,
              bookingId: booking.id,
              customerEmail: ctx.session.user.email ?? "unknown@example.com",
              description: `${siteName} booking ${booking.bookingReference}`,
              customerId: stripeCustomerId,
            })
          : null;

      // Phase D — also kick off a SetupIntent so the wizard can save the
      // customer's card on file for future charges (mid-rental extensions,
      // end-of-rental settlement, recurring long-term billing). Failure is
      // non-fatal so a Stripe hiccup at this step doesn't block booking
      // creation. When already saved, this is a no-op at the UI layer
      // (wizard only renders Elements when clientSecret is returned).
      let setupClientSecret: string | null = null;
      try {
        const si = await createSetupIntentForUser(ctx.user.id, { prisma: ctx.prisma });
        setupClientSecret = si.clientSecret;
      } catch {
        // non-fatal — customer can still pay the online charge without
        // saving a card; long-term recurring and post-rental charges
        // will surface a "Pay now" link instead.
      }

      const bondIntent =
        pricing.bondAmount > 0
          ? await createBondHold({
              amount: pricing.bondAmount,
              bookingId: booking.id,
              customerEmail: ctx.session.user.email ?? "unknown@example.com",
              description: booking.bookingReference,
              customerId: stripeCustomerId,
            })
          : null;

      // Lever 5 + Lever 4: best-effort attribution. Never blocks the
      // booking if lookup fails.
      if (input.referralCode) {
        try {
          await applyReferral(ctx.prisma, {
            code: input.referralCode,
            refereeId: ctx.user.id,
            refereeEmail: ctx.session.user.email ?? undefined,
            bookingId: booking.id,
          });
        } catch {
          // non-fatal
        }
      }
      if (input.partnerTrackingCode) {
        try {
          await attachByTrackingCode(ctx.prisma, {
            bookingId: booking.id,
            trackingCode: input.partnerTrackingCode,
          });
        } catch {
          // non-fatal
        }
      }

      const bookingCreatedAudit = {
        userId: ctx.user.id,
        action: "BOOKING_CREATED",
        reqId: ctx.reqId,
        newData: {
          bookingId: booking.id,
          reference: booking.bookingReference,
          categoryId: input.categoryId,
          pickupDepotId: input.pickupDepotId,
          returnDepotId: input.returnDepotId,
          pickupDateTime: input.pickupDateTime,
          returnDateTime: input.returnDateTime,
          total: Number(booking.totalAmount),
          source: booking.source,
          eligibilityBasis,
          eligibilityWarnings: eligibilityWarnings.map((w) => w.code),
        },
      };
      writeCustomerAuditAsync(ctx.prisma, ctx.user.id, bookingCreatedAudit);
      // Companion row so the customer's own booking creation surfaces on the
      // booking's Activity tab. Shares reqId with the customer row above.
      writeBookingAuditAsync(ctx.prisma, booking.id, bookingCreatedAudit);

      await trackServer({
        event: "booking.created",
        distinctId: ctx.user.id,
        properties: {
          bookingId: booking.id,
          reference: booking.bookingReference,
          categoryId: input.categoryId,
          pickupDepotId: input.pickupDepotId,
          durationDays: booking.durationDays,
          totalAud: Number(booking.totalAmount),
          isDelivery: booking.isDelivery,
          source: booking.source,
        },
      });

      return {
        booking,
        paymentClientSecret: paymentIntent?.clientSecret ?? null,
        paymentIntentId: paymentIntent?.id ?? null,
        bondClientSecret: bondIntent?.clientSecret ?? null,
        bondIntentId: bondIntent?.id ?? null,
        // Phase D — wizard uses this to render a "Save card for recurring
        // charges" Stripe Element when a card-on-file isn't already set.
        setupClientSecret,
        stripeEnabled: paymentIntent ? !paymentIntent.id.startsWith("pi_stub_") : false,
        // Surface the pricing breakdown directly so the wizard can render
        // "Pay now / Pay at pickup / Bond" without re-quoting.
        payOnlineAmount: pricing.payOnlineAmount,
        remainderDueAtPickup: pricing.remainderDueAtPickup,
        bondAmount: pricing.bondAmount,
        isLongTerm: pricing.isLongTerm,
        recurringFrequency: pricing.recurringFrequency,
        recurringAmount: pricing.recurringAmount,
        recurringPeriodsTotal: pricing.recurringPeriodsTotal,
        firstPeriodAmount: pricing.firstPeriodAmount,
      };
    }),

  confirmPayment: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        // Optional for ZERO-strategy bookings where no online PaymentIntent
        // was created. Still required for every other strategy.
        paymentIntentId: z.string().optional(),
        bondPaymentIntentId: z.string().optional(),
        preferredVehicleId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { customerId: true },
      });
      if (owner.customerId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });

      try {
        const { booking } = await confirmBookingPayment(ctx.prisma, {
          bookingId: input.bookingId,
          paymentIntentId: input.paymentIntentId,
          bondPaymentIntentId: input.bondPaymentIntentId,
          preferredVehicleId: input.preferredVehicleId,
          actorUserId: ctx.user.id,
          source: "checkout",
          reqId: ctx.reqId,
        });
        // Idempotent on retry: a booking already CONFIRMED (client retry
        // after a transient failure, or the Stripe webhook beat us to it)
        // returns the confirmed row without re-running side effects.
        return booking;
      } catch (err) {
        if (
          err instanceof PaymentNotSucceededError ||
          err instanceof BondNotHeldError
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof BookingNotConfirmableError) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This booking can no longer be confirmed. Please contact us and quote your booking reference.",
          });
        }
        if (isBookingOverlapViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "That vehicle was just booked by someone else. Please pick another time or vehicle.",
          });
        }
        throw err;
      }
    }),

  /**
   * B3: extend a live booking in place. Re-checks availability on the
   * same vehicle for the extension window (nobody else has it in the new
   * time), prices the extra days at current (live) rates via C4, creates
   * an EXTENSION payment for the delta, and updates the return date.
   *
   * Kept as a single booking row rather than a parent/child pair — the
   * common case is "stay a few more days" and a single row is easier for
   * staff to reason about. If chained extensions become common we can
   * revisit using the `extensionOfId` self-ref.
   */
  extend: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        newReturnDateTime: z.coerce.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: {
          addons: { include: { addon: true } },
          insurance: true,
          category: { select: { id: true, name: true } },
          customer: { select: { firstName: true } },
        },
      });
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (booking.customerId !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!["CONFIRMED", "CHECKED_OUT", "ACTIVE"].includes(booking.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot extend booking in status ${booking.status}`,
        });
      }
      const oldReturn = booking.returnDateTime;
      if (input.newReturnDateTime.getTime() <= oldReturn.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New return time must be after the current return time",
        });
      }

      // Depot hours gate — the new return must fall inside the return
      // depot's published hours (timezone + holiday overrides respected).
      await enforceDateTimeWithinDepotHours(
        ctx.prisma,
        booking.returnDepotId,
        input.newReturnDateTime,
        "return",
      );

      // Availability: the vehicle must be free from the moment the
      // current return slot ends to the new return. If a vehicle hasn't
      // been allocated yet (rare — extension pre-check-out), fall through
      // to category-level availability instead.
      if (booking.vehicleId) {
        const free = await isVehicleFree(ctx.prisma, {
          vehicleId: booking.vehicleId,
          pickup: oldReturn,
          ret: input.newReturnDateTime,
          excludeBookingId: booking.id,
        });
        if (!free) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Your vehicle is booked by someone else for that window — pick an earlier return date or contact the depot for a swap.",
          });
        }
      } else {
        const avail = await countAvailable(ctx.prisma, {
          categoryId: booking.categoryId,
          depotId: booking.pickupDepotId,
          pickup: oldReturn,
          ret: input.newReturnDateTime,
        });
        if (avail.available <= 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "No vehicles available for the extension window",
          });
        }
      }

      const perDayAddons = booking.addons
        .filter((a) => a.addon.isPerDay)
        .map((a) => ({
          unitPrice: Number(a.unitPrice),
          quantity: a.quantity,
        }));
      const extensionQuote = await quoteExtension(ctx.prisma, {
        categoryId: booking.categoryId,
        oldReturnDateTime: oldReturn,
        newReturnDateTime: input.newReturnDateTime,
        perDayAddons,
        perDayInsuranceRate: booking.insurance[0]
          ? Number(booking.insurance[0].dailyRate)
          : 0,
      });

      const newTotal =
        Number(booking.totalAmount) + extensionQuote.totalAmount;
      const newBalance = Number(booking.balanceDue) + extensionQuote.totalAmount;
      const newDuration =
        booking.durationDays + extensionQuote.extensionDays;

      const updated = await ctx.prisma.booking.update({
        where: { id: booking.id },
        data: {
          returnDateTime: input.newReturnDateTime,
          durationDays: newDuration,
          totalAmount: newTotal,
          balanceDue: newBalance,
          bookingNotes: {
            create: {
              userId: ctx.user.id,
              note: `Extended return by ${extensionQuote.extensionDays} day(s) → ${input.newReturnDateTime.toLocaleString("en-AU")}. Extension charge A$${extensionQuote.totalAmount.toFixed(2)} (current rates).`,
              isInternal: false,
            },
          },
          statusLog: {
            create: {
              previousStatus: booking.status,
              newStatus: booking.status,
              changedById: ctx.user.id,
              reason: `Extended by ${extensionQuote.extensionDays} day(s) — delta A$${extensionQuote.totalAmount.toFixed(2)}`,
            },
          },
          payments: {
            create: {
              reference: `EXT-${Date.now()}`,
              customerId: booking.customerId,
              type: "EXTENSION",
              method: "STRIPE",
              amount: extensionQuote.totalAmount,
              gstAmount: extensionQuote.gstAmount,
              status: "PENDING",
              notes: `Extension +${extensionQuote.extensionDays} day(s)`,
            },
          },
        },
      });

      // Issue an ATO §29-75 adjustment note for the extension delta. The
      // booking row carries the extension Payment we just created (status
      // PENDING — captured separately); we link it to the adjustment so
      // staff and the customer can trace the charge back to its
      // document.
      try {
        const { tryIssueAdjustmentForBooking } = await import(
          "@/server/services/invoice-lifecycle"
        );
        const extPayment = await ctx.prisma.payment.findFirst({
          where: { bookingId: booking.id, type: "EXTENSION" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        await tryIssueAdjustmentForBooking({
          bookingId: booking.id,
          type: "INCREASE",
          reason: "EXTENSION",
          description: `Booking extension — +${extensionQuote.extensionDays} day(s) at current rates`,
          lineItems: [
            {
              description: `Extension — ${extensionQuote.extensionDays} additional day(s)`,
              detail: `New return ${input.newReturnDateTime.toLocaleString("en-AU")}`,
              quantity: extensionQuote.extensionDays,
              unitPrice:
                extensionQuote.extensionDays > 0
                  ? extensionQuote.totalAmount / extensionQuote.extensionDays
                  : extensionQuote.totalAmount,
              totalPrice: extensionQuote.totalAmount,
              gstAmount: extensionQuote.gstAmount,
              gstIncluded: true,
            },
          ],
          paymentId: extPayment?.id ?? null,
          issuedById: ctx.user.id,
        });
      } catch {
        // tryIssueAdjustmentForBooking already swallows + logs; this
        // outer guard catches the dynamic import failure path only.
      }

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_EXTENDED",
        entity: "Booking",
        entityId: booking.id,
        previousData: {
          returnDateTime: oldReturn,
          durationDays: booking.durationDays,
          totalAmount: Number(booking.totalAmount),
        },
        newData: {
          returnDateTime: input.newReturnDateTime,
          durationDays: newDuration,
          totalAmount: newTotal,
          extensionAmount: extensionQuote.totalAmount,
          extensionDays: extensionQuote.extensionDays,
        },
      });
      writeCustomerAuditAsync(ctx.prisma, booking.customerId, {
        userId: ctx.user.id,
        action: "BOOKING_EXTENDED",
        reqId: ctx.reqId,
        previousData: {
          bookingId: booking.id,
          returnDateTime: oldReturn,
          durationDays: booking.durationDays,
          totalAmount: Number(booking.totalAmount),
        },
        newData: {
          bookingId: booking.id,
          reference: booking.bookingReference,
          returnDateTime: input.newReturnDateTime,
          durationDays: newDuration,
          totalAmount: newTotal,
          extensionAmount: extensionQuote.totalAmount,
          extensionDays: extensionQuote.extensionDays,
        },
      });

      const { siteName: extendSiteName } = await getBranding();
      const extendHtml = await renderEmail(
        createElement(BookingModified, {
          customerName: booking.customer.firstName,
          bookingReference: booking.bookingReference,
          previousReturn: formatDateTime(oldReturn),
          newReturn: formatDateTime(input.newReturnDateTime),
          extensionDays: extensionQuote.extensionDays,
          extensionCharge: formatCurrency(extensionQuote.totalAmount),
        }),
      );
      await sendNotification({
        userId: booking.customerId,
        type: "BOOKING_EXTENDED",
        channels: ["EMAIL", "SMS"],
        subject: `Booking extended — ${booking.bookingReference}`,
        title: "Booking extended",
        body: `Your ${extendSiteName} booking ${booking.bookingReference} has been extended by ${extensionQuote.extensionDays} day(s).\n\nNew return: ${formatDateTime(input.newReturnDateTime)}\nExtension charge: ${formatCurrency(extensionQuote.totalAmount)}`,
        html: extendHtml,
        bookingId: booking.id,
        data: {
          bookingReference: booking.bookingReference,
          extensionDays: extensionQuote.extensionDays,
          extensionCharge: extensionQuote.totalAmount,
          newReturnAt: input.newReturnDateTime.toISOString(),
        },
        sentById: ctx.user.id,
      });

      return { booking: updated, extensionQuote };
    }),

  /**
   * Lever 7: one-tap excess-reduction / insurance upsell applied to an
   * existing booking. Works from CONFIRMED through ACTIVE — extends the
   * insurance attach to mid-rental micro-upsells (pre-pickup, weather,
   * telemetry-triggered).
   *
   * Charges the delta only (daysRemaining × dailyRate), leaving any
   * previously-attached insurance in place. The `source` field on
   * BookingInsurance lets analytics attribute conversion to the trigger.
   */
  addInsuranceMidRental: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        insuranceOptionId: z.string(),
        source: z
          .enum(["PRE_PICKUP_UPSELL", "MID_RENTAL", "WEATHER_TRIGGER", "TELEMETRY_TRIGGER"])
          .default("MID_RENTAL"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (booking.customerId !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!["CONFIRMED", "CHECKED_OUT", "ACTIVE"].includes(booking.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot add insurance on a booking in status ${booking.status}`,
        });
      }

      const option = await ctx.prisma.insuranceOption.findUniqueOrThrow({
        where: { id: input.insuranceOptionId },
      });

      // Charge per day from today to return — ensures customer isn't
      // charged for days already elapsed on a mid-rental attach.
      const anchor = new Date(
        Math.max(new Date().getTime(), booking.pickupDateTime.getTime()),
      );
      const remainingMs = booking.returnDateTime.getTime() - anchor.getTime();
      const remainingDays = Math.max(1, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
      const dailyRate = Number(option.dailyRate);
      const total = Math.round(dailyRate * remainingDays * 100) / 100;
      const gstAmount = gstFromInclusive(total).toNumber();

      await ctx.prisma.$transaction(async (tx) => {
        await tx.bookingInsurance.create({
          data: {
            bookingId: booking.id,
            insuranceOptionId: option.id,
            dailyRate,
            totalPrice: total,
            source: input.source,
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            insuranceTotal: { increment: total },
            totalAmount: { increment: total },
            balanceDue: { increment: total },
            gstAmount: { increment: gstAmount },
            bookingNotes: {
              create: {
                userId: ctx.user.id,
                note: `Added ${option.name} insurance mid-rental (source: ${input.source}) — A$${total.toFixed(2)} over ${remainingDays} day(s).`,
                isInternal: false,
              },
            },
            payments: {
              create: {
                reference: `INS-${Date.now()}`,
                customerId: booking.customerId,
                type: "ADDON_CHARGE",
                method: "STRIPE",
                amount: total,
                gstAmount,
                status: "PENDING",
                notes: `Insurance attach: ${option.name} (${input.source})`,
              },
            },
          },
        });
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "INSURANCE_MID_RENTAL_ADDED",
        entity: "Booking",
        entityId: booking.id,
        newData: {
          insuranceOptionId: option.id,
          source: input.source,
          charged: total,
        },
      });
      writeCustomerAuditAsync(ctx.prisma, booking.customerId, {
        userId: ctx.user.id,
        action: "INSURANCE_MID_RENTAL_ADDED",
        reqId: ctx.reqId,
        newData: {
          bookingId: booking.id,
          reference: booking.bookingReference,
          insuranceOptionId: option.id,
          source: input.source,
          charged: total,
        },
      });

      return { charged: total, remainingDays, insuranceOption: option };
    }),

  /**
   * Preview the refund a cancellation would produce. Owner-or-staff only.
   * Pure read — safe to call on dialog open so the customer sees the tier
   * before confirming. See `bookingCancellation.quoteCancellation` for
   * policy interpretation (full / half / none) and ineligibility reasons.
   */
  quoteCancellation: protectedProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { customerId: true },
      });
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (b.customerId !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return quoteCancellationService(input.bookingId, ctx.prisma);
    }),

  /**
   * Customer-initiated booking cancellation. Delegates to the shared
   * `bookingCancellation.cancel` service so behaviour is identical to the
   * staff flow (refund calc, bond release, Stripe refund, email). Gated
   * to pre-check-out statuses and blocked on DISPUTED / subscription
   * parents / extension children per the plan contract.
   */
  cancel: protectedProcedure
    .use(
      trpcRateLimit({
        bucket: "booking-cancel",
        limit: 10,
        windowSec: 3600,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(
      z.object({
        bookingId: z.string(),
        reasonCode: z.enum([
          "CHANGED_PLANS",
          "WEATHER",
          "FOUND_ALTERNATIVE",
          "OTHER",
        ]),
        reasonDetail: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { customerId: true },
      });
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (b.customerId !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const reasonLabel: Record<typeof input.reasonCode, string> = {
        CHANGED_PLANS: "Changed plans",
        WEATHER: "Weather",
        FOUND_ALTERNATIVE: "Found alternative",
        OTHER: "Other",
      };
      const reason = input.reasonDetail
        ? `${reasonLabel[input.reasonCode]}: ${input.reasonDetail}`
        : reasonLabel[input.reasonCode];
      return cancelBookingService(
        {
          bookingId: input.bookingId,
          reason,
          source: "CUSTOMER",
          actorUserId: ctx.user.id,
        },
        ctx.prisma,
      );
    }),

  /**
   * Read-only extension price preview. Identical rules to `extend` —
   * availability + depot hours + pricing — but returns the quote without
   * committing. Used by the customer UI to show cost before confirm.
   */
  quoteExtend: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        newReturnDateTime: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: {
          addons: { include: { addon: true } },
          insurance: true,
        },
      });
      const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
        ctx.user.role,
      );
      if (booking.customerId !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!["CONFIRMED", "CHECKED_OUT", "ACTIVE"].includes(booking.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot extend booking in status ${booking.status}`,
        });
      }
      const oldReturn = booking.returnDateTime;
      if (input.newReturnDateTime.getTime() <= oldReturn.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New return time must be after the current return time",
        });
      }
      await enforceDateTimeWithinDepotHours(
        ctx.prisma,
        booking.returnDepotId,
        input.newReturnDateTime,
        "return",
      );
      // Mirror the availability gate from `extend` so the dialog surfaces a
      // real conflict before Confirm is clicked. Excludes the booking being
      // extended — its current returnDateTime sits exactly at the start of
      // the requested window and would self-match the buffer-padded search.
      if (booking.vehicleId) {
        const free = await isVehicleFree(ctx.prisma, {
          vehicleId: booking.vehicleId,
          pickup: oldReturn,
          ret: input.newReturnDateTime,
          excludeBookingId: booking.id,
        });
        if (!free) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Your vehicle is booked by someone else for that window — pick an earlier return date or contact the depot for a swap.",
          });
        }
      }
      const perDayAddons = booking.addons
        .filter((a) => a.addon.isPerDay)
        .map((a) => ({ unitPrice: Number(a.unitPrice), quantity: a.quantity }));
      const quote = await quoteExtension(ctx.prisma, {
        categoryId: booking.categoryId,
        oldReturnDateTime: oldReturn,
        newReturnDateTime: input.newReturnDateTime,
        perDayAddons,
        perDayInsuranceRate: booking.insurance[0]
          ? Number(booking.insurance[0].dailyRate)
          : 0,
      });
      return {
        quote,
        currentReturn: oldReturn.toISOString(),
        currentTotal: Number(booking.totalAmount),
        currentBalanceDue: Number(booking.balanceDue),
        newTotal: Number(booking.totalAmount) + quote.totalAmount,
        newBalanceDue: Number(booking.balanceDue) + quote.totalAmount,
      };
    }),

  listAll: staffProcedure
    .input(
      z.object({
        status: z.string().optional(),
        depotId: z.string().optional(),
        take: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.booking.findMany({
        where: {
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        include: {
          customer: true,
          vehicle: true,
          category: true,
          pickupDepot: true,
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });
      const nextCursor = items.length > input.take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),
});
