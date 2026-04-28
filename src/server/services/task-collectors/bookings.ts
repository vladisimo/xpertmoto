import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";

export interface CollectorOpts {
  depotId?: string | null;
  limit?: number;
  now?: Date;
}

/**
 * Booking-family virtual tasks: pickups due today, returns due today, and
 * overdue returns. Mirrors the windowing the staff dashboard already uses
 * in `staff-today-tab.tsx`.
 */
export async function collectBookingTasks(
  db: PrismaLike,
  opts: CollectorOpts = {},
): Promise<VirtualTask[]> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const depotFilter = opts.depotId ? { depotId: opts.depotId } : {};

  const [pickups, returns, overdue] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
        pickupDateTime: { gte: startOfDay, lt: endOfDay },
        ...depotFilter,
      },
      select: {
        id: true,
        bookingReference: true,
        pickupDateTime: true,
        depotId: true,
        customer: { select: { firstName: true, lastName: true } },
        category: { select: { name: true } },
        vehicle: { select: { internalCode: true, rego: true } },
      },
      orderBy: { pickupDateTime: "asc" },
      take: limit,
    }),
    db.booking.findMany({
      where: {
        status: { in: ["ACTIVE", "CHECKED_OUT"] },
        returnDateTime: { gte: startOfDay, lt: endOfDay },
        ...(opts.depotId ? { returnDepotId: opts.depotId } : {}),
      },
      select: {
        id: true,
        bookingReference: true,
        returnDateTime: true,
        depotId: true,
        returnDepotId: true,
        customer: { select: { firstName: true, lastName: true } },
        category: { select: { name: true } },
        vehicle: { select: { internalCode: true, rego: true } },
      },
      orderBy: { returnDateTime: "asc" },
      take: limit,
    }),
    db.booking.findMany({
      where: {
        status: { in: ["ACTIVE", "OVERDUE", "CHECKED_OUT"] },
        returnDateTime: { lt: now },
        ...(opts.depotId ? { returnDepotId: opts.depotId } : {}),
      },
      select: {
        id: true,
        bookingReference: true,
        returnDateTime: true,
        overdueStage: true,
        depotId: true,
        returnDepotId: true,
        customer: { select: { firstName: true, lastName: true, phone: true } },
        category: { select: { name: true } },
        vehicle: { select: { internalCode: true, rego: true } },
      },
      orderBy: { returnDateTime: "asc" },
      take: limit,
    }),
  ]);

  const tasks: VirtualTask[] = [];

  for (const b of pickups) {
    const imminent = b.pickupDateTime <= inTwoHours;
    const pastDue = b.pickupDateTime < now;
    tasks.push({
      taskType: "BOOKING_PICKUP",
      targetEntityKind: "Booking",
      targetEntityId: b.id,
      tier: pastDue ? "URGENT" : imminent ? "HIGH" : "MEDIUM",
      depotId: b.depotId,
      referenceCode: b.bookingReference,
      title: `Pickup — ${b.customer.firstName} ${b.customer.lastName}`,
      subtitle: `${b.category.name}${b.vehicle ? ` · ${b.vehicle.internalCode}` : ""}`,
      summary: `Due ${formatTime(b.pickupDateTime)}`,
      actionUrl: `/staff/bookings/${b.id}/check-out`,
      actionableSince: b.pickupDateTime,
      dueAt: b.pickupDateTime,
    });
  }

  for (const b of returns) {
    const imminent = b.returnDateTime <= inTwoHours;
    tasks.push({
      taskType: "BOOKING_RETURN",
      targetEntityKind: "Booking",
      targetEntityId: b.id,
      tier: imminent ? "HIGH" : "MEDIUM",
      depotId: b.returnDepotId ?? b.depotId,
      referenceCode: b.bookingReference,
      title: `Return — ${b.customer.firstName} ${b.customer.lastName}`,
      subtitle: `${b.category.name}${b.vehicle ? ` · ${b.vehicle.internalCode}` : ""}`,
      summary: `Due ${formatTime(b.returnDateTime)}`,
      actionUrl: `/staff/bookings/${b.id}/check-in`,
      actionableSince: b.returnDateTime,
      dueAt: b.returnDateTime,
    });
  }

  for (const b of overdue) {
    const hoursOverdue = Math.floor((now.getTime() - b.returnDateTime.getTime()) / 3_600_000);
    const stage = b.overdueStage ?? 0;
    const tier = stage >= 3 || hoursOverdue >= 24 ? "URGENT" : "HIGH";
    tasks.push({
      taskType: "BOOKING_OVERDUE_CHASE",
      targetEntityKind: "Booking",
      targetEntityId: b.id,
      tier,
      depotId: b.returnDepotId ?? b.depotId,
      referenceCode: b.bookingReference,
      title: `Overdue — ${b.customer.firstName} ${b.customer.lastName}`,
      subtitle: `${b.category.name}${b.vehicle ? ` · ${b.vehicle.internalCode}` : ""}`,
      summary: `${hoursOverdue}h overdue · stage ${stage}`,
      actionUrl: `/staff/bookings/${b.id}`,
      actionableSince: b.returnDateTime,
      dueAt: b.returnDateTime,
      metadata: { hoursOverdue, overdueStage: stage },
    });
  }

  return tasks;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
}
