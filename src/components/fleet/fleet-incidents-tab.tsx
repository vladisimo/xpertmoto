import { prisma } from "@/lib/prisma";
import { FleetIncidentsTable, type FleetIncidentRow } from "./fleet-incidents-table";

export async function FleetIncidentsTab() {
  const incidents = await prisma.incident.findMany({
    include: { vehicle: true, booking: { include: { customer: true } } },
    orderBy: { dateTime: "desc" },
    take: 100,
  });

  const rows: FleetIncidentRow[] = incidents.map((i) => ({
    id: i.id,
    incidentNumber: i.incidentNumber,
    type: i.type,
    severity: i.severity,
    status: i.status,
    vehicleCode: i.vehicle.internalCode,
    customerName: i.booking
      ? `${i.booking.customer.firstName} ${i.booking.customer.lastName}`
      : null,
    dateTime: i.dateTime,
    description: i.description,
    estimatedDamageCost: i.estimatedDamageCost ? Number(i.estimatedDamageCost) : null,
  }));

  return (
    <div className="space-y-6">
      <FleetIncidentsTable data={rows} />
    </div>
  );
}
