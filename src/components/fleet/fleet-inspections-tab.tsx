import { prisma } from "@/lib/prisma";
import { PageSection } from "@/components/layout/page-section";
import { FleetInspectionsTable, type FleetInspectionRow } from "./fleet-inspections-table";

export async function FleetInspectionsTab() {
  const [recent, vehicleCount] = await Promise.all([
    prisma.inspection.findMany({
      include: { vehicle: true, inspector: true },
      orderBy: { dateTime: "desc" },
      take: 30,
    }),
    prisma.vehicle.count({ where: { isActive: true } }),
  ]);

  const rows: FleetInspectionRow[] = recent.map((i) => ({
    id: i.id,
    vehicleCode: i.vehicle.internalCode,
    type: i.type,
    inspectorName: `${i.inspector.firstName} ${i.inspector.lastName}`,
    dateTime: i.dateTime,
    odometerKm: i.odometerKm,
    fuelLevel: i.fuelLevel,
    overallCondition: i.overallCondition,
  }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {vehicleCount} active vehicles. Inspections run from the vehicle detail page or from the action above.
      </p>

      <PageSection title="Recent" flush>
        <FleetInspectionsTable data={rows} />
      </PageSection>
    </div>
  );
}
