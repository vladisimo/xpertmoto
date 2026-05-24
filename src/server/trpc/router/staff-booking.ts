import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, staffProcedure } from "../trpc";
import {
  allocateVehicle,
  acquireAllocationLock,
  countAvailable,
  isBookingOverlapViolation,
  isVehicleFree,
} from "@/server/services/availability";
import { quoteExtension } from "@/server/services/pricing";
import { calcEarlyReturnRefund } from "@/server/services/fees";
import { checkEligibility } from "@/server/services/eligibility";
import {
  enforceBookingTimesWithinHours,
  enforceDateTimeWithinDepotHours,
} from "@/server/services/booking-times-guard";
import { sendNotification } from "@/server/services/notification-sender";
import { cancel as cancelBookingService } from "@/server/services/booking-cancellation";
import { refundCharge } from "@/lib/stripe";
import {
  captureBookingId,
  captureCustomerId,
  readCapturedBookingId,
  readCapturedCustomerId,
  skipAutoAudit,
  writeAudit,
  writeCustomerAuditAsync,
} from "@/server/services/audit";
import {
  AUDIT_CATEGORIES,
  AUDIT_STATUSES,
  buildAuditWhere,
} from "@/server/services/audit-query";
import { trackServer } from "@/lib/analytics";
import { BOOKING_RULES, CANCELLATION_POLICY } from "@/lib/constants";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import {
  recordBookingCompletion,
  recordAdditionalCharges,
  invalidateRevenueCaches,
} from "@/server/services/revenue-aggregator";
import { markPartnerTransactionsPayable } from "@/server/services/partner";
import { qualifyReferral } from "@/server/services/referral";
import { autoCloseByTarget } from "@/server/services/staff-tasks";

// In-memory rate limiters for the staff resend actions. Module-scope Map —
// survives across requests in a single Node process. For multi-instance
// deployments the Redis rate-limiter in `src/server/services/rate-limit.ts`
// would be the right swap, but that module is already known to fail open in
// dev and the blast radius of a double-click is one extra email, not a
// security issue.
const RESEND_MIN_INTERVAL_MS = 60_000;
const resendConfirmationLastSent = new Map<string, number>();
const resendInvoiceLastSent = new Map<string, number>();

