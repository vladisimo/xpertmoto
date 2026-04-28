import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * G12 — Dispute evidence compilation.
 *
 * Builds the evidence packet Stripe expects when representing a chargeback.
 * Returns a structured object rather than calling Stripe directly — the
 * staff-facing admin UI (built post-P1) downloads this packet + submits
 * via the Stripe dashboard, or a future P2 job auto-submits.
 *
 * Evidence mapping (from docs/payments/runbook-dispute-response.md):
 *   - customer_signature        → Booking.signatureUrl (on rental agreement)
 *   - receipt                   → Payment.receiptUrl (Stripe-hosted) or
 *                                  Invoice.pdfUrl
 *   - service_documentation     → Rental agreement PDF / return assessment PDF
 *   - uncategorized_text        → Narrative explaining the booking flow,
 *                                  attendance, inspections, communications
 *   - customer_communication    → Summary of CommunicationLog entries
 *
 * Stripe accepts PDFs via Files API — this service returns URLs only;
 * actual upload is the caller's responsibility.
 */

export type DisputeEvidencePacket = {
  disputeId: string;
  paymentId: string;
  bookingReference: string | null;
  customerId: string | null;
  amountCents: number;
  reason: string | null;
  evidence: {
    customer_signature?: string | null;
    receipt?: string | null;
    service_documentation?: string[];
    uncategorized_text: string;
    customer_communication_summary: Array<{
      sentAt: string;
      channel: string;
      subject: string | null;
      templateUsed: string | null;
    }>;
  };
};

export async function compileEvidencePacket(args: {
  paymentId: string;
  disputeId: string;
  reason?: string | null;
  amountCents: number;
}): Promise<DisputeEvidencePacket> {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: args.paymentId },
    include: {
      booking: {
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          vehicle: { select: { internalCode: true, rego: true, make: true, model: true } },
          inspections: {
            orderBy: { dateTime: "asc" },
            select: { id: true, type: true, dateTime: true, odometerKm: true },
          },
          returnAssessments: {
            select: { id: true, status: true, pdfUrl: true, assessmentNumber: true, signedAt: true },
            orderBy: { signedAt: "desc" },
            take: 1,
          },
          rentalAgreements: { select: { pdfUrl: true, signedAt: true }, orderBy: { signedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const signatureUrl = payment.booking?.rentalAgreements?.[0]?.pdfUrl ?? null;

  const docs: string[] = [];
  if (payment.booking?.rentalAgreements?.[0]?.pdfUrl) {
    docs.push(payment.booking.rentalAgreements[0].pdfUrl);
  }
  const latestReturnAssessment = payment.booking?.returnAssessments?.[0];
  if (latestReturnAssessment?.pdfUrl) {
    docs.push(latestReturnAssessment.pdfUrl);
  }

  const commLog = await prisma.communicationLog.findMany({
    where: {
      customerId: payment.customerId ?? undefined,
      bookingId: payment.bookingId ?? undefined,
    },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: { sentAt: true, channel: true, subject: true, templateUsed: true },
  });

  const narrative = buildNarrative(payment);

  const packet: DisputeEvidencePacket = {
    disputeId: args.disputeId,
    paymentId: payment.id,
    bookingReference: payment.booking?.bookingReference ?? null,
    customerId: payment.customerId ?? null,
    amountCents: args.amountCents,
    reason: args.reason ?? null,
    evidence: {
      customer_signature: signatureUrl,
      receipt: payment.receiptUrl ?? null,
      service_documentation: docs,
      uncategorized_text: narrative,
      customer_communication_summary: commLog.map((c) => ({
        sentAt: c.sentAt.toISOString(),
        channel: c.channel,
        subject: c.subject,
        templateUsed: c.templateUsed,
      })),
    },
  };

  logger.info(
    {
      disputeId: args.disputeId,
      paymentId: args.paymentId,
      hasSignature: !!signatureUrl,
      docCount: docs.length,
      commLogCount: commLog.length,
    },
    "dispute evidence packet compiled",
  );

  return packet;
}

type PaymentForNarrative = {
  id: string;
  amount: unknown;
  reference: string;
  booking: {
    bookingReference: string;
    pickupDateTime: Date;
    returnDateTime: Date;
    vehicle: { internalCode: string; rego: string; make: string; model: string } | null;
    customer: { firstName: string; lastName: string; email: string } | null;
    inspections: Array<{ type: string; dateTime: Date; odometerKm: number }>;
  } | null;
};

function buildNarrative(payment: PaymentForNarrative): string {
  const b = payment.booking;
  if (!b) {
    return `Payment ${payment.reference} (${payment.id}) — no booking record available. Contact merchant for context.`;
  }
  const v = b.vehicle ? `${b.vehicle.make} ${b.vehicle.model} ${b.vehicle.internalCode} (rego ${b.vehicle.rego})` : "vehicle not yet allocated";
  const c = b.customer ? `${b.customer.firstName} ${b.customer.lastName} <${b.customer.email}>` : "unknown customer";
  const pre = b.inspections.find((i) => i.type === "PRE_HIRE");
  const post = b.inspections.find((i) => i.type === "POST_HIRE");
  const insp = [
    pre ? `pre-hire inspection at ${pre.dateTime.toISOString()} (odometer ${pre.odometerKm} km)` : "no pre-hire inspection on record",
    post ? `post-hire inspection at ${post.dateTime.toISOString()} (odometer ${post.odometerKm} km)` : "no post-hire inspection on record",
  ].join("; ");

  return [
    `Booking ${b.bookingReference}. Customer ${c}.`,
    `Vehicle: ${v}.`,
    `Hire period: ${b.pickupDateTime.toISOString()} to ${b.returnDateTime.toISOString()}.`,
    `Inspections: ${insp}.`,
    `Customer signed digital rental agreement at checkout; signed return assessment at return.`,
    `Disputed payment reference: ${payment.reference} (id ${payment.id}).`,
    `Evidence attached: rental agreement PDF, pre/post-hire inspection PDFs, customer communication log.`,
  ].join(" ");
}
