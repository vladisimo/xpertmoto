import { render } from "@react-email/render";
import { createElement } from "react";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { BOOKING_RULES } from "@/lib/constants";
import { getBranding } from "@/lib/branding";
import { sendNotification } from "@/server/services/notification-sender";
import OverdueNotice from "../../../emails/overdue-notice";
import { getQueue, monitorCron, registerWorker } from "./queue";
import { logger } from "@/lib/logger";
import { recordIncidentForCustomer } from "@/server/services/revenue-aggregator";
import { generateIncidentNumber, withUniqueRetry } from "@/lib/id-gen";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";

const QUEUE = "overdue-check" as const;

/**
 * B2: overdue escalation ladder.
 *
 * Stages on `Booking.overdueStage` (see schema), advanced monotonically
 * by this job so the same customer isn't spammed:
 *
 *   0 → 1   at +1h past return  : flip to OVERDUE, notify customer +
 *                                 managers (email + SMS + push).
 *   1 → 2   at +12h              : second SMS nudge, no email spam.
 *   2 → 3   at +24h              : manager escalation push + email,
 *                                 booking note created for the staff log.
 *   3 → 4   at +72h              : auto-create a REPORTED Incident of
 *                                 type THEFT and page the managers. At
 *                                 this point it's no longer a late
 *                                 return — something has gone wrong.
 *
 * Runs every 15 minutes. Stage storage keeps the job idempotent across
 * restarts and partial failures.
 */
const STAGES = [
  { stage: 1, hoursAfterReturn: BOOKING_RULES.lateReturnGraceHours, name: "initial" },
  { stage: 2, hoursAfterReturn: 12, name: "second-nudge" },
  { stage: 3, hoursAfterReturn: 24, name: "manager-escalation" },
  { stage: 4, hoursAfterReturn: 72, name: "auto-incident" },
] as const;

export type OverdueRunResult = {
  scanned: number;
  transitionedToOverdue: number;
  stageAdvances: Record<number, number>;
  incidentsCreated: number;
};

export async function runOverdueCheck(): Promise<OverdueRunResult> {
  const now = Date.now();
  const stageAdvances: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let transitionedToOverdue = 0;
  let incidentsCreated = 0;

  // Candidates: anything ACTIVE / CHECKED_OUT / OVERDUE whose return time
  // is in the past. We don't exclude by stage because each stage has its
  // own trigger threshold; the per-stage filter happens below.
  const candidates = await prisma.booking.findMany({
    where: {
      status: { in: ["ACTIVE", "CHECKED_OUT", "OVERDUE"] },
      returnDateTime: { lt: new Date(now) },
    },
    include: {
      customer: true,
      category: true,
      vehicle: true,
      pickupDepot: { select: { slug: true } },
    },
  });

  for (const b of candidates) {
    const hoursLate = (now - b.returnDateTime.getTime()) / (1000 * 60 * 60);

    // Walk stages in order so we can catch up a booking that was missed
    // (e.g. worker down for a few hours) without skipping notifications.
    for (const stage of STAGES) {
      if (b.overdueStage >= stage.stage) continue;
      if (hoursLate < stage.hoursAfterReturn) break; // later stages won't fire either

      try {
        await runStage(b, stage.stage);
        stageAdvances[stage.stage] = (stageAdvances[stage.stage] ?? 0) + 1;
        if (stage.stage === 1) transitionedToOverdue += 1;
        if (stage.stage === 4) incidentsCreated += 1;
        await trackServer({
          event: SERVER_EVENTS.bookingOverdue,
          distinctId: b.customer.id,
          properties: {
            bookingId: b.id,
            reference: b.bookingReference,
            stage: stage.stage,
            hoursLate: Math.round(hoursLate),
          },
          groups: { depot: b.pickupDepot.slug },
        });
        if (stage.stage === 4 && b.vehicle) {
          await trackServer({
            event: SERVER_EVENTS.incidentAutoCreated,
            distinctId: b.customer.id,
            properties: {
              bookingId: b.id,
              reference: b.bookingReference,
              vehicleId: b.vehicle.id,
              type: "THEFT",
              trigger: "overdue_72h",
            },
            groups: { depot: b.pickupDepot.slug },
          });
        }
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            bookingId: b.id,
            stage: stage.stage,
          },
          "overdue-check: stage handler failed",
        );
      }
    }
  }

  logger.info(
    {
      scanned: candidates.length,
      transitionedToOverdue,
      stageAdvances,
      incidentsCreated,
    },
    "overdue-check finished",
  );

  return {
    scanned: candidates.length,
    transitionedToOverdue,
    stageAdvances,
    incidentsCreated,
  };
}

type CandidateBooking = Awaited<ReturnType<typeof prisma.booking.findMany>>[number] & {
  customer: { id: string; email: string; firstName: string; lastName: string; phone: string | null };
  category: { baseDailyRate: unknown };
  vehicle: { id: string } | null;
};

async function runStage(b: CandidateBooking, stage: number): Promise<void> {
  if (stage === 1) {
    await stageOneTransitionAndNotify(b);
  } else if (stage === 2) {
    await stageTwoSecondNudge(b);
  } else if (stage === 3) {
    await stageThreeManagerEscalation(b);
  } else if (stage === 4) {
    await stageFourAutoIncident(b);
  }
}

