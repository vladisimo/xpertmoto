import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, managerProcedure, protectedProcedure, staffProcedure } from "../trpc";
import { uploadFile } from "@/lib/storage";
import { CURRENT_TERMS, interpolateTerms, interpolateTermsText } from "@/lib/agreement/terms";
import { renderRentalAgreementPdf, type RentalAgreementData } from "@/lib/agreement/pdf/rental-agreement-pdf";
import { getBranding } from "@/lib/branding";
import { requestTimestamp, sha256Buffer } from "@/lib/agreement/timestamp";
import { writeAudit } from "@/server/services/audit";
import { autoCloseByTarget } from "@/server/services/staff-tasks";
import { logger } from "@/lib/logger";

const BOND_POLICY = [
  "A refundable security bond is held against your card at the start of the hire. The amount is shown on the pricing summary page of this agreement.",
  "The bond may be applied in whole or in part against damage, late-return fees, fuel shortfall, cleaning, infringements and insurance excess.",
  "Any unused portion is released to your card within 14 days of the vehicle being returned and all charges being settled.",
];

const CANCELLATION_POLICY = [
  "Cancellations made more than 72 hours before pickup: full refund less a $25 administration fee.",
  "Cancellations made between 24 and 72 hours before pickup: 50% refund.",
  "Cancellations made within 24 hours of pickup, or no-shows: no refund; a $50 no-show fee may apply.",
];

const DRIVER_DECLARATIONS = [
  "I am the person named on the cover page and I have presented my current, valid licence to {{siteName}} staff.",
  "I have not consumed alcohol or any drug that could impair my ability to drive safely.",
  "I will be the sole driver of this vehicle unless another person has been added as an additional driver and has also signed this agreement.",
  "I understand that all traffic and parking infringements and tolls incurred during the hire period are my responsibility regardless of who was driving.",
  "I will notify {{siteName}} as soon as reasonably possible of any collision, theft, fire, damage, mechanical issue, or infringement involving the vehicle.",
  "I have reviewed the vehicle's pre-hire condition and accept it as the starting condition of the hire.",
];

type ContentSnapshot = {
  terms: typeof CURRENT_TERMS;
  bondPolicy: string[];
  cancellationPolicy: string[];
  declarations: string[];
  customerFrozen: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  vehicleFrozen: {
    internalCode: string;
    rego: string;
    make: string;
    model: string;
    year: number;
    colour: string | null;
  } | null;
  categoryFrozen: { name: string };
  pickupDepotFrozen: {
    name: string;
    addressLine1: string;
    suburb: string;
    state: string;
    postcode: string;
  };
  returnDepotFrozen: { name: string };
  bookingFrozen: {
    bookingReference: string;
    pickupDateTime: string;
    returnDateTime: string;
    durationDays: number;
    subtotal: string;
    addonTotal: string;
    insuranceTotal: string;
    discountAmount: string;
    gstAmount: string;
    totalAmount: string;
    bondAmount: string;
  };
  addonsFrozen: { name: string; quantity: number; totalPrice: string }[];
  insuranceFrozen: { name: string; excessAmount: string; totalPrice: string } | null;
};

type PageInitialsEntry = { pageId: string; initialsUrl: string; signedAt: string };

const AGREEMENT_PAGE_IDS = [
  "cover",
  "pricing",
  "condition",
  "terms",
  "bond-policy",
  "declarations",
] as const;

async function buildAgreementNumber(tx: Prisma.TransactionClient, bookingRef: string, version: number): Promise<string> {
  const base = `AGR-${bookingRef}-v${version}`;
  // uniqueness: if somehow exists, append random suffix
  const existing = await tx.rentalAgreement.findUnique({ where: { agreementNumber: base } });
  if (!existing) return base;
  return `${base}-${randomBytes(2).toString("hex")}`;
}

async function uploadDataUrl(dataUrl: string, folder: string, filename: string) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match || !match[1] || !match[2]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid signature data URL" });
  }
  const contentType = match[1];
  const body = Buffer.from(match[2], "base64");
  if (body.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty signature image" });
  return uploadFile({ folder, filename, contentType, body });
}

