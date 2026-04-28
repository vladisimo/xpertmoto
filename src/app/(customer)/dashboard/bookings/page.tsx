import Link from "next/link";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { MyBookingsTable, type MyBookingRow } from "@/components/customer/my-bookings-table";
import { BookingCtaText } from "@/components/booking/booking-cta";

export default async function MyBookingsPage() {
  const session = await auth();
  const bookings = await prisma.booking.findMany({
    where: { customerId: session!.user.id },
    include: { category: true, pickupDepot: true },
    orderBy: { pickupDateTime: "desc" },
  });

  const rows: MyBookingRow[] = bookings.map((b) => ({
    id: b.id,
    bookingReference: b.bookingReference,
    status: b.status,
    categoryName: b.category.name,
    pickupDepotName: b.pickupDepot.name,
    bookedAt: b.createdAt,
    pickupDateTime: b.pickupDateTime,
    returnDateTime: b.returnDateTime,
    totalAmount: Number(b.totalAmount),
  }));

  return (
    <PageShell>
      <PageHeader
        title="My bookings"
        description="Your past, current, and upcoming rentals."
        actions={
          <Button asChild>
            <Link href="/booking">
              <Plus className="h-4 w-4" />
              <BookingCtaText initial="New booking" resume="Continue booking" />
            </Link>
          </Button>
        }
      />

      <MyBookingsTable data={rows} />
    </PageShell>
  );
}
