import { prisma } from "@/lib/prisma";
import { daysUntilDeadline } from "@/lib/nsw-nomination";
import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "nomination-deadline" as const;

// Start alerting ops this many days before the statutory nomination deadline.
const ALERT_WINDOW_DAYS = 14;

/**
 * Daily sweep that flags infringements whose 21-day Revenue NSW nomination
 * deadline is approaching (or overdue) and that have not yet been submitted.
 * Missing the deadline is a criminal "fail to nominate" offence, so this is a
 * safety net for ops.
 *
 * Idempotent: each infringement is escalated at most once per calendar day
 * via the `deadlineEscalatedAt` latch, so repeated runs (retries, manual
 * triggers) don't spam staff. A per-(infringement, tier) notification dedup
 * key prevents duplicate in-app rows.
 */
export async function runNominationDeadlineCheck(now: Date = new Date()): Promise<{
  checked: number;
  escalated: number;
}> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + ALERT_WINDOW_DAYS);

  const due = await prisma.infringement.findMany({
    where: {
      deletedAt: null,
      nominationDeadline: { not: null, lte: cutoff },
      // Only formally-nominated handling carries a Revenue NSW deadline;
      // pay-and-recover fines are settled directly.
      handling: "NOMINATE_DRIVER",
      status: { notIn: ["PAID", "WRITTEN_OFF", "NOMINATION_SUBMITTED"] },
    },
    include: {
      vehicle: { select: { internalCode: true, rego: true, depotId: true } },
      booking: { select: { bookingReference: true } },
    },
    orderBy: { nominationDeadline: "asc" },
  });

  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const toEscalate = due.filter(
    (i) => !i.deadlineEscalatedAt || i.deadlineEscalatedAt < startOfToday,
  );
  if (toEscalate.length === 0) return { checked: due.length, escalated: 0 };

  const recipients = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true, depotId: true },
  });

  let escalated = 0;
  for (const inf of toEscalate) {
    if (!inf.nominationDeadline) continue;
    const days = daysUntilDeadline(inf.nominationDeadline, now);
    const tier = days < 0 ? "overdue" : days <= 2 ? "t2" : days <= 7 ? "t7" : "t14";
    const key = `infringement.${inf.id}.deadline.${tier}`;

    const exists = await prisma.notification.findFirst({
      where: { type: "INFRINGEMENT_DEADLINE", data: { path: ["key"], equals: key } },
      select: { id: true },
    });
    if (exists) {
      // Already alerted at this tier; still refresh the daily latch so we
      // don't reconsider it until the next calendar day.
      await prisma.infringement.update({
        where: { id: inf.id },
        data: { deadlineEscalatedAt: now },
      });
      continue;
    }

    const when =
      days < 0
        ? `is OVERDUE by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`
        : `is due in ${days} day${days === 1 ? "" : "s"}`;
    const body =
      `Driver nomination for ${inf.type.replace(/_/g, " ").toLowerCase()} infringement ` +
      `${inf.referenceNumber} (vehicle ${inf.vehicle.internalCode}/${inf.vehicle.rego}` +
      `${inf.booking ? `, booking ${inf.booking.bookingReference}` : ""}) ${when}. ` +
      `Generate and submit the nomination to Revenue NSW before the deadline.`;

    const targets = recipients.filter(
      (r) => r.depotId === inf.vehicle.depotId || r.depotId === null,
    );
    for (const r of targets) {
      await prisma.notification.create({
        data: {
          userId: r.id,
          type: "INFRINGEMENT_DEADLINE",
          category: "OPERATIONAL",
          channel: "IN_APP",
          title:
            days < 0
              ? `Nomination OVERDUE — ${inf.referenceNumber}`
              : `Nomination deadline approaching — ${inf.referenceNumber}`,
          body,
          data: { key, infringementId: inf.id, tier, daysUntil: days },
          status: "SENT",
          sentAt: now,
        },
      });
    }

    await prisma.infringement.update({
      where: { id: inf.id },
      data: { deadlineEscalatedAt: now },
    });
    escalated++;
  }

  return { checked: due.length, escalated };
}

export function startNominationDeadlineScheduler() {
  registerWorker(QUEUE, async () => runNominationDeadlineCheck());
  monitorCron(QUEUE, "0 7 * * *", "Australia/Brisbane");
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "0 7 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
