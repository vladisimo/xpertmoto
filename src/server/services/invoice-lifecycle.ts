import { Prisma, type AdjustmentReason } from "@prisma/client";

import { logger } from "@/lib/logger";
import { aud, gstFromInclusive, roundCents, subtotalExGst } from "@/lib/money";
import { renderAdjustmentNotePdf } from "@/lib/pdf/adjustment-note";
import type { PdfLineItem } from "@/lib/pdf/components/line-items-table";
import { renderReceiptPdf } from "@/lib/pdf/receipt";
import { renderTaxInvoicePdf } from "@/lib/pdf/tax-invoice";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { getInvoicingConfig } from "@/lib/invoicing-config";
import {
  AdjustmentNoteLineItemsSchema,
  InvoiceLineItemsSchema,
  PricingSnapshotSchema,
  type AdjustmentNoteLineItem,
  type InvoiceLineItem,
} from "@/lib/validators/json-fields";

import { nextDocumentNumber } from "./document-numbering";

/**
 * Issuance pipeline for tax documents (Invoice, AdjustmentNote, Receipt).
 *
 * Each issuer follows the same five-step pattern:
 *
 *   1. Allocate the FY-scoped sequential number atomically inside the
 *      issuance transaction (see `document-numbering.ts`).
 *   2. Insert the row.
 *   3. Commit the transaction.
 *   4. Render the PDF (uses `getBranding()` + `getInvoicingConfig()`).
 *   5. Upload to S3/MinIO and store the URL on the row.
 *
 * Steps 4–5 are best-effort — if they fail the row stays without a PDF
 * URL and the next call to the retroactive sweep can retry. The DB row
 * is the source of truth; the PDF is a denormalisation.
 */

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve the live (non-void, non-deleted) tax invoice for a booking.
 * Returns null if the booking pre-dates the auto-issuance change. Call
 * sites use this to decide whether to issue an adjustment note now or
 * leave the work to the retroactive sweep job.
 */
export async function findActiveInvoiceForBooking(
  bookingId: string,
): Promise<{ id: string; invoiceNumber: string } | null> {
  return prisma.invoice.findFirst({
    where: { bookingId, deletedAt: null, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, invoiceNumber: true },
  });
}

/**
 * Best-effort wrapper around `issueAdjustmentNote` for use from
 * transactional event handlers. If anything goes wrong (no invoice yet,
 * render fails, upload fails) the failure is swallowed and logged so
 * the calling event handler doesn't roll back the underlying state
 * change. The retroactive sweep picks up missed cases.
 */
export async function tryIssueAdjustmentForBooking(args: {
  bookingId: string;
  type: "INCREASE" | "DECREASE";
  reason: AdjustmentReason;
  description: string;
  lineItems: AdjustmentNoteLineItem[];
  paymentId?: string | null;
  issuedById?: string | null;
}): Promise<void> {
  try {
    const invoice = await findActiveInvoiceForBooking(args.bookingId);
    if (!invoice) {
      logger.info(
        { bookingId: args.bookingId, reason: args.reason },
        "tryIssueAdjustmentForBooking: no active invoice — skipping (retroactive sweep will retry)",
      );
      return;
    }
    await issueAdjustmentNote({
      invoiceId: invoice.id,
      type: args.type,
      reason: args.reason,
      description: args.description,
      lineItems: args.lineItems,
      paymentId: args.paymentId,
      issuedById: args.issuedById,
    });
  } catch (err) {
    logger.warn(
      { err, bookingId: args.bookingId, reason: args.reason },
      "tryIssueAdjustmentForBooking: failed; non-blocking",
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Tax invoice on booking confirmation
// ───────────────────────────────────────────────────────────────────────────

interface IssueInvoiceForBookingArgs {
  bookingId: string;
  /** Override the issue date (default: now). Used for backfill scripts. */
  issuedAt?: Date;
}

export async function issueInvoiceForBooking({
  bookingId,
  issuedAt,
}: IssueInvoiceForBookingArgs) {
  const issued = issuedAt ?? new Date();

  // Load the booking with everything we need for the PDF in one trip.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { include: { customerProfile: true } },
      category: true,
      pickupDepot: true,
      returnDepot: true,
      addons: { include: { addon: true } },
      insurance: { include: { insuranceOption: true } },
    },
  });
  if (!booking) {
    throw new Error(`issueInvoiceForBooking: booking ${bookingId} not found`);
  }

  // Idempotency: a SENT/PAID invoice may already exist for this booking.
  const existing = await prisma.invoice.findFirst({
    where: { bookingId, deletedAt: null, status: { not: "VOID" } },
  });
  if (existing) {
    return existing;
  }

  const cfg = await getInvoicingConfig();
  const lineItems = buildBookingLineItems(booking);

  // Insert the invoice row + allocate number atomically.
  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber({ tx, type: "INVOICE", issuedAt: issued });
    const subtotal = subtotalExGst(booking.totalAmount);
    const gst = gstFromInclusive(booking.totalAmount);
    const dueDate =
      cfg.invoiceTermsDays > 0
        ? new Date(issued.getTime() + cfg.invoiceTermsDays * 86_400_000)
        : null;

    return tx.invoice.create({
      data: {
        invoiceNumber,
        bookingId: booking.id,
        customerId: booking.customerId,
        lineItems: InvoiceLineItemsSchema.parse(lineItems) as unknown as Prisma.InputJsonValue,
        subtotal,
        gstAmount: gst,
        totalAmount: booking.totalAmount,
        status: "SENT",
        dueDate,
        issuedAt: issued,
        sentAt: issued,
      },
    });
  });

  // Best-effort PDF render + upload.
  await renderAndPersistInvoicePdf(invoice.id).catch((err) => {
    logger.warn(
      { err, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
      "issueInvoiceForBooking: render/upload failed; row kept",
    );
  });

  return invoice;
}

