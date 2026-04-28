import type { PrismaClient } from "@prisma/client";
import type {
  InsightsGeneratorContext,
  MaintenanceVsRevenuePayload,
} from "../types";

const WINDOW_DAYS = 365;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

export async function generateMaintenanceVsRevenue(
  prisma: PrismaClient,
  ctx: InsightsGeneratorContext,
): Promise<MaintenanceVsRevenuePayload> {
  const end = ctx.now;
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);

  const vehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      ...(ctx.depotId ? { depotId: ctx.depotId } : {}),
    },
    select: {
      id: true,
      internalCode: true,
      make: true,
      model: true,
    },
  });
  if (vehicles.length === 0) {
    return {
      id: "maintenance-vs-revenue",
      points: [],
      lossMakerCount: 0,
      totalNet: 0,
      medianRevenue: 0,
      medianMaintenance: 0,
      headlineMetric: { label: "Loss-making vehicles", value: "0" },
    };
  }

  const vehicleIds = vehicles.map((v) => v.id);
  const [revenueAgg, maintenanceAgg] = await Promise.all([
    prisma.booking.groupBy({
      by: ["vehicleId"],
      where: {
        vehicleId: { in: vehicleIds },
        status: { in: ["CHECKED_OUT", "ACTIVE", "RETURNED", "COMPLETED", "OVERDUE"] },
        pickupDateTime: { gte: start, lt: end },
      },
      _sum: { totalAmount: true },
    }),
    prisma.maintenanceWorkOrder.groupBy({
      by: ["vehicleId"],
      where: {
        vehicleId: { in: vehicleIds },
        completedAt: { gte: start, lt: end },
        status: "COMPLETED",
      },
      _sum: { actualCost: true },
    }),
  ]);

  const revenueMap = new Map<string, number>();
  for (const r of revenueAgg) {
    if (r.vehicleId) revenueMap.set(r.vehicleId, Number(r._sum.totalAmount ?? 0));
  }
  const maintMap = new Map<string, number>();
  for (const r of maintenanceAgg) {
    maintMap.set(r.vehicleId, Number(r._sum.actualCost ?? 0));
  }

  const points = vehicles.map((v) => {
    const revenue = revenueMap.get(v.id) ?? 0;
    const cost = maintMap.get(v.id) ?? 0;
    const net = revenue - cost;
    return {
      vehicleId: v.id,
      internalCode: v.internalCode,
      label: `${v.internalCode} · ${v.make} ${v.model}`,
      revenue: Number(revenue.toFixed(2)),
      maintenanceCost: Number(cost.toFixed(2)),
      net: Number(net.toFixed(2)),
      lossMaker: net < 0,
    };
  });

  const lossMakerCount = points.filter((p) => p.lossMaker).length;
  const totalNet = points.reduce((a, p) => a + p.net, 0);
  const medianRevenue = median(points.map((p) => p.revenue));
  const medianMaintenance = median(points.map((p) => p.maintenanceCost));

  return {
    id: "maintenance-vs-revenue",
    points,
    lossMakerCount,
    totalNet: Number(totalNet.toFixed(2)),
    medianRevenue: Number(medianRevenue.toFixed(2)),
    medianMaintenance: Number(medianMaintenance.toFixed(2)),
    headlineMetric: {
      label: "Loss-making vehicles (12 months)",
      value: String(lossMakerCount),
      trendLabel: `Net $${totalNet.toLocaleString("en-AU", { maximumFractionDigits: 0 })} across fleet`,
    },
  };
}
