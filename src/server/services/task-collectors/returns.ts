import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";
import type { CollectorOpts } from "./bookings";

/**
 * Return assessments pending finalise — status DRAFT. These are the
 * "settle the bond / finalise charges" step after check-in. The act of
 * `return.finalise` transitions DRAFT → SIGNED and is the completing
 * mutation for this task. Tier HIGH if the return was today or earlier,
 * MEDIUM otherwise.
 */
export async function collectReturnAssessmentTasks(
  db: PrismaLike,
  opts: CollectorOpts = {},
): Promise<VirtualTask[]> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const rows = await db.returnAssessment.findMany({
    where: {
      status: "DRAFT",
      ...(opts.depotId ? { booking: { returnDepotId: opts.depotId } } : {}),
    },
    select: {
      id: true,
      assessmentNumber: true,
      createdAt: true,
      booking: {
        select: {
          id: true,
          bookingReference: true,
          returnDateTime: true,
          depotId: true,
          returnDepotId: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return rows.map((r) => {
    const tier: VirtualTask["tier"] = r.booking.returnDateTime < startOfToday ? "HIGH" : "MEDIUM";
    return {
      taskType: "RETURN_ASSESSMENT_FINALISE",
      targetEntityKind: "ReturnAssessment" as const,
      targetEntityId: r.id,
      tier,
      depotId: r.booking.returnDepotId ?? r.booking.depotId,
      referenceCode: r.booking.bookingReference,
      title: `Finalise return — ${r.booking.customer.firstName} ${r.booking.customer.lastName}`,
      subtitle: r.assessmentNumber,
      summary: "Draft — sign off to finalise",
      actionUrl: `/staff/bookings/${r.booking.id}/check-in/settle`,
      actionableSince: r.createdAt,
      dueAt: null,
      metadata: { bookingId: r.booking.id },
    };
  });
}
