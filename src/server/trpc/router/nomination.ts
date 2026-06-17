import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createElement } from "react";
import { z } from "zod";

import { getBranding } from "@/lib/branding";
import { encryptSecret } from "@/lib/crypto";
import {
  computeNominationDeadline,
  defaultHandlingForType,
} from "@/lib/nsw-nomination";
import { renderStatutoryDeclarationPdf } from "@/lib/pdf/statutory-declaration";
import { getSignedUrl, uploadFile } from "@/lib/storage";
import { formatCurrency } from "@/lib/utils";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { writeAudit } from "@/server/services/audit";
import {
  applyAdminFeeOnlyCharge,
  applyInfringementRecoveryCharge,
} from "@/server/services/infringement-charge";
import {
  buildENominationsCsv,
  buildNomineeSnapshot,
  maskLicence,
  missingNomineeFields,
  nomineeAddressLine,
  nomineeFullName,
  resolveENominationsColumns,
  type NominationArtefactInput,
} from "@/server/services/nomination-artefacts";
import { sendNotification } from "@/server/services/notification-sender";

import { createTRPCRouter, managerProcedure } from "../trpc";

const HANDLING = ["NOMINATE_DRIVER", "PAY_AND_RECOVER"] as const;

/** Resolve the configured infringement admin/handling fee in AUD. */
async function resolveAdminFee(
  prisma: import("@prisma/client").PrismaClient,
): Promise<number> {
  const s = await prisma.systemSetting.findUnique({
    where: { key: "infringement.adminFee" },
  });
  return typeof s?.value === "number" ? Number(s.value) : 55;
}

function fmtDateAU(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-AU", {
    dateStyle: "medium",
  });
}

function portalUrl(bookingId: string | null): string {
  const base =
    process.env.AUTH_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  return bookingId ? `${base}/dashboard/bookings/${bookingId}` : `${base}/dashboard`;
}

/**
 * Render + send the compliant, handling-aware infringement notice to the
 * renter, and record it in CommunicationLog (via sendNotification).
 */
async function sendInfringementNotice(args: {
  prisma: import("@prisma/client").PrismaClient;
  infringement: {
    id: string;
    referenceNumber: string;
    type: string;
    issuer: string;
    offenceDate: Date;
    offenceDescription: string | null;
    offenceLocation: string | null;
    amount: Prisma.Decimal | number;
    demeritPoints: number;
    dueDate: Date | null;
    nominationDeadline: Date | null;
    bookingId: string | null;
    customerId: string;
    booking: { bookingReference: string; customer: { firstName: string | null } | null } | null;
  };
  handling: (typeof HANDLING)[number];
  adminFee: number;
  licenceMasked: string | null;
  sentById: string;
}): Promise<void> {
  const { infringement: inf, handling, adminFee } = args;
  const branding = await getBranding();
  const { default: InfringementNominatedEmail } = await import(
    "../../../../emails/infringement-nominated"
  );
  const { render: renderEmail } = await import("@react-email/render");
  const typeLabel = inf.type.replace(/_/g, " ").toLowerCase();

  const html = await renderEmail(
    createElement(InfringementNominatedEmail, {
      customerName: inf.booking?.customer?.firstName ?? "there",
      bookingReference: inf.booking?.bookingReference ?? "—",
      referenceNumber: inf.referenceNumber,
      type: typeLabel,
      issuer: inf.issuer,
      offenceDate: fmtDateAU(inf.offenceDate) ?? "",
      offenceDescription: inf.offenceDescription,
      offenceLocation: inf.offenceLocation,
      amount: formatCurrency(Number(inf.amount)),
      adminFee: adminFee > 0 ? formatCurrency(adminFee) : null,
      demeritPoints: inf.demeritPoints,
      dueDate: fmtDateAU(inf.dueDate),
      nominationDeadline: fmtDateAU(inf.nominationDeadline),
      handling,
      licenceMasked: args.licenceMasked,
      portalUrl: portalUrl(inf.bookingId),
      siteName: branding.siteName,
      supportEmail: branding.supportEmail,
    }),
  );

  await sendNotification({
    userId: inf.customerId,
    type: "INFRINGEMENT_NOMINATED",
    channels: ["EMAIL"],
    subject: `Action required: ${typeLabel} infringement ${inf.referenceNumber}`,
    title: "Infringement during your hire",
    body:
      `${inf.issuer} issued a ${typeLabel} infringement (${inf.referenceNumber}) on ` +
      `${fmtDateAU(inf.offenceDate)} during your hire. ` +
      (handling === "NOMINATE_DRIVER"
        ? `You are being nominated to ${inf.issuer} as the responsible driver; the fine` +
          `${inf.demeritPoints > 0 ? " and demerit points" : ""} will be reissued to you. `
        : `The fine has been charged to your booking. `) +
      `View details: ${portalUrl(inf.bookingId)}`,
    html,
    templateKey: "infringement-nominated",
    bookingId: inf.bookingId ?? undefined,
    data: {
      referenceNumber: inf.referenceNumber,
      handling,
      amount: Number(inf.amount),
    },
    sentById: args.sentById,
  });
}