export const staffBookingRouter = createTRPCRouter({
  checkoutPrereqs: staffProcedure.query(async () => {
    const s = await getSettings(["booking.requireLicenceVerification"] as const);
    return {
      requireLicenceVerification:
        s["booking.requireLicenceVerification"] ??
        SETTING_DEFAULTS["booking.requireLicenceVerification"],
    };
  }),

  calendarRange: staffProcedure
    .input(
      z.object({
        start: z.string(),
        end: z.string(),
        depotId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const start = new Date(input.start);
      const end = new Date(input.end);
      return ctx.prisma.booking.findMany({
        where: {
          pickupDateTime: { lt: end },
          returnDateTime: { gt: start },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        select: {
          id: true,
          bookingReference: true,
          status: true,
          pickupDateTime: true,
          returnDateTime: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
          category: { select: { id: true, name: true } },
          pickupDepot: { select: { id: true, name: true } },
          vehicle: { select: { id: true, internalCode: true } },
        },
        orderBy: { pickupDateTime: "asc" },
      });
    }),

  list: staffProcedure
    .input(
      z.object({
        status: z.string().optional(),
        depotId: z.string().optional(),
        search: z.string().optional(),
        take: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.booking.findMany({
        where: {
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.depotId ? { depotId: input.depotId } : {}),
          ...(input.search
            ? {
                OR: [
                  {
                    bookingReference: {
                      contains: input.search,
                      mode: "insensitive",
                    },
                  },
                  {
                    customer: {
                      email: { contains: input.search, mode: "insensitive" },
                    },
                  },
                  {
                    customer: {
                      firstName: {
                        contains: input.search,
                        mode: "insensitive",
                      },
                    },
                  },
                  {
                    customer: {
                      lastName: { contains: input.search, mode: "insensitive" },
                    },
                  },
                ],
              }
            : {}),
        },
        include: {
          customer: true,
          vehicle: true,
          category: true,
          pickupDepot: true,
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { pickupDateTime: "desc" },
      });
      const nextCursor = items.length > input.take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  detail: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUnique({
        where: { id: input.id },
        include: {
          customer: { include: { customerProfile: true } },
          vehicle: true,
          category: true,
          depot: true,
          pickupDepot: true,
          returnDepot: true,
          addons: { include: { addon: true } },
          insurance: { include: { insuranceOption: true } },
          payments: { orderBy: { createdAt: "desc" } },
          inspections: {
            orderBy: { dateTime: "desc" },
            include: {
              inspector: { select: { firstName: true, lastName: true } },
            },
          },
          incidents: { orderBy: { dateTime: "desc" } },
          infringements: { orderBy: { offenceDate: "desc" } },
          invoices: { orderBy: { createdAt: "desc" } },
          bookingNotes: {
            orderBy: { createdAt: "desc" },
            include: {
              user: { select: { firstName: true, lastName: true, role: true } },
            },
          },
          statusLog: { orderBy: { timestamp: "desc" } },
          bondLedger: true,
          createdBy: { select: { firstName: true, lastName: true } },
          confirmedBy: { select: { firstName: true, lastName: true } },
          checkedOutBy: { select: { firstName: true, lastName: true } },
          checkedInBy: { select: { firstName: true, lastName: true } },
          cancelledBy: { select: { firstName: true, lastName: true } },
        },
      });
      if (!b) throw new TRPCError({ code: "NOT_FOUND" });
      return b;
    }),

  /**
   * Every AuditLog row tagged to this booking (entity='Booking',
   * entityId=bookingId). Mirrors `staffCustomer.activityLog`. Booking-affecting
   * mutations across the routers tag a companion 'Booking' row (via the
   * auto-audit `bookingIdPath` hook or a manual `writeBookingAuditAsync`), so
   * this single scope captures every event any user — staff or customer —
   * performed against the booking.
   */
  activityLog: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
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
        AND: [buildAuditWhere(input), { entity: "Booking", entityId: input.bookingId }],
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

  addNote: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        note: z.string().min(1),
        isInternal: z.boolean().default(true),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: { customerId: true },
      });
      captureCustomerId(ctx, b?.customerId);
      return ctx.prisma.bookingNote.create({
        data: {
          bookingId: input.bookingId,
          userId: ctx.user.id,
          note: input.note,
          isInternal: input.isInternal,
        },
      });
    }),

  // Staff-triggered re-send of the booking confirmation email. Rebuilds the
  // same body the customer received at booking.confirmPayment — kept as a
  // local composer rather than extracting because the original is tightly
  // coupled to `booking.confirmPayment`'s shape and extracting risks subtle
  // drift. In-memory rate limit (one send per 60s per bookingId) to stop
  // accidental double-clicks from spamming the customer inbox.
  resendConfirmation: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const last = resendConfirmationLastSent.get(input.bookingId);
      if (last && now - last < RESEND_MIN_INTERVAL_MS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Please wait ${Math.ceil(
            (RESEND_MIN_INTERVAL_MS - (now - last)) / 1000,
          )}s before resending this confirmation.`,
        });
      }

      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: {
          category: { select: { name: true } },
          pickupDepot: true,
          customer: { select: { id: true, firstName: true } },
        },
      });
      captureCustomerId(ctx, booking.customerId);

      const totalAud = Number(booking.totalAmount);
      const payOnline = Number(booking.payOnlineAmount);
      const remainder = Math.max(0, totalAud - payOnline);
      const bondAud = Number(booking.bondAmount);
      const snap = booking.pricingSnapshot as {
        isLongTerm?: boolean;
        recurringFrequency?: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
        recurringAmount?: number;
        recurringPeriodsTotal?: number;
      };

      // Re-attach the same documents the customer would have received from
      // the original confirmation, plus any post-confirmation documents
      // (signed agreement, return assessment) that exist now. Mirror what
      // booking.confirmPayment + staff.checkOut + staff.checkIn would have
      // sent — staff hits this when the customer says "I never got it".
      const [issuedInvoice, onlinePayment, signedAgreement, signedAssessment] =
        await Promise.all([
          ctx.prisma.invoice.findFirst({
            where: { bookingId: booking.id, deletedAt: null, status: { not: "VOID" } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          }),
          ctx.prisma.payment.findFirst({
            where: {
              bookingId: booking.id,
              type: "BOOKING_PAYMENT",
              status: "SUCCEEDED",
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          }),
          ctx.prisma.rentalAgreement.findFirst({
            where: { bookingId: booking.id, status: "SIGNED" },
            orderBy: { version: "desc" },
            select: { id: true },
          }),
          ctx.prisma.returnAssessment.findFirst({
            where: { bookingId: booking.id, status: "SIGNED" },
            orderBy: { version: "desc" },
            select: { id: true },
          }),
        ]);

      const { getBranding } = await import("@/lib/branding");
      const branding = await getBranding();
      const { default: BookingConfirmationEmail } = await import(
        "../../../../emails/booking-confirmation"
      );
      const { render: renderEmailFn } = await import("@react-email/render");
      const { createElement } = await import("react");
      const { formatCurrency, formatDateTime } = await import("@/lib/utils");

      const recurringSummary =
        snap.isLongTerm &&
        snap.recurringFrequency &&
        snap.recurringAmount &&
        snap.recurringPeriodsTotal
          ? (() => {
              const freqLower = snap.recurringFrequency!.toLowerCase();
              const periodWord = freqLower.replace(/ly$/, "");
              return `Long-term hire: today's payment covers your first ${periodWord}. Then ${formatCurrency(
                snap.recurringAmount!,
              )} ${freqLower} × ${snap.recurringPeriodsTotal} period(s) is charged automatically to your card on file.`;
            })()
          : null;
      const portalUrl = `${
        process.env.AUTH_URL ??
        process.env.APP_URL ??
        process.env.NEXTAUTH_URL ??
        "http://localhost:3000"
      }/dashboard/bookings/${booking.id}`;
      const depotAddress = [
        booking.pickupDepot.addressLine1,
        booking.pickupDepot.addressLine2,
        `${booking.pickupDepot.suburb} ${booking.pickupDepot.state} ${booking.pickupDepot.postcode}`,
      ]
        .filter(Boolean)
        .join(", ");
      const html = await renderEmailFn(
        createElement(BookingConfirmationEmail, {
          customerName: booking.customer?.firstName ?? "there",
          bookingReference: booking.bookingReference,
          categoryName: booking.category.name,
          pickupDepotName: booking.pickupDepot.name,
          pickupDepotAddress: depotAddress,
          pickupDateTime: formatDateTime(booking.pickupDateTime),
          returnDateTime: formatDateTime(booking.returnDateTime),
          durationDays: booking.durationDays,
          totalAmount: formatCurrency(totalAud),
          paidOnline: formatCurrency(payOnline),
          dueAtPickup: remainder > 0 ? formatCurrency(remainder) : null,
          bondAmount: bondAud > 0 ? formatCurrency(bondAud) : null,
          recurringSummary,
          portalUrl,
          siteName: branding.siteName,
        }),
      );

      const attachments: import("@/server/services/notification-sender").AttachmentRef[] = [];
      if (issuedInvoice) attachments.push({ kind: "invoice", invoiceId: issuedInvoice.id });
      if (onlinePayment) attachments.push({ kind: "receipt", paymentId: onlinePayment.id });
      if (signedAgreement)
        attachments.push({ kind: "rental-agreement", agreementId: signedAgreement.id });
      if (signedAssessment)
        attachments.push({ kind: "return-assessment", assessmentId: signedAssessment.id });

      await sendNotification({
        userId: booking.customerId,
        type: "BOOKING_CONFIRMATION",
        channels: ["EMAIL"],
        subject: `Booking confirmation (resend) — ${booking.bookingReference}`,
        title: `Booking confirmation — ${booking.bookingReference}`,
        body:
          `Your ${branding.siteName} booking ${booking.bookingReference} is confirmed. ` +
          `Pickup ${formatDateTime(booking.pickupDateTime)} at ${booking.pickupDepot.name}. ` +
          `Total ${formatCurrency(totalAud)}` +
          (remainder > 0 ? `, ${formatCurrency(remainder)} due at pickup.` : ".") +
          (bondAud > 0 ? ` Bond hold ${formatCurrency(bondAud)}.` : ""),
        html,
        templateKey: "booking-confirmation",
        bookingId: booking.id,
        attachments,
        sentById: ctx.user.id,
        data: {
          bookingReference: booking.bookingReference,
          resent: true,
        },
      });

      resendConfirmationLastSent.set(input.bookingId, now);
      return { sent: true };
    }),

  resendInvoice: staffProcedure
    .input(z.object({ invoiceId: z.string() }))
    .meta({ audit: { bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const last = resendInvoiceLastSent.get(input.invoiceId);
      if (last && now - last < RESEND_MIN_INTERVAL_MS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Please wait ${Math.ceil(
            (RESEND_MIN_INTERVAL_MS - (now - last)) / 1000,
          )}s before resending this invoice.`,
        });
      }
      const inv = await ctx.prisma.invoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
        include: {
          booking: { select: { id: true, bookingReference: true, customerId: true } },
        },
      });
      captureBookingId(ctx, inv.bookingId ?? inv.booking?.id);
      const recipientId = inv.customerId ?? inv.booking?.customerId ?? null;
      if (!recipientId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invoice has no customer to send to.",
        });
      }
      // No `customer` relation on Invoice — fetch by id for the greeting.
      const customer = await ctx.prisma.user.findUnique({
        where: { id: recipientId },
        select: { firstName: true },
      });
      const { default: InvoiceIssuedEmail } = await import(
        "../../../../emails/invoice-issued"
      );
      const { render: renderEmail } = await import("@react-email/render");
      const { createElement } = await import("react");
      const { formatCurrency } = await import("@/lib/utils");
      const portalUrl = `${
        process.env.AUTH_URL ??
        process.env.APP_URL ??
        process.env.NEXTAUTH_URL ??
        "http://localhost:3000"
      }/dashboard/documents`;
      const dueDateLabel = inv.dueDate
        ? new Date(inv.dueDate).toLocaleDateString("en-AU", { dateStyle: "medium" })
        : "On receipt";
      const amountLabel = formatCurrency(Number(inv.totalAmount));
      const html = await renderEmail(
        createElement(InvoiceIssuedEmail, {
          customerName: customer?.firstName ?? "there",
          invoiceNumber: inv.invoiceNumber,
          bookingReference: inv.booking?.bookingReference ?? "—",
          amount: amountLabel,
          dueDate: dueDateLabel,
          invoiceUrl: portalUrl,
        }),
      );
      await sendNotification({
        userId: recipientId,
        type: "INVOICE_ISSUED",
        channels: ["EMAIL"],
        subject: `Invoice ${inv.invoiceNumber}${
          inv.booking ? ` — ${inv.booking.bookingReference}` : ""
        } (resend)`,
        title: `Invoice ${inv.invoiceNumber}`,
        body: `Invoice ${inv.invoiceNumber} for ${amountLabel}${
          inv.booking ? ` on booking ${inv.booking.bookingReference}` : ""
        } is attached.`,
        html,
        templateKey: "invoice-issued",
        bookingId: inv.bookingId ?? undefined,
        attachments: [{ kind: "invoice", invoiceId: inv.id }],
        sentById: ctx.user.id,
        data: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, resent: true },
      });
      resendInvoiceLastSent.set(input.invoiceId, now);
      return { sent: true };
    }),

  confirmQuote: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().optional() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (b.status !== "QUOTE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm quote from ${b.status}`,
        });
      }
      return ctx.prisma.booking.update({
        where: { id: b.id },
        data: {
          status: "PENDING_PAYMENT",
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: "PENDING_PAYMENT",
              changedById: ctx.user.id,
              reason: input.reason ?? "Quote accepted",
            },
          },
        },
      });
    }),

  recordPayment: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        amount: z.number().positive(),
        method: z.enum(["CARD", "CASH", "BANK_TRANSFER", "STRIPE"]),
        reference: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (!["QUOTE", "PENDING_PAYMENT", "CONFIRMED"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot record payment from ${b.status}`,
        });
      }
      const newPaid = Number(b.amountPaid) + input.amount;
      const newBalance = Math.max(0, Number(b.totalAmount) - newPaid);
      const fullyPaid = newBalance <= 0.009;
      const nextStatus = fullyPaid
        ? "CONFIRMED"
        : b.status === "QUOTE"
          ? "PENDING_PAYMENT"
          : b.status;

      return ctx.prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            bookingId: b.id,
            customerId: b.customerId,
            reference: input.reference ?? `PAY-${Date.now()}`,
            type: "BOOKING_PAYMENT",
            method: input.method,
            amount: input.amount,
            status: "SUCCEEDED",
            notes: input.notes,
            processedById: ctx.user.id,
            processedAt: new Date(),
          },
        });
        return tx.booking.update({
          where: { id: b.id },
          data: {
            amountPaid: newPaid,
            balanceDue: newBalance,
            ...(nextStatus !== b.status && {
              status: nextStatus as never,
              confirmedById: fullyPaid ? ctx.user.id : b.confirmedById,
              statusLog: {
                create: {
                  previousStatus: b.status,
                  newStatus: nextStatus as never,
                  changedById: ctx.user.id,
                  reason: "Payment recorded",
                },
              },
            }),
          },
        });
      });
    }),

  // Phase C — ad-hoc refund from the staff payment console. Given a
  // SUCCEEDED Payment id (typically a BOOKING_PAYMENT or MANUAL_CHARGE)
  // and an amount, issue the refund via Stripe and record a matching
  // REFUND Payment row. Full-amount refunds default to the original
  // charge's full amount; partial refunds accept an explicit amount.
  refundPayment: staffProcedure
    .input(
      z.object({
        paymentId: z.string(),
        // Null / undefined = full refund of the original charge.
        amount: z.number().positive().optional(),
        reason: z.string().min(1, "Reason is required"),
      }),
    )
    .meta({
      audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: readCapturedBookingId },
    })
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        include: {
          booking: { select: { id: true, bookingReference: true, customerId: true } },
        },
      });
      captureCustomerId(ctx, source.customerId ?? source.booking?.customerId);
      captureBookingId(ctx, source.bookingId ?? source.booking?.id);
      if (source.status !== "SUCCEEDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot refund a payment in status ${source.status} — only SUCCEEDED payments are refundable.`,
        });
      }
      const originalAmount = Number(source.amount);
      const refundAmount = input.amount ?? originalAmount;
      if (refundAmount <= 0 || refundAmount > originalAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Refund amount must be between A$0.01 and A$${originalAmount.toFixed(2)}.`,
        });
      }

      let stripeRefundId: string | null = null;
      let paymentStatus: "SUCCEEDED" | "FAILED" | "PENDING" = "PENDING";
      let noteSuffix = "";
      try {
        const res = await refundCharge({
          paymentIntentId: source.stripePaymentIntentId,
          chargeId: source.stripeChargeId,
          amountCents: Math.round(refundAmount * 100),
          reason: "requested_by_customer",
          metadata: {
            originalPaymentId: source.id,
            bookingId: source.bookingId ?? "",
            staffId: ctx.user.id,
          },
          idempotencyKey: `refund-${source.id}-${Math.round(refundAmount * 100)}`,
        });
        stripeRefundId = res.id;
        paymentStatus = res.status === "succeeded" ? "SUCCEEDED" : "PENDING";
      } catch (err) {
        paymentStatus = "FAILED";
        noteSuffix = ` — Stripe: ${err instanceof Error ? err.message : "unknown"}`;
      }

      // Flip the source row to REFUNDED / PARTIALLY_REFUNDED so running
      // totals stay honest. The charge.refunded webhook would otherwise
      // do this, but we flip it here for immediate UI feedback.
      const newSourceStatus =
        refundAmount >= originalAmount ? "REFUNDED" : "PARTIALLY_REFUNDED";

      const refund = await ctx.prisma.$transaction(async (tx) => {
        if (paymentStatus === "SUCCEEDED") {
          await tx.payment.update({
            where: { id: source.id },
            data: { status: newSourceStatus },
          });
        }
        return tx.payment.create({
          data: {
            reference: `REF-${Date.now()}`,
            customerId: source.customerId,
            bookingId: source.bookingId,
            type: "REFUND",
            method: "STRIPE",
            amount: refundAmount,
            gstAmount: Number(source.gstAmount) * (refundAmount / originalAmount),
            status: paymentStatus,
            stripeChargeId: stripeRefundId,
            processedAt: paymentStatus === "SUCCEEDED" ? new Date() : null,
            processedById: ctx.user.id,
            notes: `Refund of ${source.reference}: ${input.reason}${noteSuffix}`,
          },
        });
      });

      // Per system protocol, a processed refund produces a GST-compliant
      // adjustment note (DECREASE / REFUND) and auto-emails the customer the
      // document — the same pipeline cancellations, swaps and bond captures
      // use. Gated on SUCCEEDED so we don't issue a credit document for a
      // refund that failed at Stripe; best-effort and non-blocking.
      if (paymentStatus === "SUCCEEDED" && source.bookingId) {
        try {
          const { tryIssueAdjustmentForBooking } = await import(
            "@/server/services/invoice-lifecycle"
          );
          await tryIssueAdjustmentForBooking({
            bookingId: source.bookingId,
            type: "DECREASE",
            reason: "REFUND",
            description: `Refund of ${source.reference} — ${input.reason}`,
            lineItems: [
              {
                description: `Refund of ${source.reference} — ${input.reason}`,
                quantity: 1,
                unitPrice: refundAmount,
                totalPrice: refundAmount,
                gstIncluded: true,
              },
            ],
            paymentId: refund.id,
            issuedById: ctx.user.id,
          });
        } catch {
          // tryIssueAdjustmentForBooking already logs internal failures.
        }
      }

      await trackServer({
        event: "payment.refunded",
        distinctId: source.customerId ?? source.booking?.customerId ?? ctx.user.id,
        properties: {
          paymentId: source.id,
          bookingId: source.bookingId,
          reference: source.booking?.bookingReference ?? null,
          refundAud: refundAmount,
          originalAud: originalAmount,
          isPartial: refundAmount < originalAmount,
          status: paymentStatus,
          actorUserId: ctx.user.id,
        },
      });

      return { refund, status: paymentStatus };
    }),

  markNoShow: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        applyFee: z.boolean().default(true),
        reason: z.string().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (!["CONFIRMED", "PENDING_PAYMENT", "QUOTE"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot mark no-show from ${b.status}`,
        });
      }
      const noShowFee = await (async () => {
        const s = await getSettings(["cancellation.noShowFee"] as const);
        return s["cancellation.noShowFee"] ?? CANCELLATION_POLICY.noShowFee;
      })();
      const fee = input.applyFee ? noShowFee : 0;
      return ctx.prisma.booking.update({
        where: { id: b.id },
        data: {
          status: "NO_SHOW",
          balanceDue: fee,
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: "NO_SHOW",
              changedById: ctx.user.id,
              reason: input.reason ?? "Customer did not arrive",
            },
          },
          ...(fee > 0 && {
            payments: {
              create: {
                reference: `NOSHOW-${Date.now()}`,
                type: "MANUAL_CHARGE",
                method: "STRIPE",
                amount: fee,
                status: "PENDING",
                notes: "No-show fee",
                processedById: ctx.user.id,
              },
            },
          }),
        },
      });
    }),

  markOverdue: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().optional() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (!["ACTIVE", "CHECKED_OUT"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot mark overdue from ${b.status}`,
        });
      }
      return ctx.prisma.booking.update({
        where: { id: b.id },
        data: {
          status: "OVERDUE",
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: "OVERDUE",
              changedById: ctx.user.id,
              reason: input.reason ?? "Past scheduled return",
            },
          },
        },
      });
    }),

  markReturned: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        odometerKm: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (!["ACTIVE", "OVERDUE", "CHECKED_OUT"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot mark returned from ${b.status}`,
        });
      }
      return ctx.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.update({
          where: { id: b.id },
          data: {
            status: "RETURNED",
            actualReturnDateTime: new Date(),
            returnOdometerKm: input.odometerKm ?? b.returnOdometerKm,
            staffNotes: input.notes ?? b.staffNotes,
            statusLog: {
              create: {
                previousStatus: b.status,
                newStatus: "RETURNED",
                changedById: ctx.user.id,
                reason:
                  input.notes ??
                  "Vehicle physically returned; settlement pending",
              },
            },
          },
        });
        if (b.vehicleId) {
          // C6: if the vehicle was returned to a different depot than it
          // was home'd at, update its home depot so future availability
          // queries point to where the vehicle physically is. Write a
          // VehicleStatusLog entry so staff can trace the move if they
          // later want to issue a transfer order to bring it back.
          const vehicle = await tx.vehicle.findUniqueOrThrow({
            where: { id: b.vehicleId },
            select: { depotId: true },
          });
          const depotChanged =
            !!b.returnDepotId && b.returnDepotId !== vehicle.depotId;
          await tx.vehicle.update({
            where: { id: b.vehicleId },
            data: {
              status: "AVAILABLE",
              ...(input.odometerKm !== undefined && {
                currentOdometerKm: input.odometerKm,
              }),
              ...(depotChanged && { depotId: b.returnDepotId }),
            },
          });
          await tx.vehicleStatusLog.create({
            data: {
              vehicleId: b.vehicleId,
              newStatus: "AVAILABLE",
              changedById: ctx.user.id,
              reason: depotChanged
                ? `Returned from ${b.bookingReference} to a different depot; home depot updated`
                : `Returned from ${b.bookingReference}`,
            },
          });
        }
        return booking;
      });
    }),

  markDisputed: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().min(1) }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      return ctx.prisma.booking.update({
        where: { id: b.id },
        data: {
          status: "DISPUTED",
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: "DISPUTED",
              changedById: ctx.user.id,
              reason: input.reason,
            },
          },
          bookingNotes: {
            create: {
              userId: ctx.user.id,
              note: `Marked DISPUTED: ${input.reason}`,
              isInternal: true,
            },
          },
        },
      });
    }),

  resolveDispute: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        resolveTo: z.enum(["COMPLETED", "CANCELLED", "ACTIVE", "OVERDUE"]),
        notes: z.string().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (b.status !== "DISPUTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only DISPUTED bookings can be resolved",
        });
      }
      return ctx.prisma.booking.update({
        where: { id: b.id },
        data: {
          status: input.resolveTo as never,
          statusLog: {
            create: {
              previousStatus: "DISPUTED",
              newStatus: input.resolveTo as never,
              changedById: ctx.user.id,
              reason: input.notes ?? "Dispute resolved",
            },
          },
          ...(input.notes && {
            bookingNotes: {
              create: {
                userId: ctx.user.id,
                note: `Dispute resolved → ${input.resolveTo}: ${input.notes}`,
                isInternal: true,
              },
            },
          }),
        },
      });
    }),

  // Surfaces the vehicles the unallocated-booking banner offers in its
  // "Pick manually" picker. Limited to the booking's own category + pickup
  // depot — assigning a different category would invalidate the price
  // snapshot, and a different depot would require a transfer order first.
  listAllocationCandidates: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: {
          status: true,
          vehicleId: true,
          categoryId: true,
          pickupDepotId: true,
          pickupDateTime: true,
          returnDateTime: true,
        },
      });
      if (b.vehicleId || !["ACTIVE", "CHECKED_OUT"].includes(b.status)) {
        return { eligible: false as const, vehicles: [] };
      }
      const remainderStart = new Date(
        Math.max(b.pickupDateTime.getTime(), Date.now()),
      );
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: {
          categoryId: b.categoryId,
          depotId: b.pickupDepotId,
          isActive: true,
          status: "AVAILABLE",
        },
        orderBy: { currentOdometerKm: "asc" },
        select: {
          id: true,
          internalCode: true,
          rego: true,
          condition: true,
          currentOdometerKm: true,
          regoExpiry: true,
          ctpExpiry: true,
          insuranceExpiry: true,
        },
      });
      const candidates = await Promise.all(
        vehicles.map(async (v) => {
          const free = await isVehicleFree(ctx.prisma, {
            vehicleId: v.id,
            pickup: remainderStart,
            ret: b.returnDateTime,
          });
          const docsExpiringDuringRental: string[] = [];
          if (v.regoExpiry && v.regoExpiry < b.returnDateTime)
            docsExpiringDuringRental.push("rego");
          if (v.ctpExpiry && v.ctpExpiry < b.returnDateTime)
            docsExpiringDuringRental.push("ctp");
          if (v.insuranceExpiry && v.insuranceExpiry < b.returnDateTime)
            docsExpiringDuringRental.push("insurance");
          return {
            id: v.id,
            internalCode: v.internalCode,
            rego: v.rego,
            condition: v.condition,
            currentOdometerKm: v.currentOdometerKm,
            free,
            docsExpiringDuringRental,
          };
        }),
      );
      return { eligible: true as const, vehicles: candidates };
    }),

  // Early-return refund quote. Shown on the Payment Console when a staff
  // member is settling a return earlier than the scheduled date. The offer
  // is staff-gated — this endpoint never mutates; it just computes the
  // suggestion. Staff then uses the existing `bookingSettlement.refund`
  // flow to actually issue the refund, picking the Payment row that funded
  // the rental.
  quoteEarlyReturnRefund: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        actualReturnDateTime: z.coerce.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: {
          addons: { include: { addon: true } },
          insurance: true,
          category: { select: { id: true } },
        },
      });
      const actualReturn = input.actualReturnDateTime ?? new Date();
      const perDayAddonsTotal = booking.addons
        .filter((a) => a.addon.isPerDay)
        .reduce((sum, a) => sum + Number(a.unitPrice) * a.quantity, 0);
      const perDayInsuranceRate = booking.insurance[0]
        ? Number(booking.insurance[0].dailyRate)
        : 0;
      // Choose the rate the booking was priced at — walk the snapshot for
      // accuracy, falling back to the category daily rate. Using a rate
      // that doesn't match the original booking would over- or under-
      // refund; this keeps the offer defensible if the customer disputes.
      const snap = booking.pricingSnapshot as { baseRate?: number } | null;
      const snapRate = typeof snap?.baseRate === "number" ? snap.baseRate : null;
      let dailyRate = snapRate;
      if (dailyRate == null) {
        const cat = await ctx.prisma.vehicleCategory.findUnique({
          where: { id: booking.categoryId },
          select: { baseDailyRate: true },
        });
        dailyRate = cat ? Number(cat.baseDailyRate) : 0;
      }
      const result = calcEarlyReturnRefund({
        scheduledReturn: booking.returnDateTime,
        actualReturn,
        dailyRate,
        perDayAddonsTotal,
        perDayInsuranceRate,
      });
      return {
        ...result,
        dailyRate,
        perDayAddonsTotal,
        perDayInsuranceRate,
        scheduledReturn: booking.returnDateTime.toISOString(),
        actualReturn: actualReturn.toISOString(),
      };
    }),

  // Live quote for the staff extend-booking flow. Runs the same
  // availability + pricing branches as the `booking.extend` mutation but
  // stops before any write — so the UI can show the exact extra cost and
  // new totals the customer will see if the staff confirms. Mirrors the
  // status + availability guards in booking.ts:730-797.
  quoteExtend: staffProcedure
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
          category: { select: { id: true, name: true } },
        },
      });
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
              "The assigned vehicle is booked by someone else for that window.",
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

  // Resolves an "active booking with no vehicle allocated" mistake.
  // Auto mode (no vehicleId) reuses the same allocator as check-out.
  // Manual mode validates category, depot, availability, and rental-window
  // freedom before assigning. Distinct from `swapVehicle` which is the
  // null→assigned vs assigned→assigned distinction the audit log cares about.
  assignVehicle: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        vehicleId: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      if (!["ACTIVE", "CHECKED_OUT"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot assign a vehicle from status ${b.status}`,
        });
      }
      if (b.vehicleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Booking already has a vehicle assigned. Use 'Swap vehicle' instead.",
        });
      }

      const remainderStart = new Date(
        Math.max(b.pickupDateTime.getTime(), Date.now()),
      );

      const result = await ctx.prisma.$transaction(async (tx) => {
        const mode: "auto" | "manual" = input.vehicleId ? "manual" : "auto";
        let vehicleId: string;

        if (!input.vehicleId) {
          await acquireAllocationLock(tx, b.pickupDepotId, b.categoryId);
          const allocated = await allocateVehicle(tx, {
            categoryId: b.categoryId,
            depotId: b.pickupDepotId,
            pickup: remainderStart,
            ret: b.returnDateTime,
          });
          if (!allocated) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "No vehicle available to auto-allocate. Pick manually or escalate.",
            });
          }
          vehicleId = allocated;
        } else {
          vehicleId = input.vehicleId;
          const v = await tx.vehicle.findUnique({ where: { id: vehicleId } });
          if (!v) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Vehicle not found.",
            });
          }
          if (v.categoryId !== b.categoryId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Vehicle category does not match the booking.",
            });
          }
          if (v.depotId !== b.pickupDepotId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Vehicle is not at the booking's pickup depot.",
            });
          }
          const free = await isVehicleFree(tx, {
            vehicleId: v.id,
            pickup: remainderStart,
            ret: b.returnDateTime,
          });
          if (!free) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Vehicle ${v.internalCode} has a conflicting booking or maintenance window.`,
            });
          }
        }

        const vehicle = await tx.vehicle.findUniqueOrThrow({
          where: { id: vehicleId },
        });

        const reasonText = input.reason
          ? `${mode === "auto" ? "Auto-allocated" : "Manually assigned"}: ${input.reason}`
          : mode === "auto"
            ? "Auto-allocated to resolve unallocated booking"
            : "Manually assigned to resolve unallocated booking";

        const booking = await tx.booking.update({
          where: { id: b.id },
          data: {
            vehicleId,
            bookingNotes: {
              create: {
                userId: ctx.user.id,
                note: `Vehicle ${vehicle.internalCode} (${vehicle.rego}) assigned. ${reasonText}`,
                isInternal: false,
              },
            },
            statusLog: {
              create: {
                previousStatus: b.status,
                newStatus: b.status,
                changedById: ctx.user.id,
                reason: `Vehicle assigned: ${vehicle.internalCode} (${reasonText})`,
              },
            },
          },
        });

        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { status: "RENTED" },
        });
        await tx.vehicleStatusLog.create({
          data: {
            vehicleId,
            previousStatus: "AVAILABLE",
            newStatus: "RENTED",
            changedById: ctx.user.id,
            reason: `Assigned to ${b.bookingReference} (${reasonText})`,
          },
        });

        return { booking, vehicle, mode };
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_VEHICLE_ASSIGNED",
        entity: "Booking",
        entityId: b.id,
        previousData: { vehicleId: null },
        newData: {
          vehicleId: result.vehicle.id,
          mode: result.mode,
          reason: input.reason ?? null,
        },
      });
      writeCustomerAuditAsync(ctx.prisma, b.customerId, {
        userId: ctx.user.id,
        action: "BOOKING_VEHICLE_ASSIGNED",
        reqId: ctx.reqId,
        newData: {
          bookingId: b.id,
          reference: b.bookingReference,
          vehicleId: result.vehicle.id,
          mode: result.mode,
          reason: input.reason ?? null,
        },
      });

      return result;
    }),

  completeFromReturned: staffProcedure
    .input(z.object({ bookingId: z.string(), notes: z.string().optional() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      captureCustomerId(ctx, b.customerId);
      if (b.status !== "RETURNED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot complete from ${b.status}`,
        });
      }
      const updated = await ctx.prisma.$transaction(async (tx) => {
        const row = await tx.booking.update({
          where: { id: b.id },
          data: {
            status: "COMPLETED",
            checkedInById: ctx.user.id,
            statusLog: {
              create: {
                previousStatus: b.status,
                newStatus: "COMPLETED",
                changedById: ctx.user.id,
                reason: input.notes ?? "Settlement finalised",
              },
            },
          },
        });
        // Keep the customer's lifetime spend / completed-booking counters and
        // daily revenue in lock-step with loyalty points. Every path that
        // transitions a booking into COMPLETED must record completion, or the
        // post-trip-review job awards points against spend that never lands.
        await recordBookingCompletion(tx, {
          id: b.id,
          customerId: b.customerId,
          depotId: b.depotId,
          actualReturnDateTime: b.actualReturnDateTime ?? new Date(),
          subtotal: b.subtotal,
          addonTotal: b.addonTotal,
          gstAmount: b.gstAmount,
          totalAmount: b.totalAmount,
        });
        return row;
      });
      await invalidateRevenueCaches(b.depotId);
      // Lever 4: flip any pending partner commission → PAYABLE now that
      // the booking is complete. Best-effort, never blocks completion.
      try {
        await markPartnerTransactionsPayable(ctx.prisma, b.id);
      } catch {
        // non-fatal
      }
      // Lever 5: qualify the referral that brought this customer in
      // (if any). Only their *first* completed booking qualifies.
      try {
        await qualifyReferral(ctx.prisma, {
          refereeId: b.customerId,
          qualifyingBookingId: b.id,
        });
      } catch {
        // non-fatal
      }
      return updated;
    }),

  /**
   * Close out a booking in one shot once the check-in wizard has produced
   * a SIGNED/FINALISED return assessment. Folds markReturned +
   * completeFromReturned into a single transaction: vehicle goes
   * AVAILABLE (with depot relocation if relevant) and the booking moves
   * straight to COMPLETED. Use this when settlement is already done via
   * the Payment Console and the staff member just wants to close the
   * hire.
   */
  closeOut: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        odometerKm: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: { returnAssessments: { select: { status: true } } },
      });
      captureCustomerId(ctx, b.customerId);
      if (!["ACTIVE", "OVERDUE", "CHECKED_OUT", "RETURNED"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot close out from ${b.status}`,
        });
      }
      const hasSigned = b.returnAssessments.some(
        (a) => a.status === "SIGNED" || a.status === "FINALISED",
      );
      if (!hasSigned) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Close out requires a signed return assessment",
        });
      }

      const updated = await ctx.prisma.$transaction(async (tx) => {
        const now = new Date();
        if (b.status !== "RETURNED") {
          await tx.bookingStatusLog.create({
            data: {
              bookingId: b.id,
              previousStatus: b.status,
              newStatus: "RETURNED",
              changedById: ctx.user.id,
              reason: "Closed out via Payment Console",
            },
          });
          if (b.vehicleId) {
            const vehicle = await tx.vehicle.findUniqueOrThrow({
              where: { id: b.vehicleId },
              select: { depotId: true },
            });
            const depotChanged =
              !!b.returnDepotId && b.returnDepotId !== vehicle.depotId;
            await tx.vehicle.update({
              where: { id: b.vehicleId },
              data: {
                status: "AVAILABLE",
                ...(input.odometerKm !== undefined && {
                  currentOdometerKm: input.odometerKm,
                }),
                ...(depotChanged && { depotId: b.returnDepotId }),
              },
            });
            await tx.vehicleStatusLog.create({
              data: {
                vehicleId: b.vehicleId,
                newStatus: "AVAILABLE",
                changedById: ctx.user.id,
                reason: depotChanged
                  ? `Returned from ${b.bookingReference} to a different depot; home depot updated`
                  : `Returned from ${b.bookingReference}`,
              },
            });
          }
        }
        const row = await tx.booking.update({
          where: { id: b.id },
          data: {
            status: "COMPLETED",
            checkedInById: ctx.user.id,
            ...(b.status !== "RETURNED" && { actualReturnDateTime: now }),
            ...(input.odometerKm !== undefined && { returnOdometerKm: input.odometerKm }),
            ...(input.notes && { staffNotes: input.notes }),
            statusLog: {
              create: {
                previousStatus: b.status === "RETURNED" ? "RETURNED" : "RETURNED",
                newStatus: "COMPLETED",
                changedById: ctx.user.id,
                reason: input.notes ?? "Settlement finalised — closed out",
              },
            },
          },
        });
        // Mirror the check-in completion path: keep lifetime spend /
        // completed-booking counters and daily revenue in step with the
        // loyalty points the post-trip-review job will later award.
        await recordBookingCompletion(tx, {
          id: b.id,
          customerId: b.customerId,
          depotId: b.depotId,
          actualReturnDateTime: b.actualReturnDateTime ?? now,
          subtotal: b.subtotal,
          addonTotal: b.addonTotal,
          gstAmount: b.gstAmount,
          totalAmount: b.totalAmount,
        });
        return row;
      });
      await invalidateRevenueCaches(b.depotId);
      try {
        await markPartnerTransactionsPayable(ctx.prisma, b.id);
      } catch {
        // non-fatal
      }
      try {
        await qualifyReferral(ctx.prisma, {
          refereeId: b.customerId,
          qualifyingBookingId: b.id,
        });
      } catch {
        // non-fatal
      }
      return updated;
    }),

  setVerification: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        licenceVerified: z.boolean(),
        customerIdVerified: z.boolean(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: { customerId: true },
      });
      captureCustomerId(ctx, b?.customerId);
      return ctx.prisma.booking.update({
        where: { id: input.bookingId },
        data: {
          licenceVerified: input.licenceVerified,
          customerIdVerified: input.customerIdVerified,
        },
      });
    }),

  checkOut: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        vehicleId: z.string().optional(),
        odometerKm: z.number().int().min(0),
        fuelLevel: z.number().int().min(0).max(100),
        licenceVerified: z.boolean(),
        customerIdVerified: z.boolean(),
        agreementId: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      if (!["CONFIRMED", "PENDING_PAYMENT"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot check out from status ${b.status}`,
        });
      }
      const requireLicence = await (async () => {
        const s = await getSettings(["booking.requireLicenceVerification"] as const);
        return (
          s["booking.requireLicenceVerification"] ??
          SETTING_DEFAULTS["booking.requireLicenceVerification"]
        );
      })();
      if (requireLicence && !input.licenceVerified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Licence must be verified before check-out",
        });
      }

      // A3 + A4: re-verify eligibility at check-out. Licence may have
      // expired between booking and pickup, or we may be handing over a
      // vehicle whose category changed (swap before check-out).
      const [categoryForEligibility, customerForEligibility] =
        await Promise.all([
          ctx.prisma.vehicleCategory.findUniqueOrThrow({
            where: { id: b.categoryId },
            select: { name: true, licenceRequired: true, minAge: true },
          }),
          ctx.prisma.user.findUniqueOrThrow({
            where: { id: b.customerId },
            select: {
              dateOfBirth: true,
              customerProfile: {
                select: {
                  licenceClass: true,
                  licenceExpiry: true,
                  passportNumber: true,
                  passportExpiry: true,
                },
              },
            },
          }),
        ]);
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
        },
        category: categoryForEligibility,
        pickupDate: b.pickupDateTime,
      });
      if (eligibility.failure) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: eligibility.failure.message,
        });
      }
      // Motorcycle categories being passed on passport-only grounds are the
      // scenario staff need to physically verify a licence in person for.
      // Surface the warnings to the caller so the UI can render a banner.
      const eligibilityBasis = eligibility.basis;
      const eligibilityWarnings = eligibility.warnings;

      // B1: require a COMPLETED pre-hire inspection for this booking
      // before handover so there's always a damage baseline. The UI layer
      // can pre-call `inspection.create` as part of a single check-out
      // wizard; this gate means we can't silently hand over a vehicle
      // with no documented starting condition.
      const preHireInspection = await ctx.prisma.inspection.findFirst({
        where: {
          bookingId: b.id,
          type: "PRE_HIRE",
          status: "COMPLETED",
        },
        select: { id: true },
      });
      if (!preHireInspection) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Pre-hire inspection required before check-out. Complete and save the inspection for this booking first.",
        });
      }

      // A signed rental agreement is required for handover. The agreement
      // finalise step seals the inspection COMPLETED and captures both
      // customer + staff signatures — it's the legal boundary for the hire.
      if (input.agreementId) {
        const agreement = await ctx.prisma.rentalAgreement.findUnique({
          where: { id: input.agreementId },
        });
        if (!agreement || agreement.bookingId !== b.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Agreement does not belong to this booking" });
        }
        if (agreement.status !== "SIGNED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Agreement must be signed before check-out can be completed.",
          });
        }
      } else {
        const latestAgreement = await ctx.prisma.rentalAgreement.findFirst({
          where: { bookingId: b.id, status: "SIGNED" },
          orderBy: { version: "desc" },
          select: { id: true },
        });
        if (!latestAgreement) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A signed rental agreement is required before check-out.",
          });
        }
      }

      // A1-a: allocation + handover inside one transaction under a
      // depot+category advisory lock so two concurrent checkOuts can't
      // select the same vehicle. If no allocation is needed (staff
      // pre-assigned a vehicle, or confirmPayment already did) we skip
      // the lock — no point serialising across the whole depot for a
      // no-op allocation. A1-b safety net: the exclusion constraint
      // surfaces as CONFLICT instead of a 500 if it ever fires.
      let updated, assignedVehicleId: string;
      try {
        const result = await ctx.prisma.$transaction(async (tx) => {
          let vehicleId = input.vehicleId ?? b.vehicleId;
          if (!vehicleId) {
            await acquireAllocationLock(tx, b.pickupDepotId, b.categoryId);
            vehicleId = await allocateVehicle(tx, {
              categoryId: b.categoryId,
              depotId: b.pickupDepotId,
              pickup: b.pickupDateTime,
              ret: b.returnDateTime,
            });
          }
          if (!vehicleId) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "No vehicle available to allocate",
            });
          }

          // A2: block handover if any compliance document lapses before
          // the scheduled return. Runs inside the transaction so the
          // vehicle fetched here is the same one we lock onto.
          const vehicleForCheck = await tx.vehicle.findUniqueOrThrow({
            where: { id: vehicleId },
            select: {
              regoExpiry: true,
              ctpExpiry: true,
              insuranceExpiry: true,
              rego: true,
            },
          });
          const expiredDocs: string[] = [];
          if (
            vehicleForCheck.regoExpiry &&
            vehicleForCheck.regoExpiry < b.returnDateTime
          )
            expiredDocs.push("rego");
          if (
            vehicleForCheck.ctpExpiry &&
            vehicleForCheck.ctpExpiry < b.returnDateTime
          )
            expiredDocs.push("CTP");
          if (
            vehicleForCheck.insuranceExpiry &&
            vehicleForCheck.insuranceExpiry < b.returnDateTime
          )
            expiredDocs.push("insurance");
          if (expiredDocs.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Cannot check out ${vehicleForCheck.rego}: ${expiredDocs.join(", ")} ${expiredDocs.length === 1 ? "expires" : "expire"} before return date. Renew or reassign vehicle.`,
            });
          }

          const booking = await tx.booking.update({
            where: { id: b.id },
            data: {
              status: "ACTIVE",
              vehicleId,
              actualPickupDateTime: new Date(),
              pickupOdometerKm: input.odometerKm,
              licenceVerified: input.licenceVerified,
              customerIdVerified: input.customerIdVerified,
              checkedOutById: ctx.user.id,
              staffNotes: input.notes,
              statusLog: {
                create: {
                  previousStatus: b.status,
                  newStatus: "ACTIVE",
                  changedById: ctx.user.id,
                  reason: "Checked out",
                },
              },
            },
          });
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: { status: "RENTED", currentOdometerKm: input.odometerKm },
          });
          await tx.vehicleStatusLog.create({
            data: {
              vehicleId,
              newStatus: "RENTED",
              changedById: ctx.user.id,
              reason: `Checked out on ${b.bookingReference}`,
            },
          });
          await autoCloseByTarget(tx, "Booking", b.id, {
            types: ["BOOKING_PICKUP"],
            reason: "completed",
            closingUserId: ctx.user.id,
          });
          return { updated: booking, assignedVehicleId: vehicleId };
        });
        updated = result.updated;
        assignedVehicleId = result.assignedVehicleId;
      } catch (err) {
        if (isBookingOverlapViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Vehicle was just assigned to another booking. Pick a different vehicle and retry.",
          });
        }
        throw err;
      }

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_CHECKED_OUT",
        entity: "Booking",
        entityId: b.id,
        newData: {
          vehicleId: assignedVehicleId,
          odometerKm: input.odometerKm,
          fuelLevel: input.fuelLevel,
          eligibilityBasis,
          eligibilityWarnings: eligibilityWarnings.map((w) => w.code),
        },
      });
      writeCustomerAuditAsync(ctx.prisma, b.customerId, {
        userId: ctx.user.id,
        action: "BOOKING_CHECKED_OUT",
        reqId: ctx.reqId,
        newData: {
          bookingId: b.id,
          reference: b.bookingReference,
          vehicleId: assignedVehicleId,
          odometerKm: input.odometerKm,
          fuelLevel: input.fuelLevel,
          eligibilityBasis,
          eligibilityWarnings: eligibilityWarnings.map((w) => w.code),
        },
      });

      await trackServer({
        event: "booking.checked_out",
        distinctId: b.customerId,
        properties: {
          bookingId: b.id,
          reference: b.bookingReference,
          odometerKm: input.odometerKm,
          fuelLevel: input.fuelLevel,
        },
      });

      await invalidateRevenueCaches(b.depotId);

      // Email the customer with the signed rental agreement + tax invoice
      // attached. Best-effort — the back-office handover is the source of
      // truth, the email is a courtesy copy. Wrap the whole thing so an
      // email issue can never roll back the check-out.
      try {
        const [bookingForEmail, signedAgreement, activeInvoice, customer, vehicle, staff] =
          await Promise.all([
            ctx.prisma.booking.findUniqueOrThrow({
              where: { id: b.id },
              select: { bookingReference: true, returnDateTime: true, customerId: true },
            }),
            ctx.prisma.rentalAgreement.findFirst({
              where: { bookingId: b.id, status: "SIGNED" },
              orderBy: { version: "desc" },
              select: { id: true },
            }),
            ctx.prisma.invoice.findFirst({
              where: { bookingId: b.id, deletedAt: null, status: { not: "VOID" } },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            }),
            ctx.prisma.user.findUnique({
              where: { id: b.customerId },
              select: { firstName: true },
            }),
            ctx.prisma.vehicle.findUnique({
              where: { id: assignedVehicleId },
              select: { make: true, model: true, rego: true },
            }),
            ctx.prisma.user.findUnique({
              where: { id: ctx.user.id },
              select: { firstName: true, lastName: true },
            }),
          ]);
        const { default: BookingCheckedOutEmail } = await import(
          "../../../../emails/booking-checked-out"
        );
        const { render: renderEmail } = await import("@react-email/render");
        const { createElement } = await import("react");
        const { formatDateTime } = await import("@/lib/utils");
        const vehicleLabel = vehicle
          ? `${vehicle.make} ${vehicle.model}${vehicle.rego ? ` · ${vehicle.rego}` : ""}`
          : "your scooter";
        const staffName = staff
          ? [staff.firstName, staff.lastName].filter(Boolean).join(" ").trim() || null
          : null;
        const html = await renderEmail(
          createElement(BookingCheckedOutEmail, {
            customerName: customer?.firstName ?? "there",
            bookingReference: bookingForEmail.bookingReference,
            vehicleLabel,
            pickupAt: formatDateTime(updated.actualPickupDateTime ?? new Date()),
            expectedReturnAt: formatDateTime(bookingForEmail.returnDateTime),
            pickupOdometerKm: input.odometerKm,
            fuelLevel: input.fuelLevel,
            staffName,
          }),
        );
        const attachments: import("@/server/services/notification-sender").AttachmentRef[] = [];
        if (signedAgreement)
          attachments.push({ kind: "rental-agreement", agreementId: signedAgreement.id });
        if (activeInvoice)
          attachments.push({ kind: "invoice", invoiceId: activeInvoice.id });
        await sendNotification({
          userId: bookingForEmail.customerId,
          type: "BOOKING_CHECKED_OUT",
          channels: ["EMAIL"],
          subject: `You're on the road — ${bookingForEmail.bookingReference}`,
          title: "Vehicle checked out",
          body: `Booking ${bookingForEmail.bookingReference} has been checked out. Your signed rental agreement is attached. Expected return: ${formatDateTime(bookingForEmail.returnDateTime)}.`,
          html,
          templateKey: "booking-checked-out",
          bookingId: b.id,
          attachments,
          dedupKey: `booking-checked-out:${b.id}`,
          sentById: ctx.user.id,
        });
      } catch (err) {
        const { logger: log } = await import("@/lib/logger");
        log.warn(
          { err: err instanceof Error ? err.message : String(err), bookingId: b.id },
          "checkOut: handover email failed; non-blocking",
        );
      }

      return {
        ...updated,
        eligibilityBasis,
        eligibilityWarnings,
      };
    }),

  checkIn: staffProcedure
    .input(
      z.object({
        bookingId: z.string(),
        odometerKm: z.number().int().min(0),
        fuelLevel: z.number().int().min(0).max(100),
        fuelChargePerLitre: z.number().optional(),
        tankCapacityL: z.number().default(8),
        damageChargeAmount: z.number().min(0).default(0),
        damageReason: z.string().optional(),
        /** When present, damage + bond are sourced from the signed return assessment
         * rather than the ad-hoc `damageChargeAmount` number. The assessment must be
         * SIGNED. Confirmed + WAIVED charges are accepted; QUOTE_PENDING is recorded
         * but not captured from bond (captured later when the work order closes).
         */
        returnAssessmentId: z.string().optional(),
        // D4: when the post-hire inspection flagged damage but staff
        // aren't charging, force them to say why. Echoed into staff notes
        // and the audit log.
        zeroDamageReason: z.string().optional(),
        // B5: allow staff to explicitly override the km/day anomaly check
        // (genuine road trip, relocation, etc.) with a written reason.
        kmAnomalyOverrideReason: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: { category: true, vehicle: true },
      });
      if (!["ACTIVE", "OVERDUE", "CHECKED_OUT"].includes(b.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot check in from status ${b.status}`,
        });
      }

      // B5: reject impossible odometer readings outright. `pickupOdometerKm`
      // is set during checkOut; if it's missing we fall back to the vehicle's
      // stored odometer so we still catch rollbacks on legacy bookings.
      const pickupOdo = b.pickupOdometerKm ?? b.vehicle?.currentOdometerKm ?? 0;
      if (input.odometerKm < pickupOdo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Return odometer (${input.odometerKm} km) is less than pickup odometer (${pickupOdo} km). Check the reading.`,
        });
      }

      // B5: km/day anomaly. Soft-gate with an explicit override reason —
      // a genuine long-distance trip should still complete, but staff must
      // acknowledge it.
      const rentalDays = Math.max(1, b.durationDays);
      const distance = input.odometerKm - pickupOdo;
      const kmPerDay = distance / rentalDays;
      const kmAnomalyFlagged = kmPerDay > BOOKING_RULES.fleetAnomalyKmPerDay;
      if (kmAnomalyFlagged && !input.kmAnomalyOverrideReason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unusual distance: ${Math.round(distance)} km over ${rentalDays} days (${Math.round(kmPerDay)} km/day, threshold ${BOOKING_RULES.fleetAnomalyKmPerDay}). Confirm reading and provide kmAnomalyOverrideReason.`,
        });
      }

      // B1: require a COMPLETED post-hire inspection for this booking
      // before settlement. Symmetric to the pre-hire gate at check-out —
      // no return without a documented finishing condition.
      const latestPostHire = await ctx.prisma.inspection.findFirst({
        where: { bookingId: b.id, type: "POST_HIRE" },
        orderBy: { dateTime: "desc" },
        include: {
          items: { where: { flagged: true }, select: { id: true }, take: 1 },
        },
      });
      if (!latestPostHire || latestPostHire.status !== "COMPLETED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Post-hire inspection required before check-in. Complete and save the inspection for this booking first.",
        });
      }

      // When a signed return assessment is supplied, damage is sourced
      // from the assessment's DamageCharge rows instead of the legacy
      // ad-hoc damageChargeAmount. We still fall back to the legacy path
      // for bookings that predate the new flow.
      let assessmentDamageTotal = 0;
      let hasPendingQuotes = false;
      if (input.returnAssessmentId) {
        const assessment = await ctx.prisma.returnAssessment.findUnique({
          where: { id: input.returnAssessmentId },
          include: { damageCharges: true },
        });
        if (!assessment || assessment.bookingId !== b.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Return assessment does not belong to this booking" });
        }
        if (assessment.status !== "SIGNED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Return assessment must be signed before check-in can settle.",
          });
        }
        assessmentDamageTotal = assessment.damageCharges
          .filter((c) => c.resolution === "STANDARD")
          .reduce((acc, c) => acc + Number(c.amount), 0);
        hasPendingQuotes = assessment.damageCharges.some((c) => c.resolution === "QUOTE_PENDING");
      }

      // D4: if the post-hire inspection flagged damage (flagged item OR
      // overall condition FAIR/POOR) and no damage charge has been
      // entered, block the check-in until staff either add a charge or
      // state why they're waiving it. This stops silent bond releases.
      const inspectionFlaggedDamage =
        !!latestPostHire &&
        (latestPostHire.items.length > 0 ||
          latestPostHire.overallCondition === "FAIR" ||
          latestPostHire.overallCondition === "POOR");
      const effectiveDamageTotal = input.returnAssessmentId ? assessmentDamageTotal : input.damageChargeAmount;
      if (
        inspectionFlaggedDamage &&
        effectiveDamageTotal === 0 &&
        !input.zeroDamageReason
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Post-hire inspection flagged damage. Add a damage charge or provide zeroDamageReason explaining why the bond is being released in full.",
        });
      }

      const now = new Date();
      const scheduledRet = b.returnDateTime;
      const returnPolicy = await getSettings([
        "booking.lateReturnGraceHours",
        "booking.fuelChargePerLitre",
      ] as const);
      const graceHours =
        returnPolicy["booking.lateReturnGraceHours"] ??
        SETTING_DEFAULTS["booking.lateReturnGraceHours"];
      const lateHours = Math.max(
        0,
        (now.getTime() - scheduledRet.getTime()) / (1000 * 60 * 60) - graceHours,
      );
      const hourlyRate = Number(b.category.baseDailyRate) / 8;
      const lateFee = Math.min(
        Math.floor(lateHours) * hourlyRate,
        Math.ceil(lateHours / 24) * Number(b.category.baseDailyRate),
      );

      // B5: read pickup fuel from the most recent pre-hire inspection so
      // we don't over-charge when the tank was handed over below full.
      const latestPreHire = await ctx.prisma.inspection.findFirst({
        where: { bookingId: b.id, type: "PRE_HIRE" },
        orderBy: { dateTime: "desc" },
        select: { fuelLevel: true },
      });
      const pickupFuel = latestPreHire?.fuelLevel ?? 100;
      const missingL = Math.max(
        0,
        ((pickupFuel - input.fuelLevel) / 100) * input.tankCapacityL,
      );
      const fuelPerLitre =
        returnPolicy["booking.fuelChargePerLitre"] ??
        SETTING_DEFAULTS["booking.fuelChargePerLitre"];
      const fuelCharge =
        Math.round(missingL * (input.fuelChargePerLitre ?? fuelPerLitre) * 100) / 100;

      const damageChargeAmount = input.returnAssessmentId ? assessmentDamageTotal : input.damageChargeAmount;
      const additionalCharges = Math.round((lateFee + fuelCharge + damageChargeAmount) * 100) / 100;
      // When there are pending mechanic quotes we park at RETURNED so a
      // background job can flip to COMPLETED once all work orders close.
      const finalStatus: "RETURNED" | "COMPLETED" = hasPendingQuotes ? "RETURNED" : "COMPLETED";

      const updated = await ctx.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.update({
          where: { id: b.id },
          data: {
            status: finalStatus,
            actualReturnDateTime: now,
            returnOdometerKm: input.odometerKm,
            checkedInById: ctx.user.id,
            staffNotes: input.notes,
            balanceDue: additionalCharges,
            statusLog: {
              create: {
                previousStatus: b.status,
                newStatus: finalStatus,
                changedById: ctx.user.id,
                reason: hasPendingQuotes ? "Checked in (pending quote)" : "Checked in",
              },
            },
            ...(additionalCharges > 0 && {
              payments: {
                create: [
                  ...(lateFee > 0
                    ? [
                        {
                          reference: `LATE-${Date.now()}`,
                          type: "LATE_FEE" as const,
                          method: "STRIPE" as const,
                          amount: lateFee,
                          status: "PENDING" as const,
                          notes: `${Math.floor(lateHours)}h late`,
                        },
                      ]
                    : []),
                  ...(fuelCharge > 0
                    ? [
                        {
                          reference: `FUEL-${Date.now()}`,
                          type: "FUEL_CHARGE" as const,
                          method: "STRIPE" as const,
                          amount: fuelCharge,
                          status: "PENDING" as const,
                          notes: `${missingL.toFixed(2)}L`,
                        },
                      ]
                    : []),
                  ...(damageChargeAmount > 0
                    ? [
                        {
                          reference: `DMG-${Date.now()}`,
                          type: "DAMAGE_CHARGE" as const,
                          method: "STRIPE" as const,
                          amount: damageChargeAmount,
                          status: "PENDING" as const,
                          notes: input.damageReason ?? (input.returnAssessmentId ? "Per signed return assessment" : undefined),
                        },
                      ]
                    : []),
                ],
              },
            }),
          },
        });
        if (b.vehicleId) {
          // C6: sync vehicle home depot if returned elsewhere (see
          // markReturned for the same pattern).
          const currentVehicle = await tx.vehicle.findUniqueOrThrow({
            where: { id: b.vehicleId },
            select: { depotId: true },
          });
          const depotChanged =
            !!b.returnDepotId && b.returnDepotId !== currentVehicle.depotId;
          await tx.vehicle.update({
            where: { id: b.vehicleId },
            data: {
              status: "AVAILABLE",
              currentOdometerKm: input.odometerKm,
              ...(depotChanged && { depotId: b.returnDepotId }),
            },
          });
          await tx.vehicleStatusLog.create({
            data: {
              vehicleId: b.vehicleId,
              newStatus: "AVAILABLE",
              changedById: ctx.user.id,
              reason: depotChanged
                ? `Checked in from ${b.bookingReference} to a different depot; home depot updated`
                : `Checked in from ${b.bookingReference}`,
            },
          });
        }
        // Release or partial-capture bond
        const existingBond = await tx.bondLedger.findUnique({
          where: { bookingId: b.id },
        });
        if (existingBond) {
          await tx.bondLedger.update({
            where: { bookingId: b.id },
            data:
              damageChargeAmount > 0
                ? {
                    capturedAmount: damageChargeAmount,
                    releasedAmount: Math.max(
                      0,
                      Number(b.bondAmount) - damageChargeAmount,
                    ),
                    status:
                      damageChargeAmount >= Number(b.bondAmount)
                        ? "FULLY_CAPTURED"
                        : "PARTIALLY_CAPTURED",
                    deductions: [
                      {
                        reason: input.damageReason ?? (input.returnAssessmentId ? "Signed return assessment" : "Damage"),
                        amount: damageChargeAmount,
                      },
                    ],
                  }
                : {
                    releasedAmount: Number(b.bondAmount),
                    status: "RELEASED",
                  },
          });
        }
        if (input.returnAssessmentId) {
          await tx.damageCharge.updateMany({
            where: { returnAssessmentId: input.returnAssessmentId, resolution: "STANDARD" },
            data: { status: "CAPTURED" },
          });
        }
        if (finalStatus === "COMPLETED") {
          await recordBookingCompletion(tx, {
            id: b.id,
            customerId: b.customerId,
            depotId: b.depotId,
            actualReturnDateTime: now,
            subtotal: b.subtotal,
            addonTotal: b.addonTotal,
            gstAmount: b.gstAmount,
            totalAmount: b.totalAmount,
          });
          if (additionalCharges > 0) {
            await recordAdditionalCharges(tx, {
              depotId: b.depotId,
              at: now,
              damageAmount: damageChargeAmount,
              lateFeeAmount: lateFee,
              fuelChargeAmount: fuelCharge,
            });
          }
        }
        await autoCloseByTarget(tx, "Booking", b.id, {
          types: ["BOOKING_RETURN", "BOOKING_OVERDUE_CHASE"],
          reason: "completed",
          closingUserId: ctx.user.id,
        });
        return booking;
      });

      if (finalStatus === "COMPLETED") {
        await invalidateRevenueCaches(b.depotId);
      }

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "BOOKING_CHECKED_IN",
        entity: "Booking",
        entityId: b.id,
        newData: {
          odometerKm: input.odometerKm,
          fuelLevel: input.fuelLevel,
          lateFee,
          fuelCharge,
          damageCharge: input.damageChargeAmount,
          kmPerDay: Math.round(kmPerDay),
          kmAnomalyFlagged,
          kmAnomalyOverrideReason: input.kmAnomalyOverrideReason,
          inspectionFlaggedDamage,
          zeroDamageReason: input.zeroDamageReason,
          pickupFuelFromInspection: latestPreHire?.fuelLevel ?? null,
        },
      });
      writeCustomerAuditAsync(ctx.prisma, b.customerId, {
        userId: ctx.user.id,
        action: "BOOKING_CHECKED_IN",
        reqId: ctx.reqId,
        newData: {
          bookingId: b.id,
          reference: b.bookingReference,
          odometerKm: input.odometerKm,
          fuelLevel: input.fuelLevel,
          lateFee,
          fuelCharge,
          damageCharge: input.damageChargeAmount,
        },
      });

      await trackServer({
        event: "booking.checked_in",
        distinctId: b.customerId,
        properties: {
          bookingId: b.id,
          reference: b.bookingReference,
          lateFee,
          fuelCharge,
          damageCharge: input.damageChargeAmount,
          additionalCharges,
        },
      });

      // Issue ATO §29-75 adjustment notes for any post-rental charges
      // recorded at check-in (late fee, fuel, damage). Each maps to the
      // matching Payment row created above; failures are non-blocking.
      if (additionalCharges > 0) {
        try {
          const { tryIssueAdjustmentForBooking } = await import(
            "@/server/services/invoice-lifecycle"
          );
          if (lateFee > 0) {
            const payment = await ctx.prisma.payment.findFirst({
              where: { bookingId: b.id, type: "LATE_FEE" },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            await tryIssueAdjustmentForBooking({
              bookingId: b.id,
              type: "INCREASE",
              reason: "LATE_FEE",
              description: `Late return fee — ${Math.floor(lateHours)}h beyond scheduled return`,
              lineItems: [
                {
                  description: "Late return fee",
                  detail: `${Math.floor(lateHours)} hour(s) past scheduled return`,
                  quantity: 1,
                  unitPrice: lateFee,
                  totalPrice: lateFee,
                  gstIncluded: true,
                },
              ],
              paymentId: payment?.id ?? null,
              issuedById: ctx.user.id,
            });
          }
          if (fuelCharge > 0) {
            const payment = await ctx.prisma.payment.findFirst({
              where: { bookingId: b.id, type: "FUEL_CHARGE" },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            await tryIssueAdjustmentForBooking({
              bookingId: b.id,
              type: "INCREASE",
              reason: "FUEL",
              description: `Fuel shortfall — ${missingL.toFixed(2)}L below pickup level`,
              lineItems: [
                {
                  description: "Fuel shortfall",
                  detail: `${missingL.toFixed(2)} litres at refuelling rate`,
                  quantity: 1,
                  unitPrice: fuelCharge,
                  totalPrice: fuelCharge,
                  gstIncluded: true,
                },
              ],
              paymentId: payment?.id ?? null,
              issuedById: ctx.user.id,
            });
          }
          if (damageChargeAmount > 0) {
            const payment = await ctx.prisma.payment.findFirst({
              where: {
                bookingId: b.id,
                type: "DAMAGE_CHARGE",
                createdAt: { gte: new Date(Date.now() - 60_000) },
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            await tryIssueAdjustmentForBooking({
              bookingId: b.id,
              type: "INCREASE",
              reason: "DAMAGE",
              description: input.damageReason ?? "Damage charge at return",
              lineItems: [
                {
                  description: "Damage charge",
                  detail:
                    input.damageReason ??
                    (input.returnAssessmentId
                      ? "Per signed return assessment"
                      : "Recorded at check-in"),
                  quantity: 1,
                  unitPrice: damageChargeAmount,
                  totalPrice: damageChargeAmount,
                  gstIncluded: true,
                },
              ],
              paymentId: payment?.id ?? null,
              issuedById: ctx.user.id,
            });
          }
        } catch {
          // tryIssueAdjustmentForBooking already logs internal failures.
        }
      }

      // Email the customer a return summary with the signed return
      // assessment attached. Best-effort — failures here don't roll back
      // the check-in. If additional charges fired adjustment notes above,
      // the adjustment-note auto-email delivers those PDFs separately so
      // the customer has one document per email.
      try {
        const [customer, signedAssessment] = await Promise.all([
          ctx.prisma.user.findUnique({
            where: { id: b.customerId },
            select: { firstName: true },
          }),
          input.returnAssessmentId
            ? ctx.prisma.returnAssessment.findUnique({
                where: { id: input.returnAssessmentId },
                select: { id: true, status: true },
              })
            : ctx.prisma.returnAssessment.findFirst({
                where: { bookingId: b.id, status: "SIGNED" },
                orderBy: { version: "desc" },
                select: { id: true, status: true },
              }),
        ]);
        const { default: BookingReturnedEmail } = await import(
          "../../../../emails/booking-returned"
        );
        const { render: renderEmail } = await import("@react-email/render");
        const { createElement } = await import("react");
        const { formatDateTime, formatCurrency } = await import("@/lib/utils");
        const bondReleasedAmount =
          damageChargeAmount > 0
            ? Math.max(0, Number(b.bondAmount) - damageChargeAmount)
            : Number(b.bondAmount);
        const html = await renderEmail(
          createElement(BookingReturnedEmail, {
            customerName: customer?.firstName ?? "there",
            bookingReference: b.bookingReference,
            returnedAt: formatDateTime(now),
            returnOdometerKm: input.odometerKm,
            fuelLevel: input.fuelLevel,
            finalBalance: additionalCharges > 0 ? formatCurrency(additionalCharges) : null,
            bondReleased:
              bondReleasedAmount > 0 && !hasPendingQuotes
                ? formatCurrency(bondReleasedAmount)
                : null,
            hasPendingQuote: hasPendingQuotes,
          }),
        );
        const attachments: import("@/server/services/notification-sender").AttachmentRef[] = [];
        if (signedAssessment?.id && signedAssessment.status === "SIGNED") {
          attachments.push({ kind: "return-assessment", assessmentId: signedAssessment.id });
        }
        await sendNotification({
          userId: b.customerId,
          type: "BOOKING_COMPLETED",
          channels: ["EMAIL"],
          subject: `Returned — ${b.bookingReference}`,
          title: "Booking returned",
          body:
            `Booking ${b.bookingReference} is checked back in.` +
            (additionalCharges > 0
              ? ` Settlement at return: ${formatCurrency(additionalCharges)} (itemised on the attached adjustment note).`
              : " No additional charges.") +
            (bondReleasedAmount > 0 && !hasPendingQuotes
              ? ` Bond released: ${formatCurrency(bondReleasedAmount)}.`
              : "") +
            (hasPendingQuotes
              ? " Damage is being quoted; we'll follow up with the final figure."
              : ""),
          html,
          templateKey: "booking-returned",
          bookingId: b.id,
          attachments,
          dedupKey: `booking-returned:${b.id}`,
          sentById: ctx.user.id,
        });
      } catch (err) {
        const { logger: log } = await import("@/lib/logger");
        log.warn(
          { err: err instanceof Error ? err.message : String(err), bookingId: b.id },
          "checkIn: return email failed; non-blocking",
        );
      }

      return {
        booking: updated,
        lateFee,
        fuelCharge,
        damageCharge: input.damageChargeAmount,
        additionalCharges,
      };
    }),

  cancel: staffProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId, bookingIdPath: "bookingId" } })
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        select: { customerId: true },
      });
      captureCustomerId(ctx, b.customerId);
      skipAutoAudit(ctx);
      const result = await cancelBookingService(
        {
          bookingId: input.bookingId,
          reason: input.reason,
          source: "STAFF",
          actorUserId: ctx.user.id,
          allowSubscriptionOverride: true,
        },
        ctx.prisma,
      );
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      return {
        booking,
        refundAmount: result.refundAmount,
        refundPct: result.refundPct,
        bondReleasedAmount: result.bondReleasedAmount,
      };
    }),

  createWalkIn: staffProcedure
    .input(
      z.object({
        customerId: z.string(),
        categoryId: z.string(),
        vehicleId: z.string().optional(),
        pickupDepotId: z.string(),
        returnDepotId: z.string(),
        pickupDateTime: z.coerce.date(),
        returnDateTime: z.coerce.date(),
        totalAmount: z.number(),
        subtotal: z.number(),
        gstAmount: z.number(),
        bondAmount: z.number(),
        method: z.enum(["CARD", "CASH"]),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId", bookingIdPath: readCapturedBookingId } })
    .mutation(async ({ ctx, input }) => {
      // The booking's customer must own a CustomerProfile. Booking.customer
      // is an unconstrained FK to User, so guard the selected target here —
      // otherwise a walk-in could be pinned to a user the back-office
      // customer directory (any user with a profile) can't resolve. Identity
      // is profile-based, not role-based: a back-office user who also carries
      // a CustomerProfile is a valid target. Unlike booking.create (online
      // self-serve), a walk-in does NOT require the target to have self-
      // onboarded — staff verify licence at the counter.
      const customer = await ctx.prisma.user.findUnique({
        where: { id: input.customerId },
        select: { customerProfile: { select: { id: true } } },
      });
      if (!customer?.customerProfile) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Walk-in bookings must be attached to a customer account.",
        });
      }
      await enforceBookingTimesWithinHours(ctx.prisma, {
        pickupDepotId: input.pickupDepotId,
        returnDepotId: input.returnDepotId,
        pickupDateTime: input.pickupDateTime,
        returnDateTime: input.returnDateTime,
      });
      const durationDays = Math.max(
        1,
        Math.ceil(
          (input.returnDateTime.getTime() - input.pickupDateTime.getTime()) /
            86400000,
        ),
      );
      const reference = `SCT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
      const booking = await ctx.prisma.booking.create({
        data: {
          bookingReference: reference,
          customerId: input.customerId,
          categoryId: input.categoryId,
          vehicleId: input.vehicleId,
          depotId: input.pickupDepotId,
          pickupDepotId: input.pickupDepotId,
          returnDepotId: input.returnDepotId,
          pickupDateTime: input.pickupDateTime,
          returnDateTime: input.returnDateTime,
          durationDays,
          subtotal: input.subtotal,
          totalAmount: input.totalAmount,
          gstAmount: input.gstAmount,
          bondAmount: input.bondAmount,
          amountPaid: input.totalAmount,
          balanceDue: 0,
          status: "CONFIRMED",
          source: "WALK_IN",
          agreedToTerms: true,
          termsVersion: "v1.0",
          createdById: ctx.user.id,
          confirmedById: ctx.user.id,
          payments: {
            create: {
              reference: `PAY-${Date.now()}`,
              type: "BOOKING_PAYMENT",
              method: input.method,
              amount: input.totalAmount,
              gstAmount: input.gstAmount,
              status: "SUCCEEDED",
              processedById: ctx.user.id,
              processedAt: new Date(),
            },
          },
          statusLog: {
            create: {
              newStatus: "CONFIRMED",
              changedById: ctx.user.id,
              reason: "Walk-in",
            },
          },
        },
      });
      captureBookingId(ctx, booking.id);
      await invalidateRevenueCaches(booking.depotId);
      return booking;
    }),

  stats: staffProcedure
    .input(z.object({ depotId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const now = new Date();
      const depotId = input?.depotId ?? ctx.user.depotId ?? undefined;

      const bookingWhere = (extra: Record<string, unknown>) => ({
        ...(depotId ? { depotId } : {}),
        ...extra,
      });

      const [activeRentals, todayPickups, todayReturns, overdue, vehicles] = await Promise.all([
        ctx.prisma.booking.count({
          where: bookingWhere({ status: { in: ["ACTIVE", "CHECKED_OUT"] } }),
        }),
        ctx.prisma.booking.count({
          where: bookingWhere({
            pickupDateTime: { gte: today, lt: tomorrow },
            status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
          }),
        }),
        ctx.prisma.booking.count({
          where: bookingWhere({
            returnDateTime: { gte: today, lt: tomorrow },
            status: { in: ["ACTIVE", "CHECKED_OUT"] },
          }),
        }),
        ctx.prisma.booking.count({
          where: bookingWhere({
            returnDateTime: { lt: now },
            status: { in: ["ACTIVE", "CHECKED_OUT", "OVERDUE"] },
          }),
        }),
        ctx.prisma.vehicle.groupBy({
          by: ["status"],
          where: {
            ...(depotId ? { depotId } : {}),
            isActive: true,
          },
          _count: { _all: true },
        }),
      ]);

      const bucket: Record<string, number> = {};
      for (const v of vehicles) bucket[v.status] = v._count._all;
      const utilisation = {
        rented: bucket.RENTED ?? 0,
        available: bucket.AVAILABLE ?? 0,
        maintenance: bucket.IN_MAINTENANCE ?? 0,
        offFleet:
          (bucket.SOLD ?? 0) +
          (bucket.END_OF_LIFE ?? 0) +
          (bucket.STOLEN ?? 0) +
          (bucket.WRITTEN_OFF ?? 0) +
          (bucket.ACCIDENT_REPAIRS ?? 0) +
          (bucket.PENDING ?? 0) +
          (bucket.IN_TRANSIT ?? 0) +
          (bucket.RESERVED ?? 0),
      };

      return {
        activeRentals,
        todayPickups,
        todayReturns,
        overdue,
        utilisation,
      };
    }),

  todayDashboard: staffProcedure
    .input(z.object({ depotId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const depotId = input?.depotId ?? ctx.user.depotId ?? undefined;

      const [pickups, returns, overdue, active, attention] = await Promise.all([
        ctx.prisma.booking.findMany({
          where: {
            pickupDateTime: { gte: today, lt: tomorrow },
            status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
            ...(depotId ? { pickupDepotId: depotId } : {}),
          },
          include: { customer: true, category: true, vehicle: true },
          orderBy: { pickupDateTime: "asc" },
        }),
        ctx.prisma.booking.findMany({
          where: {
            returnDateTime: { gte: today, lt: tomorrow },
            status: { in: ["ACTIVE", "CHECKED_OUT"] },
            ...(depotId ? { returnDepotId: depotId } : {}),
          },
          include: { customer: true, category: true, vehicle: true },
          orderBy: { returnDateTime: "asc" },
        }),
        ctx.prisma.booking.findMany({
          where: {
            returnDateTime: { lt: today },
            status: { in: ["ACTIVE", "OVERDUE", "CHECKED_OUT"] },
            ...(depotId ? { depotId } : {}),
          },
          include: { customer: true, category: true, vehicle: true },
          orderBy: { returnDateTime: "asc" },
          take: 50,
        }),
        ctx.prisma.booking.count({
          where: { status: "ACTIVE", ...(depotId ? { depotId } : {}) },
        }),
        ctx.prisma.vehicle.findMany({
          where: {
            ...(depotId ? { depotId } : {}),
            OR: [
              { regoExpiry: { lt: new Date(Date.now() + 30 * 86400000) } },
              {
                nextServiceDueDate: {
                  lt: new Date(Date.now() + 14 * 86400000),
                },
              },
            ],
          },
          take: 10,
        }),
      ]);

      return { pickups, returns, overdue, activeCount: active, attention };
    }),
});

