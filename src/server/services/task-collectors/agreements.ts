import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";
import type { CollectorOpts } from "./bookings";

/**
 * Rental agreements in DRAFT — staff have an unsigned agreement sitting at
 * the sign step. Tier HIGH when the parent booking pickup is within 2h or
 * already past, MEDIUM otherwise.
 */
export async function collectAgreementTasks(
  db: PrismaLike,
  opts: CollectorOpts = {},
): Promise<VirtualTask[]> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const rows = await db.rentalAgreement.findMany({
    where: {
      status: "DRAFT",
      ...(opts.depotId ? { booking: { depotId: opts.depotId } } : {}),
    },
    select: {
      id: true,
      agreementNumber: true,
      createdAt: true,
      booking: {
        select: {
          id: true,
          bookingReference: true,
          pickupDateTime: true,
          depotId: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return rows.map((a) => {
    const pickup = a.booking.pickupDateTime;
    const tier: VirtualTask["tier"] = pickup < now ? "URGENT" : pickup <= inTwoHours ? "HIGH" : "MEDIUM";
    return {
      taskType: "RENTAL_AGREEMENT_SIGN",
      targetEntityKind: "RentalAgreement" as const,
      targetEntityId: a.id,
      tier,
      depotId: a.booking.depotId,
      referenceCode: a.booking.bookingReference,
      title: `Sign agreement — ${a.booking.customer.firstName} ${a.booking.customer.lastName}`,
      subtitle: a.agreementNumber,
      summary: `Pickup ${pickup.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}`,
      actionUrl: `/staff/bookings/${a.booking.id}/check-out/sign`,
      actionableSince: a.createdAt,
      dueAt: pickup,
      metadata: { bookingId: a.booking.id },
      links: { bookingId: a.booking.id, customerId: a.booking.customer.id },
    };
  });
}