/**
 * Render and persist the PDF for a previously-created Invoice. Split out
 * so retry sweeps and admin "regenerate" buttons can reuse the
 * pipeline without recreating the row.
 */
export async function renderAndPersistInvoicePdf(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      booking: {
        include: {
          customer: { include: { customerProfile: true } },
          category: true,
          pickupDepot: true,
          returnDepot: true,
        },
      },
    },
  });
  if (!invoice || !invoice.booking) {
    throw new Error(`renderAndPersistInvoicePdf: ${invoiceId} not found or has no booking`);
  }
  const booking = invoice.booking;
  const customer = booking.customer;
  const cp = customer.customerProfile;

  const parsedLines = InvoiceLineItemsSchema.parse(invoice.lineItems);
  const pdfLines = parsedLines.map(toPdfLineItem);

  const buf = await renderTaxInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt ?? invoice.createdAt,
    dueDate: invoice.dueDate,
    bookingReference: booking.bookingReference,
    customer: {
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone,
      companyName: cp?.companyName ?? null,
      abn: cp?.abn ?? null,
      addressLine1: cp?.addressLine1 ?? null,
      addressLine2: cp?.addressLine2 ?? null,
      suburb: cp?.suburb ?? null,
      state: cp?.state ?? null,
      postcode: cp?.postcode ?? null,
      country: cp?.country ?? null,
    },
    lineItems: pdfLines,
    subtotal: Number(invoice.subtotal),
    gstAmount: Number(invoice.gstAmount),
    totalAmount: Number(invoice.totalAmount),
    amountPaid: Number(booking.amountPaid),
    bondAmount: Number(booking.bondAmount),
  });

  const upload = await uploadFile({
    folder: `invoices/${booking.id}`,
    filename: `${invoice.invoiceNumber}.pdf`,
    contentType: "application/pdf",
    body: buf,
  });
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { pdfUrl: upload.url, pdfKey: upload.key },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Adjustment note for any post-issuance change
// ───────────────────────────────────────────────────────────────────────────

interface IssueAdjustmentNoteArgs {
  /** The original tax invoice the change relates to. */
  invoiceId: string;
  type: "INCREASE" | "DECREASE";
  reason: AdjustmentReason;
  description: string;
  /** Always positive amounts; `type` controls direction. */
  lineItems: AdjustmentNoteLineItem[];
  /** Optional Payment row that captured / refunded the delta. */
  paymentId?: string | null;
  issuedById?: string | null;
  issuedAt?: Date;
}