async function stageOneTransitionAndNotify(b: CandidateBooking): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: b.id },
      data: {
        status: "OVERDUE",
        overdueStage: 1,
      },
    });
    await tx.bookingStatusLog.create({
      data: {
        bookingId: b.id,
        previousStatus: b.status,
        newStatus: "OVERDUE",
        reason: "Auto: past return time + grace period (stage 1)",
      },
    });
  });

  const hourlyRate = Number(b.category.baseDailyRate) / 8;
  const html = await render(
    createElement(OverdueNotice, {
      customerName: b.customer.firstName,
      bookingReference: b.bookingReference,
      expectedReturn: b.returnDateTime.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Australia/Brisbane",
      }),
      lateFeePerHour: formatCurrency(hourlyRate),
    }),
  );
  const { siteName } = await getBranding();
  await sendNotification({
    userId: b.customer.id,
    type: "BOOKING_OVERDUE",
    channels: b.customer.phone ? ["EMAIL", "SMS"] : ["EMAIL"],
    subject: `Overdue: booking ${b.bookingReference}`,
    title: `Booking overdue — ${b.bookingReference}`,
    html,
    body: `${siteName}: booking ${b.bookingReference} is overdue. Please return the vehicle ASAP to avoid further fees.`,
    bookingId: b.id,
    data: { bookingReference: b.bookingReference, hourlyLateRate: hourlyRate, stage: 1 },
  });
  await notifyManagers(b, `Overdue: ${b.bookingReference}`, `${b.customer.firstName} ${b.customer.lastName} is past return time.`);
}

async function stageTwoSecondNudge(b: CandidateBooking): Promise<void> {
  await prisma.booking.update({ where: { id: b.id }, data: { overdueStage: 2 } });
  if (b.customer.phone) {
    const { siteName } = await getBranding();
    await sendNotification({
      userId: b.customer.id,
      type: "BOOKING_OVERDUE",
      channels: ["SMS"],
      title: `12h overdue — ${b.bookingReference}`,
      body: `${siteName}: booking ${b.bookingReference} is now 12h+ overdue. Please contact your depot immediately.`,
      bookingId: b.id,
      data: { stage: 2 },
    });
  }
}

async function stageThreeManagerEscalation(b: CandidateBooking): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { overdueStage: 3 } });
    await tx.bookingNote.create({
      data: {
        bookingId: b.id,
        userId: b.customer.id,
        note: "Automated: 24h+ overdue. Managers escalated — consider phone call or field visit before T+72h auto-incident threshold.",
        isInternal: true,
      },
    });
  });
  const { siteName: escalationSiteName } = await getBranding();
  await sendNotification({
    userId: b.customer.id,
    type: "BOOKING_OVERDUE_ESCALATION",
    channels: ["EMAIL"],
    subject: `Urgent: booking ${b.bookingReference} — please contact us`,
    title: "Urgent: return overdue",
    body:
      `Hi ${b.customer.firstName},\n\n` +
      `Your ${escalationSiteName} booking ${b.bookingReference} is now more than 24 hours overdue.\n\n` +
      `Please contact your depot or reply to this email immediately. Continued non-return after 72 hours will be logged as a potential theft incident per our rental agreement.\n\n` +
      `— ${escalationSiteName}`,
    bookingId: b.id,
    data: { stage: 3 },
  });
  await notifyManagers(
    b,
    `24h overdue: ${b.bookingReference}`,
    `Escalation: ${b.customer.firstName} ${b.customer.lastName} is 24h+ overdue. Call before T+72h.`,
  );
}

async function stageFourAutoIncident(b: CandidateBooking): Promise<void> {
  await withUniqueRetry(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: b.id }, data: { overdueStage: 4 } });
        if (b.vehicle) {
          await tx.incident.create({
            data: {
              incidentNumber: generateIncidentNumber("INC-AUTO"),
              vehicleId: b.vehicle.id,
              bookingId: b.id,
              customerId: b.customer.id,
              type: "THEFT",
              severity: "MAJOR",
              status: "REPORTED",
              dateTime: new Date(),
              description: `Automated: vehicle not returned within 72 hours of scheduled return (${b.returnDateTime.toISOString()}). Review and escalate to police report if appropriate.`,
              customerLiable: true,
            },
          });
          await recordIncidentForCustomer(tx, b.customer.id);
        }
        await tx.bookingNote.create({
          data: {
            bookingId: b.id,
            userId: b.customer.id,
            note: "Automated: 72h+ overdue. REPORTED incident auto-created. Manager action required — phone customer, check GPS, consider police report.",
            isInternal: true,
          },
        });
      }),
    { constraintFields: ["incidentNumber"] },
  );
  await notifyManagers(
    b,
    `72h overdue: incident created for ${b.bookingReference}`,
    `${b.customer.firstName} ${b.customer.lastName}'s vehicle has not been returned for 72+ hours. Incident created — review now.`,
  );
}

async function notifyManagers(b: CandidateBooking, title: string, body: string): Promise<void> {
  const managers = await prisma.user.findMany({
    where: {
      role: { in: ["MANAGER", "ADMIN"] },
      status: "ACTIVE",
      OR: [{ depotId: b.pickupDepotId }, { depotId: null }],
    },
    select: { id: true },
  });
  for (const m of managers) {
    await sendNotification({
      userId: m.id,
      type: "BOOKING_OVERDUE_ESCALATION",
      category: "OPERATIONAL",
      channels: ["PUSH", "IN_APP"],
      title,
      body,
      bookingId: b.id,
      data: { url: `/staff/bookings/${b.id}`, tag: `overdue-${b.id}` },
    });
  }
}

export function startOverdueCheckScheduler() {
  registerWorker(QUEUE, async () => runOverdueCheck());
  // Monitor approximates the 15-min interval as a crontab so Sentry can flag
  // a stalled worker (a missed overdue sweep delays OVERDUE transitions).
  monitorCron(QUEUE, "*/15 * * * *");
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "poll",
    {},
    { repeat: { every: 15 * 60 * 1000 }, jobId: "repeat-every-15min" },
  );
}