export type AssignmentGate = { ok: true } | { ok: false; reason: string };

export function validateAssignmentPreconditions(args: {
  bookingStatus: string;
  bookingVehicleId: string | null;
}): AssignmentGate {
  if (!["ACTIVE", "CHECKED_OUT"].includes(args.bookingStatus)) {
    return {
      ok: false,
      reason: `Cannot assign a vehicle from status ${args.bookingStatus}`,
    };
  }
  if (args.bookingVehicleId) {
    return {
      ok: false,
      reason:
        "Booking already has a vehicle assigned. Use 'Swap vehicle' instead.",
    };
  }
  return { ok: true };
}

export function validateManualVehicleChoice(args: {
  bookingCategoryId: string;
  bookingPickupDepotId: string;
  vehicle: {
    isActive: boolean;
    status: string;
    categoryId: string;
    depotId: string;
    internalCode: string;
  };
}): AssignmentGate {
  const { vehicle, bookingCategoryId, bookingPickupDepotId } = args;
  if (!vehicle.isActive || vehicle.status !== "AVAILABLE") {
    return {
      ok: false,
      reason: `Vehicle ${vehicle.internalCode} is not available (status ${vehicle.status}).`,
    };
  }
  if (vehicle.categoryId !== bookingCategoryId) {
    return {
      ok: false,
      reason: `Vehicle ${vehicle.internalCode} is in a different category from the booking.`,
    };
  }
  if (vehicle.depotId !== bookingPickupDepotId) {
    return {
      ok: false,
      reason: `Vehicle ${vehicle.internalCode} is at a different depot. Transfer it first.`,
    };
  }
  return { ok: true };
}