export async function issueAdjustmentNote(args: IssueAdjustmentNoteArgs) {
  const issued = args.issuedAt ?? new Date();

  // Refuse to issue against a voided invoice — that's almost always a bug.
  const invoice = await prisma.invoice.findUnique({
    where: { id: args.invoiceId },
    select: { id: true, bookingId: true, customerId: true, status: true },
  });
  if (!invoice) {
    throw new Error(`issueAdjustmentNote: invoice ${args.invoiceId} not found`);
  }
  if (invoice.status === "VOID") {
    throw new Error(`issueAdjustmentNote: invoice ${args.invoiceId} is VOID`);
  }

  const lines = AdjustmentNoteLineItemsSchema.parse(args.lineItems);
  const subtotalDec = lines.reduce<Prisma.Decimal>(
    (acc, l) => acc.add(subtotalExGst(l.totalPrice)),
    aud(0),
  );
  const gstDec = lines.reduce<Prisma.Decimal>(
    (acc, l) =>
      acc.add(l.gstAmount != null ? aud(l.gstAmount) : gstFromInclusive(l.totalPrice)),
    aud(0),
  );
  const totalDec = lines.reduce<Prisma.Decimal>(
    (acc, l) => acc.add(aud(l.totalPrice)),
    aud(0),
  );

  const note = await prisma.$transaction(async (tx) => {
    const adjustmentNumber = await nextDocumentNumber({
      tx,
      type: "ADJUSTMENT_NOTE",
      issuedAt: issued,
    });
    return tx.adjustmentNote.create({
      data: {
        adjustmentNumber,
        invoiceId: args.invoiceId,
        bookingId: invoice.bookingId,
        customerId: invoice.customerId,
        type: args.type,
        reason: args.reason,
        description: args.description,
        lineItems: lines as unknown as Prisma.InputJsonValue,
        subtotal: roundCents(subtotalDec),
        gstAmount: roundCents(gstDec),
        totalAmount: roundCents(totalDec),
        status: "ISSUED",
        issuedAt: issued,
        issuedById: args.issuedById ?? null,
        paymentId: args.paymentId ?? null,
      },
    });
  });

  await renderAndPersistAdjustmentNotePdf(note.id).catch((err) => {
    logger.warn(
      { err, adjustmentNoteId: note.id, adjustmentNumber: note.adjustmentNumber },
      "issueAdjustmentNote: render/upload failed; row kept",
    );
  });

  // Customer notification with the GST-compliant PDF attached. Best-effort
  // — the PDF row is the source of truth, the email is a courtesy copy.
  // Skipped when the note isn't linked to a customer (e.g. anonymous /
  // partner-attributed legacy rows).
  if (invoice.customerId && invoice.bookingId) {
    try {
      await emailAdjustmentNoteToCustomer(note.id);
    } catch (err) {
      logger.warn(
        { err, adjustmentNoteId: note.id },
        "issueAdjustmentNote: customer email failed; non-blocking",
      );
    }
  }

  return note;
}

async function emailAdjustmentNoteToCustomer(adjustmentNoteId: string): Promise<void> {
  const note = await prisma.adjustmentNote.findUnique({
    where: { id: adjustmentNoteId },
    include: {
      invoice: { select: { invoiceNumber: true } },
      booking: { select: { bookingReference: true } },
      customer: { select: { id: true, firstName: true } },
    },
  });
  if (!note?.customer || !note.bookingId) return;

  const { sendNotification } = await import("./notification-sender");
  const { default: AdjustmentNoteIssuedEmail } = await import(
    "../../../emails/adjustment-note-issued"
  );
  const { render: renderEmail } = await import("@react-email/render");
  const { createElement } = await import("react");
  const { formatCurrency } = await import("@/lib/utils");

  const direction = note.type === "DECREASE" ? "credit" : "debit";
  const totalLabel = formatCurrency(Number(note.totalAmount));
  const html = await renderEmail(
    createElement(AdjustmentNoteIssuedEmail, {
      customerName: note.customer.firstName ?? "there",
      adjustmentNumber: note.adjustmentNumber,
      direction,
      reason: note.reason,
      totalAmount: totalLabel,
      bookingReference: note.booking?.bookingReference ?? null,
      originalInvoiceNumber: note.invoice.invoiceNumber,
      description: note.description,
    }),
  );

  await sendNotification({
    userId: note.customer.id,
    type: "ADJUSTMENT_NOTE_ISSUED",
    channels: ["EMAIL"],
    subject: `${direction === "credit" ? "Credit issued" : "Adjustment to booking"} — ${
      note.booking?.bookingReference ?? note.adjustmentNumber
    }`,
    title: direction === "credit" ? "Credit issued" : "Booking adjustment",
    body: `${
      direction === "credit" ? "A credit" : "An adjustment"
    } of ${totalLabel} has been issued against ${
      note.booking?.bookingReference
        ? `booking ${note.booking.bookingReference}`
        : `invoice ${note.invoice.invoiceNumber}`
    }. ${note.description} The full GST-compliant adjustment note (${
      note.adjustmentNumber
    }) is attached.`,
    html,
    templateKey: "adjustment-note-issued",
    bookingId: note.bookingId,
    attachments: [{ kind: "adjustment-note", adjustmentNoteId: note.id }],
    dedupKey: `adjustment-note:${note.id}`,
    sentById: note.issuedById ?? undefined,
  });
}

