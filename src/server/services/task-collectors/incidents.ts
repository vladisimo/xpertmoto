import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";
import type { CollectorOpts } from "./bookings";

/** A theft suspicion is stale once the confirm window has passed. */
const CONFIRM_DUE_HOURS = 24;

/**
 * Area 3: open THEFT incidents that still need the manager confirmation act
 * (police report + bond capture + termination via `fleet.confirmTheft`).
 * Emitted while the incident sits in REPORTED / UNDER_INVESTIGATION — the
 * confirm flow advances it to INSURANCE_CLAIM (or ASSESSED while the police
 * report is pending), which drops the task off the board; `confirmTheft`
 * also auto-closes any claimed activity via `autoCloseByTarget`.
 *
 * Due +24h after the incident was raised (the stage-4 auto-incident fires at
 * T+72h, so the bond auth clock is already running); URGENT once overdue.
 */
export async function collectIncidentTasks(
  db: PrismaLike,
  opts: CollectorOpts = {},
): Promise<VirtualTask[]> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();

  const rows = await db.incident.findMany({
    where: {
      type: "THEFT",
      status: { in: ["REPORTED", "UNDER_INVESTIGATION"] },
      deletedAt: null,
      ...(opts.depotId ? { vehicle: { depotId: opts.depotId } } : {}),
    },
    select: {
      id: true,
      incidentNumber: true,
      createdAt: true,
      bookingId: true,
      customerId: true,
      vehicle: {
        select: { id: true, internalCode: true, rego: true, depotId: true },
      },
      booking: { select: { bookingReference: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return rows.map((incident) => {
    const dueAt = new Date(
      incident.createdAt.getTime() + CONFIRM_DUE_HOURS * 60 * 60 * 1000,
    );
    const overdue = now >= dueAt;
    return {
      taskType: "INCIDENT_INVESTIGATE" as const,
      targetEntityKind: "Incident" as const,
      targetEntityId: incident.id,
      tier: overdue ? ("URGENT" as const) : ("HIGH" as const),
      depotId: incident.vehicle.depotId,
      referenceCode: incident.incidentNumber,
      title: "Confirm theft — police report + bond capture",
      subtitle: `${incident.vehicle.internalCode} · ${incident.vehicle.rego}`,
      summary: incident.booking
        ? `Suspected theft on ${incident.booking.bookingReference} — confirm, capture bond, terminate hire`
        : "Suspected theft — confirm and record police report",
      actionUrl: `/staff/incidents/${incident.id}`,
      actionableSince: incident.createdAt,
      dueAt,
      metadata: { incidentNumber: incident.incidentNumber },
      links: {
        vehicleId: incident.vehicle.id,
        ...(incident.bookingId ? { bookingId: incident.bookingId } : {}),
        ...(incident.customerId ? { customerId: incident.customerId } : {}),
      },
    };
  });
}
