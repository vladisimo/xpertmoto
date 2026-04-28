/**
 * Cheap data-sufficiency gate for AI Insights. Runs before any generator
 * or narration so the /staff/ai-insights page neither renders nor pays
 * the AI narration cost until the database holds enough signal for each
 * insight type to be meaningful.
 *
 * Scoped by depotId the same way insight generation is: a MANAGER's
 * readiness reflects their own depot's data, an ADMIN's reflects the
 * requested scope (or org-wide when no depotId is passed).
 */

import type { PrismaClient } from "@prisma/client";

export const INSIGHT_THRESHOLDS = {
  completedBookings: 10,
  customersWithSpend: 5,
  activeVehicles: 3,
  daysOfHistory: 30,
} as const;

export interface ReadinessGap {
  key: keyof typeof INSIGHT_THRESHOLDS;
  label: string;
  have: number;
  need: number;
}

export interface DataReadiness {
  sufficient: boolean;
  missing: ReadinessGap[];
}

const ACTIVE_BOOKING_STATUSES = [
  "CHECKED_OUT",
  "ACTIVE",
  "RETURNED",
  "COMPLETED",
  "OVERDUE",
] as const;

const ACTIVE_VEHICLE_STATUSES = ["AVAILABLE", "RENTED"] as const;

export async function assessInsightsReadiness(
  prisma: PrismaClient,
  depotId?: string,
): Promise<DataReadiness> {
  const bookingWhere = {
    status: { in: [...ACTIVE_BOOKING_STATUSES] },
    ...(depotId ? { pickupDepotId: depotId } : {}),
  };

  const [completedBookings, customersWithSpend, activeVehicles, firstBooking] =
    await Promise.all([
      prisma.booking.count({ where: bookingWhere }),
      prisma.customerProfile.count({
        where: { totalSpend: { gt: 0 }, user: { role: "CUSTOMER" } },
      }),
      prisma.vehicle.count({
        where: {
          status: { in: [...ACTIVE_VEHICLE_STATUSES] },
          isActive: true,
          deletedAt: null,
          ...(depotId ? { depotId } : {}),
        },
      }),
      prisma.booking.findFirst({
        where: bookingWhere,
        orderBy: { pickupDateTime: "asc" },
        select: { pickupDateTime: true },
      }),
    ]);

  const daysOfHistory = firstBooking
    ? Math.floor(
        (Date.now() - firstBooking.pickupDateTime.getTime()) / 86_400_000,
      )
    : 0;

  const missing: ReadinessGap[] = [];

  if (completedBookings < INSIGHT_THRESHOLDS.completedBookings) {
    missing.push({
      key: "completedBookings",
      label: "Completed bookings",
      have: completedBookings,
      need: INSIGHT_THRESHOLDS.completedBookings,
    });
  }
  if (customersWithSpend < INSIGHT_THRESHOLDS.customersWithSpend) {
    missing.push({
      key: "customersWithSpend",
      label: "Customers with spend",
      have: customersWithSpend,
      need: INSIGHT_THRESHOLDS.customersWithSpend,
    });
  }
  if (activeVehicles < INSIGHT_THRESHOLDS.activeVehicles) {
    missing.push({
      key: "activeVehicles",
      label: "Active fleet vehicles",
      have: activeVehicles,
      need: INSIGHT_THRESHOLDS.activeVehicles,
    });
  }
  if (daysOfHistory < INSIGHT_THRESHOLDS.daysOfHistory) {
    missing.push({
      key: "daysOfHistory",
      label: "Days of booking history",
      have: daysOfHistory,
      need: INSIGHT_THRESHOLDS.daysOfHistory,
    });
  }

  return { sufficient: missing.length === 0, missing };
}

export class InsightsDataInsufficientError extends Error {
  readonly readiness: DataReadiness;
  constructor(readiness: DataReadiness) {
    super("Not enough data to compute insights yet.");
    this.name = "InsightsDataInsufficientError";
    this.readiness = readiness;
  }
}
