import type { PrismaClient } from "@prisma/client";
import type {
  InsightsGeneratorContext,
  RevenuePerVehicleDayPayload,
} from "../types";

const WINDOW_DAYS = 90;
const TOP_N = 10;

export async function generateRevenuePerVehicleDay(
  prisma: PrismaClient,
  ctx: InsightsGeneratorContext,
): Promise<RevenuePerVehicleDayPayload> {
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
      createdAt: true,
      category: { select: { name: true } },
    },
  });
  if (vehicles.length === 0) {
    return {
      id: "revenue-per-vehicle-day",
      rows: [],
      fleetAverage: 0,
      top: [],
      bottom: [],
      headlineMetric: { label: "Fleet avg revenue / day", value: "$0" },
    };
  }

  const revenueAgg = await prisma.booking.groupBy({
    by: ["vehicleId"],
    where: {
      vehicleId: { in: vehicles.map((v) => v.id) },
      status: { in: ["CHECKED_OUT", "ACTIVE", "RETURNED", "COMPLETED", "OVERDUE"] },
      pickupDateTime: { gte: start, lt: end },
    },
    _sum: { totalAmount: true },
  });
  const revenueByVehicle = new Map<string, number>();
  for (const r of revenueAgg) {
    if (!r.vehicleId) continue;
    revenueByVehicle.set(r.vehicleId, Number(r._sum.totalAmount ?? 0));
  }

  const downtimeAgg = await prisma.maintenanceWorkOrder.groupBy({
    by: ["vehicleId"],
    where: {
      vehicleId: { in: vehicles.map((v) => v.id) },
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      createdAt: { gte: start, lt: end },
    },
    _count: { id: true },
  });
  const openWorkOrdersByVehicle = new Map<string, number>();
  for (const r of downtimeAgg) {
    openWorkOrdersByVehicle.set(r.vehicleId, r._count.id);
  }

  const rows = vehicles.map((v) => {
    const onboardTime = v.createdAt.getTime();
    const eligibleFrom = Math.max(start.getTime(), onboardTime);
    const availableMs = Math.max(0, end.getTime() - eligibleFrom);
    const availableDays = Math.max(1, Math.floor(availableMs / 86_400_000));
    const revenue = revenueByVehicle.get(v.id) ?? 0;
    const revenuePerDay = revenue / availableDays;
    return {
      vehicleId: v.id,
      internalCode: v.internalCode,
      label: `${v.internalCode} · ${v.make} ${v.model}`,
      category: v.category.name,
      revenue: Number(revenue.toFixed(2)),
      availableDays,
      revenuePerDay: Number(revenuePerDay.toFixed(2)),
    };
  });

  rows.sort((a, b) => b.revenuePerDay - a.revenuePerDay);
  const fleetAverage =
    rows.reduce((a, r) => a + r.revenuePerDay, 0) / Math.max(1, rows.length);

  const top = rows.slice(0, TOP_N).map((r) => ({
    label: r.internalCode,
    value: r.revenuePerDay,
  }));
  const bottom = rows
    .slice(-TOP_N)
    .reverse()
    .map((r) => ({ label: r.internalCode, value: r.revenuePerDay }));

  void openWorkOrdersByVehicle;

  return {
    id: "revenue-per-vehicle-day",
    rows,
    fleetAverage: Number(fleetAverage.toFixed(2)),
    top,
    bottom,
    headlineMetric: {
      label: `Fleet average (last ${WINDOW_DAYS} days)`,
      value: `$${fleetAverage.toLocaleString("en-AU", { maximumFractionDigits: 0 })}/day`,
    },
  };
}