export async function renderAndPersistAdjustmentNotePdf(adjustmentNoteId: string): Promise<void> {
  const note = await prisma.adjustmentNote.findUnique({
    where: { id: adjustmentNoteId },
    include: {
      invoice: { select: { invoiceNumber: true, issuedAt: true, createdAt: true } },
      booking: { select: { bookingReference: true } },
      customer: { include: { customerProfile: true } },
    },
  });
  if (!note || !note.customer) {
    throw new Error(`renderAndPersistAdjustmentNotePdf: ${adjustmentNoteId} missing relations`);
  }
  const cp = note.customer.customerProfile;
  const lines = AdjustmentNoteLineItemsSchema.parse(note.lineItems);

  const buf = await renderAdjustmentNotePdf({
    adjustmentNumber: note.adjustmentNumber,
    issuedAt: note.issuedAt,
    type: note.type as "INCREASE" | "DECREASE",
    description: note.description,
    originalInvoiceNumber: note.invoice.invoiceNumber,
    originalIssuedAt: note.invoice.issuedAt ?? note.invoice.createdAt,
    bookingReference: note.booking?.bookingReference ?? "—",
    customer: {
      name: `${note.customer.firstName} ${note.customer.lastName}`,
      email: note.customer.email,
      phone: note.customer.phone,
      companyName: cp?.companyName ?? null,
      abn: cp?.abn ?? null,
      addressLine1: cp?.addressLine1 ?? null,
      addressLine2: cp?.addressLine2 ?? null,
      suburb: cp?.suburb ?? null,
      state: cp?.state ?? null,
      postcode: cp?.postcode ?? null,
      country: cp?.country ?? null,
    },
    lineItems: lines.map((l) => ({
      ...toPdfLineItem(l),
      negative: note.type === "DECREASE",
    })),
    subtotal: Number(note.subtotal),
    gstAmount: Number(note.gstAmount),
    totalAmount: Number(note.totalAmount),
  });

  const upload = await uploadFile({
    folder: `adjustment-notes/${note.bookingId ?? "no-booking"}`,
    filename: `${note.adjustmentNumber}.pdf`,
    contentType: "application/pdf",
    body: buf,
  });
  await prisma.adjustmentNote.update({
    where: { id: note.id },
    data: { pdfUrl: upload.url, pdfKey: upload.key },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Branded payment receipts
// ───────────────────────────────────────────────────────────────────────────

interface IssueReceiptArgs {
  paymentId: string;
  issuedAt?: Date;
}

export async function issueReceiptForPayment({ paymentId, issuedAt }: IssueReceiptArgs) {
  const issued = issuedAt ?? new Date();

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, receiptNumber: true },
  });
  if (!payment) throw new Error(`issueReceiptForPayment: ${paymentId} not found`);
  if (payment.status !== "SUCCEEDED") {
    throw new Error(`issueReceiptForPayment: ${paymentId} status=${payment.status}, not SUCCEEDED`);
  }
  if (payment.receiptNumber) {
    // Already has a number; just (re)render the PDF.
    await renderAndPersistReceiptPdf(paymentId);
    return prisma.payment.findUnique({ where: { id: paymentId } });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextDocumentNumber({
      tx,
      type: "RECEIPT",
      issuedAt: issued,
    });
    return tx.payment.update({
      where: { id: paymentId },
      data: { receiptNumber },
    });
  });

  await renderAndPersistReceiptPdf(paymentId).catch((err) => {
    logger.warn(
      { err, paymentId, receiptNumber: updated.receiptNumber },
      "issueReceiptForPayment: render/upload failed; receiptNumber kept",
    );
  });

  return updated;
}

