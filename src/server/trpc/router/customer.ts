import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { readPiiField, writePiiField } from "@/lib/customer-pii";
import { createCheckoutSession, StripePaymentMethodError } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { downloadFile, getSignedUrl } from "@/lib/storage";
import {
  AU_STATES,
  passportExpirySchema,
  passportNumberSchema,
} from "@/lib/validators/identity";
import {
  extractLicenceData,
  extractPassportData,
} from "@/server/services/document-extract";
import { skipAutoAudit, writeAuditAsync } from "@/server/services/audit";
import { applyLatestDocumentToProfile } from "@/server/services/identity-document";
import { sendNotification } from "@/server/services/notification-sender";
import {
  createSetupIntentForUser,
  persistDefaultPaymentMethod,
} from "@/server/services/stripe-customer";

import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  needsReconsent,
} from "@/lib/consent-versions";

import { createTRPCRouter, protectedProcedure, trpcRateLimit } from "../trpc";

// Self-service procedures act on the signed-in user. Meta helper so the
// auto-audit middleware tags every row with entity='User', entityId=<user id>.
const selfAudit = {
  audit: {
    customerIdPath: (_: unknown, ctx: unknown) =>
      (ctx as { session?: { user?: { id?: string } } }).session?.user?.id,
  },
} as const;

