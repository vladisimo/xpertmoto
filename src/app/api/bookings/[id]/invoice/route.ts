import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headerIp, headerReqId, headerUserAgent } from "@/lib/request-meta";
import { withAudit } from "@/lib/with-audit";
import { writeCustomerAuditAsync } from "@/server/services/audit";

type InvoiceCtx = { params: Promise<{ id: string }> };
export const GET = withAudit<InvoiceCtx>(
  { name: "api.bookings.invoice", entity: "Invoice" },
  handleGet,
);

async function handleGet(req: Request, { params }: InvoiceCtx) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, customerId: true, bookingReference: true },
  });
  if (!booking) return new NextResponse("Not found", { status: 404 });

  const isOwner = booking.customerId === session.user.id;
  const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role);
  if (!isOwner && !isStaff) return new NextResponse("Forbidden", { status: 403 });

  // The legacy HTML invoice has been retired. Redirect callers to the
  // canonical Tax Invoice PDF stored against the booking's Invoice row.
  const invoice = await prisma.invoice.findFirst({
    where: { bookingId: booking.id, pdfKey: { not: null } },
    orderBy: { issuedAt: "desc" },
    select: { id: true, pdfKey: true },
  });
  if (!invoice?.pdfKey) {
    return new NextResponse("Invoice not yet issued", { status: 404 });
  }

  writeCustomerAuditAsync(prisma, booking.customerId, {
    userId: session.user.id,
    category: "API",
    action: "invoice.viewed",
    method: req.method,
    path: `/api/bookings/${booking.id}/invoice`,
    status: "SUCCESS",
    reqId: headerReqId(req.headers),
    ipAddress: headerIp(req.headers),
    userAgent: headerUserAgent(req.headers),
    newData: { bookingId: booking.id, bookingReference: booking.bookingReference },
  });

  const target = new URL(req.url);
  target.pathname = "/api/documents";
  target.search = `?key=${encodeURIComponent(invoice.pdfKey)}`;
  return NextResponse.redirect(target, 302);
}
