import { prisma } from "@/lib/prisma";
import { FleetInfringementsTable, type FleetInfringementRow } from "./fleet-infringements-table";

export async function FleetInfringementsTab() {
  const items = await prisma.infringement.findMany({
    where: { type: { not: "TOLL" } },
    include: { vehicle: true, booking: { include: { customer: true } } },
    orderBy: { offenceDate: "desc" },
    take: 100,
  });

  const rows: FleetInfringementRow[] = items.map((i) => ({
    id: i.id,
    referenceNumber: i.referenceNumber,
    type: i.type,
    issuer: i.issuer,
    status: i.status,
    vehicleCode: i.vehicle.internalCode,
    bookingRef: i.booking?.bookingReference ?? null,
    customerName: i.booking
      ? `${i.booking.customer.firstName} ${i.booking.customer.lastName}`
      : null,
    offenceDate: i.offenceDate,
    amount: Number(i.amount),
  }));

  return (
    <div className="space-y-6">
      <FleetInfringementsTable data={rows} />
    </div>
  );
}
