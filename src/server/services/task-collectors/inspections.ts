import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";
import type { CollectorOpts } from "./bookings";

/**
 * DRAFT pre-hire and post-hire inspections. These are the unfinished
 * inspection records created by the check-out / check-in flows. Tier is
 * HIGH when the parent booking's pickup or return is imminent or overdue,
 * MEDIUM otherwise.
 */
export async function collectInspectionTasks(
  db: PrismaLike,
  opts: CollectorOpts = {},
): Promise<VirtualTask[]> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const depotFilter = opts.depotId ? { depotId: opts.depotId } : {};
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const drafts = await db.inspection.findMany({
    where: {
      status: "DRAFT",
      type: { in: ["PRE_HIRE", "POST_HIRE"] },
      ...depotFilter,
    },
    select: {
      id: true,
      type: true,
      depotId: true,
      createdAt: true,
      booking: {
        select: {
          id: true,
          bookingReference: true,
          pickupDateTime: true,
          returnDateTime: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      vehicle: { select: { id: true, internalCode: true, rego: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return drafts.map((i) => {
    const isPre = i.type === "PRE_HIRE";
    const taskType = isPre ? "INSPECTION_PRE_HIRE" : "INSPECTION_POST_HIRE";
    const when = isPre ? i.booking?.pickupDateTime : i.booking?.returnDateTime;
    const tier: VirtualTask["tier"] = when
      ? when < now
        ? "URGENT"
        : when <= inTwoHours
          ? "HIGH"
          : "MEDIUM"
      : "MEDIUM";
    const customerName = i.booking
      ? `${i.booking.customer.firstName} ${i.booking.customer.lastName}`
      : "No booking";
    return {
      taskType,
      targetEntityKind: "Inspection" as const,
      targetEntityId: i.id,
      tier,
      depotId: i.depotId,
      referenceCode: i.booking?.bookingReference,
      title: `${isPre ? "Pre-hire" : "Post-hire"} inspection — ${customerName}`,
      subtitle: i.vehicle ? `${i.vehicle.internalCode} · ${i.vehicle.rego}` : undefined,
      summary: when ? `${isPre ? "Pickup" : "Return"} ${formatRelative(when, now)}` : "Draft",
      actionUrl: i.booking
        ? `/staff/bookings/${i.booking.id}/${isPre ? "check-out" : "check-in"}/inspect`
        : `/staff/inspections/${i.id}`,
      actionableSince: i.createdAt,
      dueAt: when ?? null,
      metadata: i.booking ? { bookingId: i.booking.id } : undefined,
      links: {
        bookingId: i.booking?.id,
        customerId: i.booking?.customer.id,
        vehicleId: i.vehicle?.id,
      },
    };
  });
}

function formatRelative(d: Date, now: Date): string {
  const mins = Math.round((d.getTime() - now.getTime()) / 60_000);
  if (mins < -60) return `${Math.round(-mins / 60)}h overdue`;
  if (mins < 0) return `${-mins}m overdue`;
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.round(mins / 60)}h`;
}