export const customerRouter = createTRPCRouter({
  /**
   * Cross-booking list of every tax document issued to the signed-in
   * customer — original tax invoices, adjustment notes (positive and
   * negative), and branded payment receipts. Used by the
   * `/dashboard/documents` "Tax invoices & receipts" section.
   *
   * Cursor-paginated by issue date desc per CLAUDE.md performance rule.
   */
  listAllTaxDocuments: protectedProcedure
    .input(
      z
        .object({
          cursor: z
            .object({ issuedAt: z.coerce.date(), id: z.string() })
            .nullable()
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit } = input;
      // Fetch a window of each kind, then merge + sort + slice. The
      // cursor narrows the date side; we then slice by `limit + 1` to
      // detect a next page.
      const cursorDate = cursor?.issuedAt;
      const dateGate = cursorDate ? { lt: cursorDate } : undefined;

      const [invoices, adjustments, receipts] = await Promise.all([
        ctx.prisma.invoice.findMany({
          where: {
            customerId: ctx.user.id,
            deletedAt: null,
            ...(dateGate ? { issuedAt: dateGate } : {}),
          },
          orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            invoiceNumber: true,
            issuedAt: true,
            createdAt: true,
            totalAmount: true,
            status: true,
            pdfUrl: true,
            pdfKey: true,
            bookingId: true,
            booking: { select: { bookingReference: true } },
          },
        }),
        ctx.prisma.adjustmentNote.findMany({
          where: {
            customerId: ctx.user.id,
            deletedAt: null,
            ...(dateGate ? { issuedAt: dateGate } : {}),
          },
          orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
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
            bookingId: true,
            booking: { select: { bookingReference: true } },
          },
        }),
        ctx.prisma.payment.findMany({
          where: {
            customerId: ctx.user.id,
            receiptNumber: { not: null },
            deletedAt: null,
            ...(dateGate
              ? {
                  OR: [
                    { processedAt: dateGate },
                    { AND: [{ processedAt: null }, { createdAt: dateGate }] },
                  ],
                }
              : {}),
          },
          orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            receiptNumber: true,
            processedAt: true,
            createdAt: true,
            amount: true,
            type: true,
            receiptPdfUrl: true,
            receiptPdfKey: true,
            bookingId: true,
            booking: { select: { bookingReference: true } },
          },
        }),
      ]);

      // Same-origin proxy URL — see booking.listDocuments for rationale.
      const proxy = (key: string | null, raw: string | null) =>
        key ? `/api/documents?key=${encodeURIComponent(key)}` : raw;

      type Doc = {
        id: string;
        kind: "TAX_INVOICE" | "ADJUSTMENT_INCREASE" | "ADJUSTMENT_DECREASE" | "RECEIPT";
        title: string;
        number: string;
        issuedAt: Date;
        totalAud: number;
        pdfUrl: string | null;
        bookingId: string | null;
        bookingReference: string | null;
      };

      const merged: Doc[] = [];
      for (const inv of invoices) {
        merged.push({
          id: `invoice-${inv.id}`,
          kind: "TAX_INVOICE",
          title: inv.status === "VOID" ? "Tax invoice (void)" : "Tax invoice",
          number: inv.invoiceNumber,
          issuedAt: inv.issuedAt ?? inv.createdAt,
          totalAud: Number(inv.totalAmount),
          pdfUrl: proxy(inv.pdfKey, inv.pdfUrl),
          bookingId: inv.bookingId,
          bookingReference: inv.booking?.bookingReference ?? null,
        });
      }
      for (const adj of adjustments) {
        merged.push({
          id: `adjustment-${adj.id}`,
          kind: adj.type === "INCREASE" ? "ADJUSTMENT_INCREASE" : "ADJUSTMENT_DECREASE",
          title: adj.description,
          number: adj.adjustmentNumber,
          issuedAt: adj.issuedAt,
          totalAud: Number(adj.totalAmount),
          pdfUrl: proxy(adj.pdfKey, adj.pdfUrl),
          bookingId: adj.bookingId,
          bookingReference: adj.booking?.bookingReference ?? null,
        });
      }
      for (const r of receipts) {
        merged.push({
          id: `receipt-${r.id}`,
          kind: "RECEIPT",
          title: "Payment receipt",
          number: r.receiptNumber!,
          issuedAt: r.processedAt ?? r.createdAt,
          totalAud: Number(r.amount),
          pdfUrl: proxy(r.receiptPdfKey, r.receiptPdfUrl),
          bookingId: r.bookingId,
          bookingReference: r.booking?.bookingReference ?? null,
        });
      }

      merged.sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
      const page = merged.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor =
        merged.length > limit && last ? { issuedAt: last.issuedAt, id: last.id } : null;
      return { documents: page, nextCursor };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      include: { customerProfile: true },
    });
    // Transparently decrypt PII fields (licenceNumber, passportNumber) so
    // self-service surfaces (booking wizard Step 4, /dashboard/profile) see
    // the real value regardless of how the row is stored. Shape is
    // preserved — plaintext string | null on the same property names.
    if (user?.customerProfile) {
      user.customerProfile.licenceNumber = readPiiField(
        user.customerProfile.licenceNumber,
        user.customerProfile.licenceNumberEnc,
      );
      user.customerProfile.passportNumber = readPiiField(
        user.customerProfile.passportNumber,
        user.customerProfile.passportNumberEnc,
      );
    }
    return user;
  }),

  /**
   * Whether the signed-in customer has accepted the current platform Terms
   * & Conditions and Privacy Policy. Drives the Step 5 re-consent gate for
   * legacy customers (registered before consent capture, or accepted a
   * superseded version that isn't grandfathered).
   */
  consentStatus: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.prisma.customerProfile.findUnique({
      where: { userId: ctx.user.id },
      select: {
        termsAcceptedAt: true,
        termsVersion: true,
        privacyAcceptedAt: true,
        privacyVersion: true,
      },
    });
    const termsCurrent =
      !!profile?.termsAcceptedAt && !needsReconsent(profile.termsVersion);
    const privacyCurrent =
      !!profile?.privacyAcceptedAt && !needsReconsent(profile.privacyVersion);
    return {
      hasTerms: termsCurrent,
      hasPrivacy: privacyCurrent,
      termsVersion: profile?.termsVersion ?? null,
      privacyVersion: profile?.privacyVersion ?? null,
      currentTermsVersion: TERMS_VERSION,
      currentPrivacyVersion: PRIVACY_VERSION,
    };
  }),

  /**
   * Stamp the current platform T&Cs + Privacy Policy version on the
   * caller's CustomerProfile. Idempotent — re-calling when already current
   * just refreshes the timestamp. Used by the Step 5 re-consent block for
   * customers who registered before consent capture (or via OAuth /
   * magic-link, which can't render the checkboxes).
   */
  acceptPlatformConsent: protectedProcedure
    .input(
      z.object({
        acceptedTerms: z.literal(true, {
          errorMap: () => ({ message: "You must accept the Terms & Conditions" }),
        }),
        acceptedPrivacy: z.literal(true, {
          errorMap: () => ({ message: "You must accept the Privacy Policy" }),
        }),
      }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx }) => {
      const now = new Date();
      await ctx.prisma.customerProfile.update({
        where: { userId: ctx.user.id },
        data: {
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
          privacyAcceptedAt: now,
          privacyVersion: PRIVACY_VERSION,
        },
      });
      return { ok: true as const };
    }),

  /**
   * Self-serve profile update. Covers name + contact + address +
   * identity-document text fields (licence / passport triplets + DOB).
   *
   * Identity fields:
   *   - licenceNumber / passportNumber go through `writePiiField` (APP-11).
   *   - Date fields (dateOfBirth, licenceExpiry, passportExpiry) accept ISO
   *     strings and are parsed into Date.
   *   - No image keys here — those go through `uploadIdentityDocument` so
   *     CustomerDocument rows are always the source of truth.
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        phone: z.string().optional(),
        dateOfBirth: z.string().optional(),
        addressLine1: z.string().optional(),
        addressLine2: z.string().optional(),
        suburb: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),
        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
        emergencyContactRelationship: z.string().optional(),
        marketingOptIn: z.boolean().optional(),
        marketingSmsOptIn: z.boolean().optional(),
        // Optional B2B identity. Renders on tax invoices when set.
        companyName: z.string().max(120).optional(),
        abn: z
          .string()
          .optional()
          .refine(
            (v) => v == null || v === "" || /^\d{11}$/.test(v.replace(/\D/g, "")),
            { message: "ABN must be 11 digits." },
          )
          .transform((v) => (v ? v.replace(/\D/g, "") : v)),
        // Licence triplet + class — all optional.
        licenceNumber: z.string().optional(),
        licenceState: z.enum(AU_STATES).optional(),
        licenceExpiry: z.string().optional(),
        licenceClass: z.string().optional(),
        // Identity path (Step 4 gate). AU_LICENCE uses licenceState;
        // INTERNATIONAL uses licenceCountry and requires a passport.
        licenceType: z.enum(["AU_LICENCE", "INTERNATIONAL"]).optional(),
        // ISO-3166 alpha-2 issuing country for an International Driver's
        // Permit. Uppercased + validated to 2 chars client-side; the
        // server only enforces the 2-char shape.
        licenceCountry: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2}$/u, "Country must be a 2-letter ISO code")
          .transform((v) => v.toUpperCase())
          .optional(),
        // Passport triplet — all optional.
        passportNumber: z.string().optional(),
        passportCountry: z.string().optional(),
        passportExpiry: z.string().optional(),
      }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const {
        firstName,
        lastName,
        phone,
        dateOfBirth,
        licenceNumber,
        passportNumber,
        licenceExpiry,
        passportExpiry,
        ...restProfileFields
      } = input;

      // User-level fields.
      const userData: Record<string, unknown> = {};
      if (firstName !== undefined) userData.firstName = firstName;
      if (lastName !== undefined) userData.lastName = lastName;
      if (phone !== undefined) userData.phone = phone;
      if (dateOfBirth !== undefined) {
        const dob = dateOfBirth === "" ? null : new Date(dateOfBirth);
        if (dob !== null && Number.isNaN(dob.getTime())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date of birth." });
        }
        userData.dateOfBirth = dob;
      }

      // Profile-level fields (passthrough + date parsing + PII encryption).
      const profileData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(restProfileFields)) {
        if (v !== undefined) profileData[k] = v;
      }

      // Parse date fields explicitly — Prisma @db.Date takes Date objects.
      for (const [key, raw] of [
        ["licenceExpiry", licenceExpiry],
        ["passportExpiry", passportExpiry],
      ] as const) {
        if (raw !== undefined) {
          if (raw === "") {
            profileData[key] = null;
            continue;
          }
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid ${key}.` });
          }
          profileData[key] = d;
        }
      }

      // Passport number format (PII) — schema-validate before encrypting.
      if (passportNumber !== undefined) {
        if (passportNumber === "") {
          Object.assign(profileData, writePiiField("passportNumber", "passportNumberEnc", null));
        } else {
          const parsed = passportNumberSchema.safeParse(passportNumber);
          if (!parsed.success) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: parsed.error.issues[0]?.message ?? "Invalid passport number.",
            });
          }
          Object.assign(
            profileData,
            writePiiField("passportNumber", "passportNumberEnc", parsed.data),
          );
        }
      }

      // Licence number (PII — no format regex, AU licence numbers vary).
      if (licenceNumber !== undefined) {
        const value = licenceNumber.trim() === "" ? null : licenceNumber.trim();
        Object.assign(profileData, writePiiField("licenceNumber", "licenceNumberEnc", value));
      }

      // Snapshot the previous values of every field that's about to be
      // written, before any update. The OCR-driven licence flow overwrites
      // existing values, so the audit row needs both before and after to
      // be useful when reconstructing what changed.
      const userFieldsChanging = Object.keys(userData);
      const profileFieldsChanging = Object.keys(profileData);
      let previousData: Record<string, unknown> | null = null;
      if (userFieldsChanging.length > 0 || profileFieldsChanging.length > 0) {
        const previous = await ctx.prisma.user.findUnique({
          where: { id: ctx.user.id },
          select: {
            firstName: true,
            lastName: true,
            phone: true,
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
                emergencyContactRelationship: true,
                marketingOptIn: true,
                marketingSmsOptIn: true,
                licenceNumber: true,
                licenceNumberEnc: true,
                licenceState: true,
                licenceExpiry: true,
                licenceClass: true,
                licenceType: true,
                licenceCountry: true,
                passportNumber: true,
                passportNumberEnc: true,
                passportCountry: true,
                passportExpiry: true,
              },
            },
          },
        });
        const prevUser = (previous ?? {}) as Record<string, unknown>;
        const prevProfile = (previous?.customerProfile ?? {}) as Record<string, unknown>;
        previousData = {};
        for (const k of userFieldsChanging) previousData[k] = prevUser[k] ?? null;
        for (const k of profileFieldsChanging) {
          if (k === "licenceNumber" || k === "licenceNumberEnc") {
            previousData.licenceNumber = readPiiField(
              prevProfile.licenceNumber as string | null | undefined,
              prevProfile.licenceNumberEnc,
            );
          } else if (k === "passportNumber" || k === "passportNumberEnc") {
            previousData.passportNumber = readPiiField(
              prevProfile.passportNumber as string | null | undefined,
              prevProfile.passportNumberEnc,
            );
          } else {
            previousData[k] = prevProfile[k] ?? null;
          }
        }
      }

      if (userFieldsChanging.length > 0) {
        await ctx.prisma.user.update({ where: { id: ctx.user.id }, data: userData });
      }
      if (profileFieldsChanging.length > 0) {
        await ctx.prisma.customerProfile.upsert({
          where: { userId: ctx.user.id },
          update: profileData,
          create: { userId: ctx.user.id, ...profileData },
        });
      }

      const changedFields = [...userFieldsChanging, ...profileFieldsChanging];
      if (changedFields.length > 0) {
        // Replace the bare auto-audit row (which only carries `newData`)
        // with a manual one that captures the snapshot taken above. The
        // skip is set only after the writes succeed — earlier failures
        // still get a FAILURE row from the auto-audit middleware.
        skipAutoAudit(ctx);
        writeAuditAsync(ctx.prisma, {
          userId: ctx.user.id,
          impersonatorId: ctx.session?.impersonatorId ?? null,
          category: "MUTATION",
          action: "customer.updateProfile",
          entity: "User",
          entityId: ctx.user.id,
          method: "tRPC",
          path: "customer.updateProfile",
          status: "SUCCESS",
          depotId: ctx.session?.user?.depotId ?? null,
          reqId: ctx.reqId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          previousData: previousData ?? undefined,
          newData: input,
        });

        const { getBranding } = await import("@/lib/branding");
        const { siteName } = await getBranding();
        const { default: ProfileUpdatedEmail } = await import(
          "../../../../emails/profile-updated"
        );
        const { render: renderEmail } = await import("@react-email/render");
        const { createElement } = await import("react");
        const { buildProfileChangeRows } = await import("@/lib/profile-change-display");
        const customerForGreeting = await ctx.prisma.user.findUnique({
          where: { id: ctx.user.id },
          select: { firstName: true },
        });
        const changes = buildProfileChangeRows({
          previousData,
          newData: input as Record<string, unknown>,
          changedFields,
        });
        const html = await renderEmail(
          createElement(ProfileUpdatedEmail, {
            customerName: customerForGreeting?.firstName ?? "there",
            actor: "you",
            staffName: null,
            changes,
            siteName,
          }),
        );
        await sendNotification({
          userId: ctx.user.id,
          type: "PROFILE_UPDATED_SELF",
          channels: ["EMAIL"],
          subject: `Your ${siteName} profile was updated`,
          title: "Profile updated",
          body: `Hi, this confirms ${changes.length} change(s) on your account: ${changes
            .map((c) => `${c.label}: ${c.previous} → ${c.current}`)
            .join("; ")}. If this wasn't you, please contact us immediately.`,
          html,
          templateKey: "profile-updated",
          data: { fields: changedFields },
          sentById: ctx.user.id,
        });
      }

      return { ok: true };
    }),

  // Phase D — stored payment methods. These wrap the stripe-customer
  // service so the customer portal and booking wizard can save / list /
  // remove / set-default cards without touching Stripe directly.

  // Returns the saved card details (no PAN/CVV — only brand/last4/exp) so
  // the portal can render "Visa •• 4242 · expires 12/28" and the wizard
  // can prefill a "Use card on file" toggle.
  paymentMethod: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.prisma.customerProfile.findUnique({
      where: { userId: ctx.user.id },
      select: {
        defaultStripePaymentMethodId: true,
        stripePaymentMethodBrand: true,
        stripePaymentMethodLast4: true,
        stripePaymentMethodExpMonth: true,
        stripePaymentMethodExpYear: true,
      },
    });
    if (!profile?.defaultStripePaymentMethodId) return null;
    return {
      paymentMethodId: profile.defaultStripePaymentMethodId,
      brand: profile.stripePaymentMethodBrand,
      last4: profile.stripePaymentMethodLast4,
      expMonth: profile.stripePaymentMethodExpMonth,
      expYear: profile.stripePaymentMethodExpYear,
    };
  }),

  // Kicks off a SetupIntent so the customer portal's "Add card" flow can
  // confirm it via Stripe Elements off-session. Returns the clientSecret
  // the Elements UI needs.
  createSetupIntent: protectedProcedure.meta(selfAudit).mutation(async ({ ctx }) => {
    return createSetupIntentForUser(ctx.user.id);
  }),

  // Called by the client after Stripe confirms the SetupIntent — persists
  // the returned PaymentMethod id on CustomerProfile so future off-session
  // charges can use it. Idempotent.
  //
  // Stripe rejections surface here as StripePaymentMethodError carrying the
  // Stripe error code (`resource_missing`, `payment_method_unexpected_state`
  // etc.) — we map to a precise TRPCError so the audit row records the real
  // reason instead of a generic INTERNAL_SERVER_ERROR, and the UI gets a
  // user-safe message.
  savePaymentMethod: protectedProcedure
    .input(z.object({ paymentMethodId: z.string().min(1) }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      try {
        await persistDefaultPaymentMethod(ctx.user.id, input.paymentMethodId);
        return { ok: true };
      } catch (err) {
        if (err instanceof StripePaymentMethodError) {
          logger.warn(
            {
              userId: ctx.user.id,
              stripeCode: err.code,
              stripeType: err.stripeType,
              stripeRequestId: err.stripeRequestId,
              message: err.message,
            },
            "savePaymentMethod: Stripe rejected attach",
          );
          // Hard-decline / customer mistake → BAD_REQUEST so the client can
          // surface the userMessage verbatim. Infra-side problems (auth,
          // network) bubble as INTERNAL_SERVER_ERROR so ops gets alerted.
          const infraCodes = new Set([
            "stripe_unknown_error",
            "api_key_expired",
            "authentication_required",
            "rate_limit",
          ]);
          throw new TRPCError({
            code: infraCodes.has(err.code) ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
            message: `${err.userMessage} [stripe:${err.code}]`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  // Wipes the default PM off the customer's profile. The Stripe
  // PaymentMethod itself is not detached — it remains on the Customer in
  // Stripe (useful for history) but will no longer be charged
  // off-session because defaultStripePaymentMethodId is null.
  removePaymentMethod: protectedProcedure.meta(selfAudit).mutation(async ({ ctx }) => {
    await ctx.prisma.customerProfile.update({
      where: { userId: ctx.user.id },
      data: {
        defaultStripePaymentMethodId: null,
        stripePaymentMethodBrand: null,
        stripePaymentMethodLast4: null,
        stripePaymentMethodExpMonth: null,
        stripePaymentMethodExpYear: null,
      },
    });
    return { ok: true };
  }),

  // Phase E — outstanding balance summary for the customer dashboard.
  // Returns all PENDING / FAILED Payment rows across every booking the
  // customer has, grouped by booking so the portal can render a "you
  // have A$X outstanding across N bookings" tile.
  outstandingBalance: protectedProcedure.query(async ({ ctx }) => {
    const payments = await ctx.prisma.payment.findMany({
      where: {
        customerId: ctx.user.id,
        status: { in: ["PENDING", "FAILED"] },
        type: {
          in: [
            "LATE_FEE",
            "FUEL_CHARGE",
            "DAMAGE_CHARGE",
            "INFRINGEMENT_RECOVERY",
            "MANUAL_CHARGE",
            "EXTENSION",
            "CLEANING_FEE",
            "SUBSCRIPTION_CHARGE",
            "BOOKING_PAYMENT",
          ],
        },
      },
      include: { booking: { select: { id: true, bookingReference: true } } },
      orderBy: { createdAt: "asc" },
    });
    const total = payments.reduce((acc, p) => acc + Number(p.amount), 0);
    return {
      total,
      count: payments.length,
      byBooking: payments.reduce<
        Record<
          string,
          { bookingId: string; bookingReference: string; total: number; paymentIds: string[] }
        >
      >((acc, p) => {
        const key = p.bookingId ?? "no-booking";
        if (!acc[key]) {
          acc[key] = {
            bookingId: p.bookingId ?? "",
            bookingReference: p.booking?.bookingReference ?? "Misc",
            total: 0,
            paymentIds: [],
          };
        }
        acc[key].total += Number(p.amount);
        acc[key].paymentIds.push(p.id);
        return acc;
      }, {}),
    };
  }),

  // Phase E — create a Stripe Checkout "Pay now" session for the given
  // Payment rows. On success, Stripe redirects the customer to
  // /dashboard/pay/success which flips each Payment row to SUCCEEDED.
  createPayNowSession: protectedProcedure
    .input(z.object({ paymentIds: z.array(z.string()).min(1) }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.prisma.payment.findMany({
        where: {
          id: { in: input.paymentIds },
          customerId: ctx.user.id,
          status: { in: ["PENDING", "FAILED"] },
        },
        include: { booking: { select: { bookingReference: true } } },
      });
      if (rows.length === 0) {
        throw new Error("No outstanding payments found for that selection");
      }
      const total = rows.reduce((acc, p) => acc + Number(p.amount), 0);
      const description =
        rows.length === 1
          ? `${rows[0]!.type.replace(/_/g, " ")} — ${rows[0]!.booking?.bookingReference ?? rows[0]!.reference}`
          : `${rows.length} outstanding charges`;
      const profile = await ctx.prisma.customerProfile.findUnique({
        where: { userId: ctx.user.id },
        select: { stripeCustomerId: true, user: { select: { email: true } } },
      });
      // Skip a stub customer id — it won't resolve in real Stripe and would
      // fail the Checkout session with `resource_missing - customer`. Let
      // Checkout mint a new Customer from `customer_email` instead.
      const storedCustomerId =
        profile?.stripeCustomerId && !profile.stripeCustomerId.startsWith("cus_stub_")
          ? profile.stripeCustomerId
          : null;
      const baseUrl =
        process.env.AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
      const session = await createCheckoutSession({
        amount: total,
        customerEmail: profile?.user.email ?? ctx.session.user.email ?? "unknown@example.com",
        customerId: storedCustomerId,
        description,
        metadata: {
          paymentIds: input.paymentIds.join(","),
          userId: ctx.user.id,
        },
        successUrl: `${baseUrl}/dashboard/pay/success?ids=${encodeURIComponent(input.paymentIds.join(","))}`,
        cancelUrl: `${baseUrl}/dashboard`,
      });
      return { url: session.url, sessionId: session.id };
    }),

  // Phase E — called by the /dashboard/pay/success page after Stripe
  // redirects back. Flips the rows to SUCCEEDED (best-effort — the
  // Stripe webhook is still source of truth). Safe to call multiple
  // times; idempotent on already-SUCCEEDED rows.
  markPayNowComplete: protectedProcedure
    .input(z.object({ paymentIds: z.array(z.string()).min(1) }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.payment.updateMany({
        where: {
          id: { in: input.paymentIds },
          customerId: ctx.user.id,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: {
          status: "SUCCEEDED",
          processedAt: new Date(),
          notes: "Paid via customer portal 'Pay now'",
        },
      });
      return { ok: true };
    }),

  /**
   * OCR a licence image that the user has just uploaded to S3. Returns
   * suggested form-field defaults. Empty fields = low confidence or
   * extraction failure — the caller shouldn't distinguish the two.
   *
   * Rate-limited per user: vision calls cost real money and we don't want
   * an accidental loop to burn the quota.
   */
  extractLicenceFromImage: protectedProcedure
    .use(
      trpcRateLimit<{ imageKey: string }>({
        bucket: "customer:ocr-licence",
        limit: 20,
        windowSec: 60 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(z.object({ imageKey: z.string().min(1) }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const buffer = await downloadFile(input.imageKey);
      const result = await extractLicenceData(buffer, {
        log: {
          prisma: ctx.prisma,
          customerId: ctx.user.id,
          triggeredById: ctx.user.id,
        },
      });
      return result;
    }),

  extractPassportFromImage: protectedProcedure
    .use(
      trpcRateLimit<{ imageKey: string }>({
        bucket: "customer:ocr-passport",
        limit: 20,
        windowSec: 60 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(z.object({ imageKey: z.string().min(1) }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const buffer = await downloadFile(input.imageKey);
      const result = await extractPassportData(buffer, {
        log: {
          prisma: ctx.prisma,
          customerId: ctx.user.id,
          triggeredById: ctx.user.id,
        },
      });
      return result;
    }),

  /**
   * Customer self-upload of an identity document image that was previously
   * posted to `/api/upload/identity-document`. Creates a CustomerDocument
   * row and recomputes the CustomerProfile cache projection for the given
   * type in one transaction.
   *
   * Cross-user attachment guard: the image key must live under
   * `drivers/<self-userId>/…`. The upload API route enforces that folder,
   * but we re-check here so a malicious payload with another user's key
   * is rejected even if the API route ever regresses.
   */
  uploadIdentityDocument: protectedProcedure
    .use(
      trpcRateLimit<{ imageKey: string }>({
        bucket: "customer:upload-identity",
        limit: 10,
        windowSec: 60 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(
      z.object({
        type: z.enum(["LICENCE_FRONT", "LICENCE_BACK", "PASSPORT"]),
        imageKey: z.string().min(1),
        label: z.string().optional(),
        expiryDate: z.string().optional(),
      }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const expectedPrefix = `drivers/${ctx.user.id}/`;
      if (!input.imageKey.startsWith(expectedPrefix)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Uploaded file key isn't in your customer folder.",
        });
      }

      // Parse + validate expiry if supplied. Passport expiry has a stricter
      // schema (must be future-dated); licence expiry is looser here because
      // a customer may be uploading a since-expired licence while they wait
      // for the renewal to arrive — the eligibility gate blocks them from
      // booking, but the document itself should still be on file.
      let expiryDate: Date | undefined;
      if (input.expiryDate && input.expiryDate !== "") {
        if (input.type === "PASSPORT") {
          const parsed = passportExpirySchema.safeParse(input.expiryDate);
          if (!parsed.success) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: parsed.error.issues[0]?.message ?? "Invalid expiry.",
            });
          }
          expiryDate = new Date(parsed.data);
        } else {
          const d = new Date(input.expiryDate);
          if (Number.isNaN(d.getTime())) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid expiry." });
          }
          expiryDate = d;
        }
      }

      const doc = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.customerDocument.create({
          data: {
            customerId: ctx.user.id,
            type: input.type,
            fileUrl: input.imageKey,
            label: input.label ?? null,
            expiryDate: expiryDate ?? null,
            uploadedById: ctx.user.id,
          },
        });
        await applyLatestDocumentToProfile(tx, ctx.user.id, input.type);
        return created;
      });

      // Replace the generic auto-audit row with one that carries the
      // document-scoped metadata (type, label, expiry) the staff Activity
      // tab expects — the auto row would otherwise log the raw S3 key.
      skipAutoAudit(ctx);
      writeAuditAsync(ctx.prisma, {
        userId: ctx.user.id,
        impersonatorId: ctx.session?.impersonatorId ?? null,
        category: "MUTATION",
        action: "document.uploaded",
        entity: "User",
        entityId: ctx.user.id,
        method: "tRPC",
        path: "customer.uploadIdentityDocument",
        status: "SUCCESS",
        depotId: ctx.session?.user?.depotId ?? null,
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: {
          documentId: doc.id,
          type: doc.type,
          label: input.label ?? null,
          expiryDate: expiryDate ? expiryDate.toISOString() : null,
        },
      });

      return { id: doc.id, type: doc.type, fileUrl: doc.fileUrl };
    }),

  /**
   * Fire-and-forget audit hook the customer portal calls when the user
   * explicitly clicks "View" or "Download" on one of their identity
   * documents or signed consent PDFs. The thumbnail / preview render is
   * already captured by the page.view row for /dashboard/documents, so
   * this mutation exists purely to distinguish an intentional open from a
   * passive page load.
   *
   * Returns a freshly-minted signed URL so the client can open it without
   * a second round-trip. Ownership is verified before signing.
   */
  recordDocumentAccess: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        reason: z.enum(["view", "download"]).default("view"),
      }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.prisma.customerDocument.findFirst({
        where: { id: input.documentId, customerId: ctx.user.id },
        select: { id: true, type: true, fileUrl: true, label: true },
      });
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      }

      let url = doc.fileUrl;
      if (
        url &&
        !url.startsWith("http://") &&
        !url.startsWith("https://") &&
        !url.startsWith("/")
      ) {
        url = await getSignedUrl(url);
      }

      skipAutoAudit(ctx);
      writeAuditAsync(ctx.prisma, {
        userId: ctx.user.id,
        impersonatorId: ctx.session?.impersonatorId ?? null,
        category: "MUTATION",
        action: input.reason === "download" ? "document.downloaded" : "document.viewed",
        entity: "User",
        entityId: ctx.user.id,
        method: "tRPC",
        path: "customer.recordDocumentAccess",
        status: "SUCCESS",
        depotId: ctx.session?.user?.depotId ?? null,
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: {
          documentId: doc.id,
          type: doc.type,
          label: doc.label,
          reason: input.reason,
        },
      });

      return { url };
    }),

  /**
   * Identity documents for the /dashboard/documents page. Returns the
   * newest row per (LICENCE_FRONT, LICENCE_BACK, PASSPORT) as `latest`,
   * and all older rows of those types as `history` (ordered newest first).
   * File URLs are signed (15-min expiry) so private S3 keys stay private.
   */
  identityDocuments: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.customerDocument.findMany({
      where: {
        customerId: ctx.user.id,
        type: { in: ["LICENCE_FRONT", "LICENCE_BACK", "PASSPORT"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        fileUrl: true,
        expiryDate: true,
        label: true,
        createdAt: true,
      },
    });

    const resolve = async (raw: string): Promise<string> => {
      if (!raw) return raw;
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
      if (raw.startsWith("/")) return raw;
      return getSignedUrl(raw);
    };

    const latest: Record<
      "LICENCE_FRONT" | "LICENCE_BACK" | "PASSPORT",
      null | {
        id: string;
        fileUrl: string;
        signedUrl: string;
        expiryDate: Date | null;
        createdAt: Date;
      }
    > = { LICENCE_FRONT: null, LICENCE_BACK: null, PASSPORT: null };
    const history: Array<{
      id: string;
      type: "LICENCE_FRONT" | "LICENCE_BACK" | "PASSPORT";
      fileUrl: string;
      signedUrl: string;
      expiryDate: Date | null;
      createdAt: Date;
    }> = [];

    for (const r of rows) {
      const type = r.type as "LICENCE_FRONT" | "LICENCE_BACK" | "PASSPORT";
      const signedUrl = await resolve(r.fileUrl);
      if (latest[type] === null) {
        latest[type] = {
          id: r.id,
          fileUrl: r.fileUrl,
          signedUrl,
          expiryDate: r.expiryDate,
          createdAt: r.createdAt,
        };
      } else {
        history.push({
          id: r.id,
          type,
          fileUrl: r.fileUrl,
          signedUrl,
          expiryDate: r.expiryDate,
          createdAt: r.createdAt,
        });
      }
    }

    return { latest, history };
  }),

  /**
   * Signed consent PDFs the customer received during onboarding — the
   * customer's own copies of the Terms of Hire, Privacy Policy,
   * Cancellation Policy, and Marketing Consent they put their signature
   * on. One entry per consent type (most recent row wins if onboarding
   * was re-run). File URLs are signed (15-min expiry).
   */
  signedConsents: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.customerDocument.findMany({
      where: {
        customerId: ctx.user.id,
        type: {
          in: [
            "CONSENT_TERMS",
            "CONSENT_PRIVACY",
            "CONSENT_CANCELLATION",
            "CONSENT_MARKETING",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        fileUrl: true,
        label: true,
        metadata: true,
        createdAt: true,
      },
    });

    const latestByType = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByType.has(r.type)) latestByType.set(r.type, r);
    }

    // Always serve through the same-origin proxy at
    // /api/customer-document?id=... — direct bucket URLs leak the
    // dev MinIO host (`http://localhost:9000/...`) to browsers and
    // require widening CSP in prod. The proxy resolves the S3 key
    // from metadata.fileKey, gates on auth + ownership, and streams
    // the bytes back same-origin.
    return Array.from(latestByType.values()).map((r) => {
      const md = (r.metadata ?? {}) as {
        docKey?: string;
        docVersion?: string;
        signedAt?: string;
      };
      return {
        id: r.id,
        type: r.type,
        label: r.label,
        docKey: md.docKey ?? null,
        docVersion: md.docVersion ?? null,
        signedAt: md.signedAt ?? r.createdAt.toISOString(),
        signedUrl: `/api/customer-document?id=${encodeURIComponent(r.id)}`,
      };
    });
  }),
});
