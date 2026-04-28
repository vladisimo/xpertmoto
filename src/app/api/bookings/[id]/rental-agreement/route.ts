import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { writeCustomerAuditAsync } from "@/server/services/audit";
import { headerIp, headerReqId, headerUserAgent } from "@/lib/request-meta";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAudit<Ctx>(
  { name: "api.bookings.rentalAgreement", entity: "RentalAgreement" },
  handleGet,
);

async function handleGet(req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, customerId: true },
  });
  if (!booking) return new NextResponse("Not found", { status: 404 });

  const isOwner = booking.customerId === session.user.id;
  const isStaff = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role);
  if (!isOwner && !isStaff) return new NextResponse("Forbidden", { status: 403 });

  // Optional ?version=N to fetch a specific version (for audit); default = latest signed/superseded/signed.
  const url = new URL(req.url);
  const version = url.searchParams.get("version");

  const agreement = version
    ? await prisma.rentalAgreement.findFirst({
        where: { bookingId: booking.id, version: Number(version) },
      })
    : await prisma.rentalAgreement.findFirst({
        where: { bookingId: booking.id, status: { in: ["SIGNED", "SUPERSEDED"] } },
        orderBy: { version: "desc" },
      });
  if (!agreement?.pdfUrl) return new NextResponse("Not available", { status: 404 });

  writeCustomerAuditAsync(prisma, booking.customerId, {
    userId: session.user.id,
    category: "API",
    action: "agreement.downloaded",
    method: req.method,
    path: `/api/bookings/${booking.id}/rental-agreement`,
    status: "SUCCESS",
    reqId: headerReqId(req.headers),
    ipAddress: headerIp(req.headers),
    userAgent: headerUserAgent(req.headers),
    newData: {
      bookingId: booking.id,
      agreementId: agreement.id,
      version: agreement.version,
    },
  });

  return NextResponse.redirect(agreement.pdfUrl);
}