export async function renderAndPersistReceiptPdf(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      customer: { include: { customerProfile: true } },
      booking: { select: { bookingReference: true } },
    },
  });
  if (!payment || !payment.customer || !payment.receiptNumber) {
    throw new Error(`renderAndPersistReceiptPdf: ${paymentId} missing required fields`);
  }
  const cp = payment.customer.customerProfile;

  const isRefund = payment.type === "REFUND" || payment.type === "MANUAL_CREDIT";

  const buf = await renderReceiptPdf({
    receiptNumber: payment.receiptNumber,
    paidAt: payment.processedAt ?? payment.createdAt,
    paymentLabel: paymentTypeLabel(payment.type),
    isRefund,
    amount: Math.abs(Number(payment.amount)),
    gstAmount: Math.abs(Number(payment.gstAmount)),
    methodLabel: paymentMethodLabel(payment.method, null),
    paymentReference: payment.stripeChargeId ?? payment.stripePaymentIntentId ?? null,
    bookingReference: payment.booking?.bookingReference ?? null,
    relatedDocumentNumber: null,
    customer: {
      name: `${payment.customer.firstName} ${payment.customer.lastName}`,
      email: payment.customer.email,
      phone: payment.customer.phone,
      companyName: cp?.companyName ?? null,
      abn: cp?.abn ?? null,
      addressLine1: cp?.addressLine1 ?? null,
      addressLine2: cp?.addressLine2 ?? null,
      suburb: cp?.suburb ?? null,
      state: cp?.state ?? null,
      postcode: cp?.postcode ?? null,
      country: cp?.country ?? null,
    },
    note: payment.notes,
  });

  const upload = await uploadFile({
    folder: `receipts/${payment.bookingId ?? "no-booking"}`,
    filename: `${payment.receiptNumber}.pdf`,
    contentType: "application/pdf",
    body: buf,
  });
  await prisma.payment.update({
    where: { id: payment.id },
    data: { receiptPdfUrl: upload.url, receiptPdfKey: upload.key },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Voiding an invoice
// ───────────────────────────────────────────────────────────────────────────

export async function voidInvoice(args: {
  invoiceId: string;
  reason: string;
  voidedById?: string;
}) {
  const invoice = await prisma.invoice.findUnique({ where: { id: args.invoiceId } });
  if (!invoice) throw new Error(`voidInvoice: ${args.invoiceId} not found`);
  if (invoice.status === "VOID") return invoice;

  // Issue a full-amount DECREASE adjustment note for the audit trail.
  await issueAdjustmentNote({
    invoiceId: invoice.id,
    type: "DECREASE",
    reason: "MANUAL",
    description: `Invoice voided: ${args.reason}`,
    lineItems: [
      {
        description: `Void of tax invoice ${invoice.invoiceNumber}`,
        quantity: 1,
        unitPrice: Number(invoice.totalAmount),
        totalPrice: Number(invoice.totalAmount),
        gstIncluded: true,
        negative: true,
      },
    ],
    issuedById: args.voidedById,
  });

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "VOID" },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Booking → line items
// ───────────────────────────────────────────────────────────────────────────

type BookingForInvoice = {
  pickupDateTime: Date;
  returnDateTime: Date;
  durationDays: number;
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  insuranceTotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  pricingSnapshot: Prisma.JsonValue;
  category: { name: string };
  pickupDepot: { name: string };
  returnDepot: { name: string };
  addons: { quantity: number; totalPrice: Prisma.Decimal; addon: { name: string } }[];
  insurance: { totalPrice: Prisma.Decimal; insuranceOption: { name: string } }[];
};

function buildBookingLineItems(booking: BookingForInvoice): InvoiceLineItem[] {
  const lines: InvoiceLineItem[] = [];
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);

  // Use the snapshot's BASE amount when available — it accounts for season
  // / yield multipliers and code discounts. Otherwise fall back to the
  // booking row's (post-discount) subtotal.
  const snap = parseSnapshot(booking.pricingSnapshot);

  const baseAmount = snap?.baseSubtotal ?? Number(booking.subtotal);
  lines.push({
    description: `${booking.category.name} hire — ${booking.durationDays} day${booking.durationDays === 1 ? "" : "s"}`,
    detail: `${fmt(booking.pickupDateTime)} → ${fmt(booking.returnDateTime)}\nPickup ${booking.pickupDepot.name} → return ${booking.returnDepot.name}`,
    quantity: booking.durationDays,
    unitPrice: booking.durationDays > 0 ? baseAmount / booking.durationDays : baseAmount,
    totalPrice: baseAmount,
    gstIncluded: true,
  });

  for (const a of booking.addons) {
    lines.push({
      description: a.addon.name,
      quantity: a.quantity,
      unitPrice: a.quantity > 0 ? Number(a.totalPrice) / a.quantity : Number(a.totalPrice),
      totalPrice: Number(a.totalPrice),
      gstIncluded: true,
    });
  }

  for (const i of booking.insurance) {
    lines.push({
      description: `Insurance — ${i.insuranceOption.name}`,
      quantity: 1,
      unitPrice: Number(i.totalPrice),
      totalPrice: Number(i.totalPrice),
      gstIncluded: true,
    });
  }

  if (Number(booking.deliveryFee) > 0) {
    lines.push({
      description: "Delivery / pickup fee",
      quantity: 1,
      unitPrice: Number(booking.deliveryFee),
      totalPrice: Number(booking.deliveryFee),
      gstIncluded: true,
    });
  }

  if (Number(booking.discountAmount) > 0) {
    lines.push({
      description: "Discount",
      quantity: 1,
      unitPrice: Number(booking.discountAmount),
      totalPrice: Number(booking.discountAmount),
      gstIncluded: true,
      negative: true,
    });
  }

  return lines;
}

function parseSnapshot(value: Prisma.JsonValue) {
  try {
    return PricingSnapshotSchema.parse(value);
  } catch {
    return null;
  }
}

function toPdfLineItem(li: InvoiceLineItem): PdfLineItem {
  return {
    description: li.description,
    detail: li.detail ?? null,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    totalPrice: li.totalPrice,
    gstAmount: li.gstAmount,
    negative: li.negative,
  };
}

function paymentTypeLabel(type: string): string {
  switch (type) {
    case "BOOKING_PAYMENT":
      return "Booking payment";
    case "BOND_HOLD":
      return "Security bond hold";
    case "BOND_CAPTURE":
      return "Bond capture";
    case "BOND_RELEASE":
      return "Bond released";
    case "REFUND":
      return "Refund";
    case "DAMAGE_CHARGE":
      return "Damage charge";
    case "LATE_FEE":
      return "Late return fee";
    case "FUEL_CHARGE":
      return "Fuel shortfall";
    case "ADDON_CHARGE":
      return "Addon charge";
    case "EXTENSION":
      return "Booking extension";
    case "INFRINGEMENT_RECOVERY":
      return "Infringement recovery";
    case "MANUAL_CHARGE":
      return "Manual charge";
    case "MANUAL_CREDIT":
      return "Manual credit";
    case "CLEANING_FEE":
      return "Cleaning fee";
    case "ZONE_SURCHARGE":
      return "Zone surcharge";
    case "FUEL_DELIVERY_FEE":
      return "Fuel delivery";
    case "SWAP_ADJUSTMENT":
      return "Vehicle swap adjustment";
    case "GIFT_CARD_PURCHASE":
      return "Gift card purchase";
    case "GIFT_CARD_REDEMPTION":
      return "Gift card redemption";
    case "SUBSCRIPTION_CHARGE":
      return "Subscription charge";
    case "PARTNER_COMMISSION_PAYOUT":
      return "Partner commission payout";
    default:
      return type;
  }
}

function paymentMethodLabel(method: string, brandLast4: string | null): string {
  if (method === "CARD" && brandLast4) return `Card ${brandLast4}`;
  if (method === "CARD") return "Card";
  if (method === "STRIPE") return "Card (Stripe)";
  if (method === "CASH") return "Cash";
  if (method === "BANK_TRANSFER") return "Bank transfer";
  return method;
}