export const agreementRouter = createTRPCRouter({
  /** Staff starts or resumes a DRAFT rental agreement for a booking. */
  startDraft: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: {
          customer: true,
          vehicle: true,
          category: true,
          pickupDepot: true,
          returnDepot: true,
          addons: { include: { addon: true } },
          insurance: { include: { insuranceOption: true } },
        },
      });

      const preHire = await ctx.prisma.inspection.findFirst({
        where: { bookingId: booking.id, type: "PRE_HIRE" },
        orderBy: { dateTime: "desc" },
      });
      if (!preHire) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A pre-hire inspection must exist before the rental agreement can be drafted. Start the inspection step first.",
        });
      }

      // Is there already a DRAFT for this booking + inspection? Return it.
      const existingDraft = await ctx.prisma.rentalAgreement.findFirst({
        where: { bookingId: booking.id, status: "DRAFT" },
      });
      if (existingDraft) return existingDraft;

      // Determine version. Previous SIGNED -> new version, otherwise v1.
      const prior = await ctx.prisma.rentalAgreement.findMany({
        where: { bookingId: booking.id },
        orderBy: { version: "desc" },
        take: 1,
      });
      const version = (prior[0]?.version ?? 0) + 1;

      const draftBranding = await getBranding();
      const draftTermsBranding = {
        siteName: draftBranding.siteName,
        legalName: draftBranding.legalName,
        abn: draftBranding.abn,
      };

      const snapshot: ContentSnapshot = {
        terms: interpolateTerms(CURRENT_TERMS, draftTermsBranding),
        bondPolicy: BOND_POLICY,
        cancellationPolicy: CANCELLATION_POLICY,
        declarations: DRIVER_DECLARATIONS.map((d) =>
          interpolateTermsText(d, draftTermsBranding),
        ),
        customerFrozen: {
          firstName: booking.customer.firstName,
          lastName: booking.customer.lastName,
          email: booking.customer.email,
          phone: booking.customer.phone,
        },
        vehicleFrozen: booking.vehicle
          ? {
              internalCode: booking.vehicle.internalCode,
              rego: booking.vehicle.rego,
              make: booking.vehicle.make,
              model: booking.vehicle.model,
              year: booking.vehicle.year,
              colour: booking.vehicle.colour,
            }
          : null,
        categoryFrozen: { name: booking.category.name },
        pickupDepotFrozen: {
          name: booking.pickupDepot.name,
          addressLine1: booking.pickupDepot.addressLine1,
          suburb: booking.pickupDepot.suburb,
          state: booking.pickupDepot.state,
          postcode: booking.pickupDepot.postcode,
        },
        returnDepotFrozen: { name: booking.returnDepot.name },
        bookingFrozen: {
          bookingReference: booking.bookingReference,
          pickupDateTime: booking.pickupDateTime.toISOString(),
          returnDateTime: booking.returnDateTime.toISOString(),
          durationDays: booking.durationDays,
          subtotal: booking.subtotal.toString(),
          addonTotal: booking.addonTotal.toString(),
          insuranceTotal: booking.insuranceTotal.toString(),
          discountAmount: booking.discountAmount.toString(),
          gstAmount: booking.gstAmount.toString(),
          totalAmount: booking.totalAmount.toString(),
          bondAmount: booking.bondAmount.toString(),
        },
        addonsFrozen: booking.addons.map((a) => ({
          name: a.addon.name,
          quantity: a.quantity,
          totalPrice: a.totalPrice.toString(),
        })),
        insuranceFrozen: booking.insurance[0]
          ? {
              name: booking.insurance[0].insuranceOption.name,
              excessAmount: booking.insurance[0].insuranceOption.excessAmount.toString(),
              totalPrice: booking.insurance[0].totalPrice.toString(),
            }
          : null,
      };

      const agreement = await ctx.prisma.$transaction(async (tx) => {
        const agreementNumber = await buildAgreementNumber(tx, booking.bookingReference, version);
        return tx.rentalAgreement.create({
          data: {
            bookingId: booking.id,
            inspectionId: preHire.id,
            agreementNumber,
            version,
            termsVersion: CURRENT_TERMS.version,
            status: "DRAFT",
            contentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            staffId: ctx.user.id,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      });
      return agreement;
    }),

  /** Persist a captured signature/initials PNG to storage + update agreement. */
  saveSignature: staffProcedure
    .input(
      z
        .object({
          agreementId: z.string(),
          kind: z.enum(["initials", "full-customer", "full-staff"]),
          pageId: z.enum(AGREEMENT_PAGE_IDS).optional(),
          dataUrl: z.string().min(16).optional(),
          reuseUrl: z.string().min(1).optional(),
        })
        .refine((v) => !!v.dataUrl !== !!v.reuseUrl, {
          message: "Provide exactly one of dataUrl or reuseUrl",
        })
        .refine((v) => !v.reuseUrl || v.kind === "initials", {
          message: "reuseUrl is only supported for initials",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const agreement = await ctx.prisma.rentalAgreement.findUniqueOrThrow({
        where: { id: input.agreementId },
      });
      if (agreement.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot modify a sealed agreement" });
      }

      let url: string;
      if (input.reuseUrl) {
        url = input.reuseUrl;
      } else {
        const folder = `agreements/${agreement.bookingId}/${agreement.id}`;
        const filename =
          input.kind === "full-customer"
            ? "signature-customer.png"
            : input.kind === "full-staff"
              ? "signature-staff.png"
              : `initials-${input.pageId ?? "first"}.png`;
        const uploaded = await uploadDataUrl(input.dataUrl!, folder, filename);
        url = uploaded.url;
      }

      const updates: Prisma.RentalAgreementUpdateInput = {};
      if (input.kind === "full-customer") updates.customerSignatureUrl = url;
      if (input.kind === "full-staff") updates.staffSignatureUrl = url;
      if (input.kind === "initials") {
        if (!input.pageId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "pageId is required for initials" });
        }
        const pagesNow = (agreement.pagesInitialled as unknown as PageInitialsEntry[]) ?? [];
        const nextPages = pagesNow.filter((p) => p.pageId !== input.pageId);
        nextPages.push({
          pageId: input.pageId,
          initialsUrl: url,
          signedAt: new Date().toISOString(),
        });
        updates.pagesInitialled = nextPages as unknown as Prisma.InputJsonValue;
        if (!agreement.customerInitialsUrl) {
          updates.customerInitialsUrl = url;
        }
      }

      const updated = await ctx.prisma.rentalAgreement.update({
        where: { id: agreement.id },
        data: updates,
      });
      return { url, agreement: updated };
    }),

  /** Append a customer-added damage marker to the linked pre-hire inspection. */
  addCustomerDamageMarker: staffProcedure
    .input(
      z.object({
        agreementId: z.string(),
        marker: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
          note: z.string().optional(),
          view: z.enum(["LEFT", "RIGHT", "FRONT", "REAR"]).default("LEFT"),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agreement = await ctx.prisma.rentalAgreement.findUniqueOrThrow({
        where: { id: input.agreementId },
      });
      if (agreement.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot modify a sealed agreement" });
      }
      const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: agreement.inspectionId },
      });
      const current = (inspection.bodyDamageMap as unknown as { markers?: Array<Record<string, unknown>> })?.markers ?? [];
      const next = [
        ...current,
        { ...input.marker, source: "customer", addedAt: new Date().toISOString() },
      ];
      await ctx.prisma.inspection.update({
        where: { id: inspection.id },
        data: {
          bodyDamageMap: { markers: next } as unknown as Prisma.InputJsonValue,
          customerAckedAt: new Date(),
        },
      });
      return { ok: true as const };
    }),

  /** Seal a DRAFT agreement: validate, render PDF, upload, timestamp, mark SIGNED. */
  finalise: staffProcedure
    .input(z.object({ agreementId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agreement = await ctx.prisma.rentalAgreement.findUnique({
        where: { id: input.agreementId },
        include: {
          booking: {
            include: {
              customer: true,
              vehicle: true,
              category: true,
              pickupDepot: true,
              returnDepot: true,
              addons: { include: { addon: true } },
              insurance: { include: { insuranceOption: true } },
            },
          },
          inspection: { include: { photos: true } },
          staff: true,
        },
      });
      if (!agreement) throw new TRPCError({ code: "NOT_FOUND" });
      if (agreement.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Agreement already ${agreement.status.toLowerCase()}` });
      }
      if (!agreement.customerSignatureUrl || !agreement.staffSignatureUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both customer and staff signatures are required before finalising.",
        });
      }
      const pagesNow = (agreement.pagesInitialled as unknown as PageInitialsEntry[]) ?? [];
      const missing = AGREEMENT_PAGE_IDS.filter((id) => !pagesNow.some((p) => p.pageId === id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Missing initials on pages: ${missing.join(", ")}`,
        });
      }

      const booking = agreement.booking;
      const insurance = booking.insurance[0];
      const damageMarkers =
        (agreement.inspection.bodyDamageMap as unknown as {
          markers?: { x: number; y: number; severity: string; note?: string; view?: "LEFT" | "RIGHT" | "FRONT" | "REAR" }[];
        })?.markers ?? [];

      const branding = await getBranding();
      const termsBranding = {
        siteName: branding.siteName,
        legalName: branding.legalName,
        abn: branding.abn,
      };

      const pdfData: RentalAgreementData = {
        agreementNumber: agreement.agreementNumber,
        version: agreement.version,
        termsVersion: agreement.termsVersion,
        signedAt: new Date(),
        booking: {
          bookingReference: booking.bookingReference,
          pickupDateTime: booking.pickupDateTime,
          returnDateTime: booking.returnDateTime,
          durationDays: booking.durationDays,
          subtotal: Number(booking.subtotal),
          addonTotal: Number(booking.addonTotal),
          insuranceTotal: Number(booking.insuranceTotal),
          discountAmount: Number(booking.discountAmount),
          gstAmount: Number(booking.gstAmount),
          totalAmount: Number(booking.totalAmount),
          bondAmount: Number(booking.bondAmount),
        },
        customer: {
          firstName: booking.customer.firstName,
          lastName: booking.customer.lastName,
          email: booking.customer.email,
          phone: booking.customer.phone,
        },
        vehicle: booking.vehicle ?? {
          internalCode: "—",
          rego: "—",
          make: "—",
          model: "—",
          year: 0,
          colour: null,
        },
        category: { name: booking.category.name },
        pickupDepot: {
          name: booking.pickupDepot.name,
          addressLine1: booking.pickupDepot.addressLine1,
          suburb: booking.pickupDepot.suburb,
          state: booking.pickupDepot.state,
          postcode: booking.pickupDepot.postcode,
        },
        returnDepot: { name: booking.returnDepot.name },
        staffName: agreement.staff ? `${agreement.staff.firstName} ${agreement.staff.lastName}` : undefined,
        addons: booking.addons.map((a) => ({
          name: a.addon.name,
          quantity: a.quantity,
          totalPrice: Number(a.totalPrice),
        })),
        insurance: insurance
          ? {
              name: insurance.insuranceOption.name,
              excessAmount: Number(insurance.insuranceOption.excessAmount),
              totalPrice: Number(insurance.totalPrice),
            }
          : null,
        photos: agreement.inspection.photos.map((p) => ({ url: p.url, caption: p.caption })),
        damageMarkers,
        terms: interpolateTerms(CURRENT_TERMS, termsBranding),
        cancellationPolicy: CANCELLATION_POLICY,
        bondPolicy: BOND_POLICY,
        declarations: DRIVER_DECLARATIONS.map((d) => interpolateTermsText(d, termsBranding)),
        signatures: {
          customerFullUrl: agreement.customerSignatureUrl,
          staffFullUrl: agreement.staffSignatureUrl,
          initialsUrl: agreement.customerInitialsUrl,
        },
        abn: branding.abn,
      };

      const pdfBuffer = await renderRentalAgreementPdf(pdfData);
      const pdfUpload = await uploadFile({
        folder: `agreements/${booking.id}/${agreement.id}`,
        filename: "rental-agreement.pdf",
        contentType: "application/pdf",
        body: pdfBuffer,
      });

      // RFC3161 timestamp (best-effort).
      const hash = sha256Buffer(pdfBuffer);
      const ts = await requestTimestamp(hash);
      let timestampTokenKey: string | null = null;
      let timestampStatus: "OK" | "PENDING" | "FAILED" = "PENDING";
      let timestampTsaUrl: string | null = null;
      let timestampedAt: Date | null = null;
      if (ts.ok) {
        const tokenUpload = await uploadFile({
          folder: `agreements/${booking.id}/${agreement.id}`,
          filename: "timestamp.tsr",
          contentType: "application/timestamp-reply",
          body: ts.token,
        });
        timestampTokenKey = tokenUpload.key;
        timestampStatus = "OK";
        timestampTsaUrl = ts.tsaUrl;
        timestampedAt = ts.receivedAt;
      } else {
        timestampStatus = "FAILED";
        timestampTsaUrl = ts.tsaUrl;
        logger.warn({ err: ts.error, agreementId: agreement.id }, "agreement timestamp failed");
      }

      // Seal inspection + agreement. Supersede any prior SIGNED agreement for this booking.
      await ctx.prisma.$transaction(async (tx) => {
        await tx.inspection.update({
          where: { id: agreement.inspectionId },
          data: { status: "COMPLETED" },
        });
        await tx.rentalAgreement.updateMany({
          where: { bookingId: booking.id, status: "SIGNED" },
          data: { status: "SUPERSEDED", supersededAt: new Date() },
        });
        await tx.rentalAgreement.update({
          where: { id: agreement.id },
          data: {
            status: "SIGNED",
            signedAt: new Date(),
            pdfUrl: pdfUpload.url,
            pdfKey: pdfUpload.key,
            timestampTokenKey: timestampTokenKey ?? undefined,
            timestampStatus,
            timestampTsaUrl: timestampTsaUrl ?? undefined,
            timestampedAt: timestampedAt ?? undefined,
          },
        });
        // Keep legacy Booking columns in sync for any older UI paths.
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            agreedToTerms: true,
            termsVersion: agreement.termsVersion,
            signatureUrl: agreement.customerSignatureUrl,
          },
        });
        await autoCloseByTarget(tx, "RentalAgreement", agreement.id, {
          types: ["RENTAL_AGREEMENT_SIGN"],
          reason: "completed",
          closingUserId: ctx.user.id,
        });
        await autoCloseByTarget(tx, "Inspection", agreement.inspectionId, {
          types: ["INSPECTION_PRE_HIRE"],
          reason: "completed",
          closingUserId: ctx.user.id,
        });
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "AGREEMENT_SIGNED",
        entity: "RentalAgreement",
        entityId: agreement.id,
        newData: {
          bookingId: booking.id,
          version: agreement.version,
          termsVersion: agreement.termsVersion,
          timestampStatus,
        },
      });

      return { pdfUrl: pdfUpload.url, agreementId: agreement.id, timestampStatus };
    }),

  /** Fetch all agreements for a booking — staff only. */
  byBooking: staffProcedure
    .input(z.object({ bookingId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.rentalAgreement.findMany({
        where: { bookingId: input.bookingId },
        orderBy: [{ version: "desc" }],
        include: { staff: { select: { firstName: true, lastName: true } } },
      }),
    ),

  /** Customer-facing — only their own bookings. */
  forCustomer: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (ctx.user.role === "STAFF" || ctx.user.role === "MANAGER" || ctx.user.role === "ADMIN" || ctx.user.role === "SUPER_ADMIN") {
        // Staff don't use this endpoint — safer to no-op than return firm's entire list.
        return [];
      }
      return ctx.prisma.rentalAgreement.findMany({
        where: { booking: { customerId: ctx.user.id }, status: { in: ["SIGNED", "SUPERSEDED"] } },
        orderBy: { signedAt: "desc" },
        take: input?.limit ?? 25,
        include: {
          booking: { select: { bookingReference: true, pickupDateTime: true } },
        },
      });
    }),

  /** Manager + Admin: reissue a new agreement version, superseding the current SIGNED one. */
  reissue: managerProcedure
    .input(z.object({ bookingId: z.string(), reason: z.string().min(3) }))
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.prisma.rentalAgreement.findFirst({
        where: { bookingId: input.bookingId, status: "SIGNED" },
        orderBy: { version: "desc" },
      });
      if (!current) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No signed agreement to reissue" });
      }
      const latest = await ctx.prisma.rentalAgreement.findFirst({
        where: { bookingId: input.bookingId },
        orderBy: { version: "desc" },
      });
      const version = (latest?.version ?? 0) + 1;

      const preHire = await ctx.prisma.inspection.findFirst({
        where: { bookingId: input.bookingId, type: "PRE_HIRE" },
        orderBy: { dateTime: "desc" },
      });
      if (!preHire) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No pre-hire inspection found for this booking" });
      }

      const draft = await ctx.prisma.$transaction(async (tx) => {
        await tx.rentalAgreement.update({
          where: { id: current.id },
          data: { status: "SUPERSEDED", supersededAt: new Date(), supersededReason: input.reason },
        });
        const agreementNumber = await buildAgreementNumber(tx, (await tx.booking.findUniqueOrThrow({
          where: { id: input.bookingId },
          select: { bookingReference: true },
        })).bookingReference, version);
        return tx.rentalAgreement.create({
          data: {
            bookingId: input.bookingId,
            inspectionId: preHire.id,
            agreementNumber,
            version,
            termsVersion: CURRENT_TERMS.version,
            status: "DRAFT",
            contentSnapshot: (current.contentSnapshot as Prisma.InputJsonValue) ?? ({} as Prisma.InputJsonValue),
            staffId: ctx.user.id,
          },
        });
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "AGREEMENT_REISSUED",
        entity: "RentalAgreement",
        entityId: draft.id,
        newData: { bookingId: input.bookingId, version, reason: input.reason, supersededId: current.id },
      });

      return draft;
    }),
});
