import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { writeCustomerAuditAsync } from "@/server/services/audit";
import { headerIp, headerReqId, headerUserAgent } from "@/lib/request-meta";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAudit<Ctx>(
  { name: "api.bookings.returnAssessment", entity: "ReturnAssessment" },
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

  const assessment = await prisma.returnAssessment.findUnique({
    where: { bookingId: booking.id },
  });
  if (!assessment?.pdfUrl) return new NextResponse("Not available", { status: 404 });

  writeCustomerAuditAsync(prisma, booking.customerId, {
    userId: session.user.id,
    category: "API",
    action: "returnAssessment.downloaded",
    method: req.method,
    path: `/api/bookings/${booking.id}/return-assessment`,
    status: "SUCCESS",
    reqId: headerReqId(req.headers),
    ipAddress: headerIp(req.headers),
    userAgent: headerUserAgent(req.headers),
    newData: { bookingId: booking.id, assessmentId: assessment.id },
  });

  return NextResponse.redirect(new URL(assessment.pdfUrl, req.url));
}
