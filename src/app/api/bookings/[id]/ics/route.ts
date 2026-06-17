import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBranding } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import { generateIcs } from "@/lib/calendar";
import { withAudit } from "@/lib/with-audit";

const STAFF_ROLES = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"];

type IcsCtx = { params: Promise<{ id: string }> };
// withAudit only emits an audit row — it does NOT gate access. handleGet must
// enforce auth + owner-scoping itself (R2-H1: this route previously leaked the
// booking reference, dates, category, and exact pickup address with no session).
export const GET = withAudit<IcsCtx>(
  { name: "api.bookings.ics", entity: "BookingIcs" },
  handleGet,
);

async function handleGet(_req: Request, { params }: IcsCtx) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  // Look up by id only — both callers (booking confirmation + dashboard) use
  // booking.id. The human-readable bookingReference was an enumeration vector.
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { category: true, pickupDepot: true, returnDepot: true },
  });
  if (!booking) return new NextResponse("Not found", { status: 404 });

  const isOwner = booking.customerId === session.user.id;
  const isStaff = STAFF_ROLES.includes(session.user.role);
  if (!isOwner && !isStaff) return new NextResponse("Forbidden", { status: 403 });

  const { siteName } = await getBranding();
  const slug =
    siteName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "booking";

  const ics = generateIcs({
    prodId: siteName,
    uid: `booking-${booking.id}@xpertmoto.com.au`,
    title: `Scooter hire: ${booking.category.name} (${booking.bookingReference})`,
    description: `Pickup at ${booking.pickupDepot.name}. Return at ${booking.returnDepot.name}. Reference ${booking.bookingReference}.`,
    location: `${booking.pickupDepot.name}, ${booking.pickupDepot.addressLine1}, ${booking.pickupDepot.suburb} ${booking.pickupDepot.state} ${booking.pickupDepot.postcode}`,
    start: booking.pickupDateTime,
    end: booking.returnDateTime,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/bookings/${booking.id}`,
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${booking.bookingReference}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