export const nominationRouter = createTRPCRouter({
  /** Infringements matched to a booking but awaiting staff confirmation. */
  listPendingReview: managerProcedure.query(({ ctx }) =>
    ctx.prisma.infringement.findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      include: { vehicle: true, booking: { include: { customer: true } } },
      orderBy: { offenceDate: "desc" },
      take: 100,
    }),
  ),

  /** Infringements with an upcoming/overdue nomination deadline. */
  listDeadlines: managerProcedure
    .input(z.object({ withinDays: z.number().int().min(1).max(120).default(28) }).optional())
    .query(async ({ ctx, input }) => {
      const within = input?.withinDays ?? 28;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + within);
      return ctx.prisma.infringement.findMany({
        where: {
          deletedAt: null,
          nominationDeadline: { not: null, lte: cutoff },
          status: { notIn: ["PAID", "WRITTEN_OFF"] },
        },
        include: {
          vehicle: true,
          booking: { include: { customer: true } },
          submissions: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        },
        orderBy: { nominationDeadline: "asc" },
        take: 100,
      });
    }),

  /** Full detail for the nomination workspace. */
  get: managerProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.infringement.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          vehicle: true,
          booking: { include: { customer: true } },
          submissions: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        },
      }),
    ),

  /**
   * Confirm the matched renter + handling, notify them with a compliant
   * notice, and raise the appropriate charge (fine+admin for PAY_AND_RECOVER,
   * admin-only for NOMINATE_DRIVER). This is the staff-confirmed gate — the
   * matcher never auto-nominates because a false nomination is a criminal
   * offence.
   */
  allocate: managerProcedure
    .input(
      z.object({
        infringementId: z.string(),
        customerId: z.string().optional(),
        handling: z.enum(HANDLING).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inf = await ctx.prisma.infringement.findUniqueOrThrow({
        where: { id: input.infringementId },
        include: {
          booking: { include: { customer: { select: { firstName: true } } } },
          vehicle: { select: { rego: true } },
        },
      });

      const customerId = input.customerId ?? inf.customerId ?? inf.booking?.customerId ?? null;
      if (!customerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No renter to nominate — link a booking or pass customerId.",
        });
      }
      const handling = input.handling ?? inf.handling ?? defaultHandlingForType(inf.type);
      const adminFee = await resolveAdminFee(ctx.prisma);

      await ctx.prisma.infringement.update({
        where: { id: inf.id },
        data: {
          customerId,
          handling,
          adminFee: new Prisma.Decimal(adminFee.toFixed(2)),
          nominatedAt: new Date(),
          customerNotifiedAt: new Date(),
          status: "NOMINATED",
        },
      });

      // Raise the renter charge per handling model. Idempotent on INFR-<ref>.
      const chargeInput = {
        id: inf.id,
        referenceNumber: inf.referenceNumber,
        type: inf.type,
        issuer: inf.issuer,
        adminFee,
        bookingId: inf.bookingId,
        customerId,
      };
      if (handling === "PAY_AND_RECOVER") {
        await applyInfringementRecoveryCharge({
          prisma: ctx.prisma,
          infringement: { ...chargeInput, amount: Number(inf.amount) },
          performedById: ctx.user.id,
        });
      } else {
        await applyAdminFeeOnlyCharge({
          prisma: ctx.prisma,
          infringement: chargeInput,
          performedById: ctx.user.id,
        });
      }

      const updated = await ctx.prisma.infringement.update({
        where: { id: inf.id },
        data: { status: "CUSTOMER_CHARGED" },
      });

      // Mask the licence we hold so the customer can flag an error.
      const nominee = await buildNomineeSnapshot(ctx.prisma, customerId);
      await sendInfringementNotice({
        prisma: ctx.prisma,
        infringement: {
          ...inf,
          customerId,
          booking: inf.booking
            ? {
                bookingReference: inf.booking.bookingReference,
                customer: inf.booking.customer,
              }
            : null,
        },
        handling,
        adminFee,
        licenceMasked: nominee ? maskLicence(nominee) : null,
        sentById: ctx.user.id,
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "Infringement.allocate",
        entity: "Infringement",
        entityId: inf.id,
        newData: { customerId, handling, adminFee, referenceNumber: inf.referenceNumber },
      });
      await trackServer({
        event: SERVER_EVENTS.infringementNominated,
        distinctId: customerId,
        properties: {
          infringementId: inf.id,
          referenceNumber: inf.referenceNumber,
          type: inf.type,
          handling,
          amountAud: Number(inf.amount),
          actorUserId: ctx.user.id,
        },
      });

      return updated;
    }),

  /**
   * Generate the official nomination artefacts (eNominations CSV + statutory
   * declaration PDF) for staff to submit/mail. Blocks when mandatory nominee
   * fields are missing. Stores both as an immutable NominationSubmission with
   * a frozen, encrypted nominee snapshot.
   */
  draftSubmission: managerProcedure
    .input(
      z.object({
        infringementId: z.string(),
        channel: z.enum(["ENOMINATIONS_CSV", "STAT_DEC_MAIL", "MYPENALTY_WEB"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inf = await ctx.prisma.infringement.findUniqueOrThrow({
        where: { id: input.infringementId },
        include: { vehicle: { select: { rego: true } } },
      });
      if (!inf.customerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Allocate a renter to this infringement before drafting a nomination.",
        });
      }
      const nominee = await buildNomineeSnapshot(ctx.prisma, inf.customerId);
      if (!nominee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Renter not found." });
      }
      const missing = missingNomineeFields(nominee);
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot nominate — missing required driver details: ${missing.join(", ")}.`,
        });
      }

      const artefact: NominationArtefactInput = {
        penaltyNoticeNumber: inf.referenceNumber,
        offenceDate: inf.offenceDate,
        offenceCode: inf.offenceCode,
        offenceDescription: inf.offenceDescription,
        offenceLocation: inf.offenceLocation,
        issuer: inf.issuer,
        vehicleRego: inf.vehicle.rego,
        nominee,
      };

      const colSetting = await ctx.prisma.systemSetting.findUnique({
        where: { key: "nomination.enominationsColumns" },
      });
      const csv = buildENominationsCsv([artefact], resolveENominationsColumns(colSetting?.value));
      const pdf = await renderStatutoryDeclarationPdf(artefact);

      const folder = `nominations/${inf.id}`;
      const csvUp = await uploadFile({
        folder,
        filename: `enominations-${inf.referenceNumber}.csv`,
        contentType: "text/csv",
        body: Buffer.from(csv, "utf8"),
      });
      const pdfUp = await uploadFile({
        folder,
        filename: `statdec-${inf.referenceNumber}.pdf`,
        contentType: "application/pdf",
        body: pdf,
      });

      const submission = await ctx.prisma.nominationSubmission.create({
        data: {
          infringementId: inf.id,
          channel: input.channel,
          status: "DRAFTED",
          driverFullName: nomineeFullName(nominee),
          driverDob: nominee.dob,
          driverAddress: nomineeAddressLine(nominee),
          driverLicenceState: nominee.licenceState ?? nominee.licenceCountry,
          driverLicenceNumberEnc: nominee.licenceNumber
            ? (encryptSecret(nominee.licenceNumber) as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          csvFileKey: csvUp.key,
          statDecPdfKey: pdfUp.key,
          createdById: ctx.user.id,
        },
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "NominationSubmission.draft",
        entity: "NominationSubmission",
        entityId: submission.id,
        newData: {
          infringementId: inf.id,
          channel: input.channel,
          referenceNumber: inf.referenceNumber,
        },
      });

      return {
        submission,
        csvUrl: await getSignedUrl(csvUp.key),
        pdfUrl: await getSignedUrl(pdfUp.key),
      };
    }),

  /** Fresh signed URLs for a submission's artefacts + receipt. */
  submissionArtefacts: managerProcedure
    .input(z.object({ submissionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sub = await ctx.prisma.nominationSubmission.findUniqueOrThrow({
        where: { id: input.submissionId },
        select: { csvFileKey: true, statDecPdfKey: true, receiptFileKey: true },
      });
      return {
        csvUrl: sub.csvFileKey ? await getSignedUrl(sub.csvFileKey) : null,
        pdfUrl: sub.statDecPdfKey ? await getSignedUrl(sub.statDecPdfKey) : null,
        receiptUrl: sub.receiptFileKey ? await getSignedUrl(sub.receiptFileKey) : null,
      };
    }),

  /** Record that a draft was submitted to Revenue NSW (uploaded / mailed). */
  recordSubmission: managerProcedure
    .input(
      z.object({
        submissionId: z.string(),
        receiptReference: z.string().optional(),
        receiptFileKey: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.nominationSubmission.findUniqueOrThrow({
        where: { id: input.submissionId },
      });
      if (sub.status !== "DRAFTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Submission is already ${sub.status.toLowerCase()}.`,
        });
      }
      const updated = await ctx.prisma.nominationSubmission.update({
        where: { id: sub.id },
        data: {
          status: "SUBMITTED",
          submittedById: ctx.user.id,
          submittedAt: new Date(),
          receiptReference: input.receiptReference ?? null,
          receiptFileKey: input.receiptFileKey ?? null,
        },
      });
      await ctx.prisma.infringement.update({
        where: { id: sub.infringementId },
        data: { status: "NOMINATION_SUBMITTED" },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "NominationSubmission.submit",
        entity: "NominationSubmission",
        entityId: sub.id,
        newData: { receiptReference: input.receiptReference ?? null },
      });
      return updated;
    }),

  /** Record Revenue NSW's outcome (accepted / rejected). */
  recordOutcome: managerProcedure
    .input(
      z.object({
        submissionId: z.string(),
        status: z.enum(["ACCEPTED", "REJECTED"]),
        rejectionReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.nominationSubmission.findUniqueOrThrow({
        where: { id: input.submissionId },
      });
      if (sub.status !== "SUBMITTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only submitted nominations can record an outcome.",
        });
      }
      const updated = await ctx.prisma.nominationSubmission.update({
        where: { id: sub.id },
        data: {
          status: input.status,
          rejectionReason: input.status === "REJECTED" ? input.rejectionReason ?? null : null,
        },
      });
      // A rejected nomination returns the infringement to the review queue so
      // staff can correct details and re-draft before the deadline.
      if (input.status === "REJECTED") {
        await ctx.prisma.infringement.update({
          where: { id: sub.infringementId },
          data: { status: "PENDING_REVIEW" },
        });
      }
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "NominationSubmission.outcome",
        entity: "NominationSubmission",
        entityId: sub.id,
        newData: { status: input.status, rejectionReason: input.rejectionReason ?? null },
      });
      return updated;
    }),
});

/** Exposed for unit tests + the deadline job. */
export const _nominationInternal = { computeNominationDeadline };