const SWAP_ELIGIBLE_STATUSES = new Set(["ACTIVE", "CHECKED_OUT", "OVERDUE"]);

export function validateSwapPreconditions(args: {
  bookingStatus: string;
  currentVehicleId: string | null;
  candidate: {
    id: string;
    isActive: boolean;
    status: string;
    categoryId: string;
  };
  bookingCategoryId: string;
}): AssignmentGate {
  if (!SWAP_ELIGIBLE_STATUSES.has(args.bookingStatus)) {
    return {
      ok: false,
      reason: `Cannot swap vehicle from status ${args.bookingStatus}`,
    };
  }
  if (!args.currentVehicleId) {
    return {
      ok: false,
      reason: "Booking has no assigned vehicle to swap from.",
    };
  }
  if (args.currentVehicleId === args.candidate.id) {
    return {
      ok: false,
      reason: "New vehicle is the same as the current vehicle.",
    };
  }
  if (!args.candidate.isActive || args.candidate.status !== "AVAILABLE") {
    return {
      ok: false,
      reason: `Replacement vehicle is not available (status ${args.candidate.status}).`,
    };
  }
  if (args.candidate.categoryId !== args.bookingCategoryId) {
    return {
      ok: false,
      reason:
        "Replacement vehicle must be in the same category as the original.",
    };
  }
  return { ok: true };
}
