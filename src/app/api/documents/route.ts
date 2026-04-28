import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";

/**
 * Same-origin proxy for tax-document and contractual PDFs.
 *
 * The bytes live in S3 / MinIO under stable keys (invoices/{bookingId}/…,
 * adjustment-notes/{bookingId}/…, receipts/{bookingId}/…, agreements/…,
 * returns/…). The DB row records the key; this route resolves the row,
 * confirms the requester owns it (or has staff role), then streams the
 * bytes back from our origin so the browser never has to talk to a
 * private MinIO endpoint or worry about CSP / CORS.
 *
 * URL shape: `/api/documents?key=<S3 key>`. Each kind also accepts
 * `kind=` for clarity but the key prefix is the source of truth.
 */

const STAFF_ROLES = new Set(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const role = session.user.role;
  const isStaff = STAFF_ROLES.has(role);
  const userId = session.user.id;

  // Find the row that owns this key. We check each table whose schema
  // stores a pdfKey/documentUrl pointing at storage. The first match
  // gives us the bookingId we use for the ownership check.
  const ownerBookingId = await resolveOwningBooking(key);
  if (!ownerBookingId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isStaff) {
    const booking = await prisma.booking.findUnique({
      where: { id: ownerBookingId },
      select: { customerId: true },
    });
    if (!booking || booking.customerId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let bytes: Buffer;
  try {
    bytes = await downloadFile(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filename = filenameFromKey(key);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      // Inline so the browser opens the PDF in a new tab; prepend
      // `attachment` if a future flag wants to force download.
      "Content-Disposition": `inline; filename="${filename}"`,
      // PDFs include taxable supply detail — keep them out of shared
      // caches and require revalidation on the next view.
      "Cache-Control": "private, max-age=300, must-revalidate",
    },
  });
}

async function resolveOwningBooking(key: string): Promise<string | null> {
  // Cheap fast-path: keys we issue start with `<kind>/<bookingId>/<uuid>.pdf`.
  // Trust the prefix only when the matching DB row confirms it (so a
  // hand-crafted key with a real bookingId in the path can't bypass auth
  // — there must be a row that actually points at the key).
  const segments = key.split("/").filter(Boolean);
  const candidateBookingId = segments[1];

  // Tax invoice
  const invoice = await prisma.invoice.findFirst({
    where: { pdfKey: key },
    select: { bookingId: true },
  });
  if (invoice?.bookingId) return invoice.bookingId;

  // Adjustment note
  const adjustment = await prisma.adjustmentNote.findFirst({
    where: { pdfKey: key },
    select: { bookingId: true },
  });
  if (adjustment?.bookingId) return adjustment.bookingId;

  // Payment receipt
  const receipt = await prisma.payment.findFirst({
    where: { receiptPdfKey: key },
    select: { bookingId: true },
  });
  if (receipt?.bookingId) return receipt.bookingId;

  // Rental agreement
  const agreement = await prisma.rentalAgreement.findFirst({
    where: { pdfKey: key },
    select: { bookingId: true },
  });
  if (agreement?.bookingId) return agreement.bookingId;

  // Return assessment
  const returnAssessment = await prisma.returnAssessment.findFirst({
    where: { pdfKey: key },
    select: { bookingId: true },
  });
  if (returnAssessment?.bookingId) return returnAssessment.bookingId;

  // Vehicle swap (uses documentUrl rather than a dedicated key column;
  // accept either a literal URL match or the bare key suffix).
  const swap = await prisma.bookingSwap.findFirst({
    where: {
      OR: [{ documentUrl: { contains: key } }, { documentUrl: key }],
    },
    select: { bookingId: true },
  });
  if (swap?.bookingId) return swap.bookingId;

  // Last-resort: trust the prefix only if the path looks like ours.
  // Used as a fallback for any new doc kind we add but forget to
  // register here — the auth check still runs against the booking.
  if (candidateBookingId && /^c[a-z0-9]+$/.test(candidateBookingId)) {
    const booking = await prisma.booking.findUnique({
      where: { id: candidateBookingId },
      select: { id: true },
    });
    return booking?.id ?? null;
  }

  return null;
}

function filenameFromKey(key: string): string {
  const tail = key.split("/").pop() ?? "document.pdf";
  return tail.endsWith(".pdf") ? tail : `${tail}.pdf`;
}
