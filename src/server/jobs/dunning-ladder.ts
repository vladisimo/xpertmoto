import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { debtorsList, type Debtor } from "@/server/services/admin-risk-signals";
import { sendNotification } from "@/server/services/notification-sender";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { getBranding } from "@/lib/branding";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { getQueue, registerWorker } from "./queue";

/**
 * G7 — dunning ladder.
 *
 * Progressive escalation for outstanding balances:
 *
 *   Stage 1  (day 0)            first reminder         email + sms
 *   Stage 2  (stage 1 +7d)      second reminder        email + sms
 *   Stage 3  (stage 2 +10d)     final notice           email + sms
 *   Stage 4  (stage 3 +10d)     collections flag       internal; risk → MEDIUM
 *   Stage 5  (stage 4 +30d)     write-off proposal     internal; risk → HIGH
 *
 * Ladder position is tracked via `CommunicationLog` rows with
 * `templateUsed = "DUNNING_STAGE_<n>"`. A row exists iff stage <n> has
 * already fired. We advance to stage N only when stage N-1 fired more
 * than the interval below ago. Customers who pay to zero fall out of
 * `debtorsList()` and no further stages fire.
 */

const QUEUE = "dunning-ladder" as const;
const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

type DunningStage = 1 | 2 | 3 | 4 | 5;
const STAGE_GAP_DAYS: Record<DunningStage, number> = { 1: 0, 2: 7, 3: 10, 4: 10, 5: 30 };
const TEMPLATE = (n: DunningStage) => `DUNNING_STAGE_${n}`;

function buildCopy(
  d: Debtor,
  stage: DunningStage,
  siteName: string,
): { subject: string; title: string; body: string } {
  const total = AUD.format(d.totalOwed);
  switch (stage) {
    case 1:
      return {
        subject: `${siteName} — ${total} outstanding`,
        title: "Outstanding balance reminder",
        body: `Hi ${d.firstName}, our records show you have a balance of ${total} outstanding. Please log in to settle this, or reply if you believe this is in error.`,
      };
    case 2:
      return {
        subject: `Reminder #2 — ${total} still outstanding`,
        title: "Second reminder",
        body: `Hi ${d.firstName}, your balance of ${total} remains outstanding. Please settle within 5 business days to avoid further action.`,
      };
    case 3:
      return {
        subject: `FINAL NOTICE — ${total} overdue`,
        title: "Final notice",
        body: `Hi ${d.firstName}, this is a final notice that ${total} is overdue. If payment is not received within 7 days, your account will be flagged for collections.`,
      };
    case 4:
      return {
        subject: `Account flagged for collections`,
        title: "Account flagged",
        body: `Hi ${d.firstName}, your account has been flagged for collections. Please contact us immediately to resolve ${total} outstanding.`,
      };
    case 5:
      return {
        subject: `Account under review`,
        title: "Account under review",
        body: `Hi ${d.firstName}, your outstanding balance of ${total} is >60 days overdue and is under review for write-off or external recovery. Please contact us to discuss.`,
      };
  }
}

async function lastStageFired(customerId: string): Promise<{ stage: DunningStage | 0; at: Date | null }> {
  const rows = await prisma.communicationLog.findMany({
    where: {
      customerId,
      templateUsed: { startsWith: "DUNNING_STAGE_" },
    },
    orderBy: { sentAt: "desc" },
    take: 1,
    select: { templateUsed: true, sentAt: true },
  });
  const row = rows[0];
  if (!row?.templateUsed) return { stage: 0, at: null };
  const m = row.templateUsed.match(/^DUNNING_STAGE_(\d)$/);
  if (!m || !m[1]) return { stage: 0, at: null };
  const n = Number.parseInt(m[1], 10);
  if (n >= 1 && n <= 5) return { stage: n as DunningStage, at: row.sentAt };
  return { stage: 0, at: null };
}

function nextStageFor(last: DunningStage | 0, daysSinceLast: number): DunningStage | null {
  // Stage 5 is no longer terminal: it re-fires every 30 days until the
  // balance clears (payment) or a manager forgives it (writeOffBalance).
  // Previously the ladder went silent here and unresolved debt simply
  // aged off everyone's radar.
  if (last === 5) return daysSinceLast >= STAGE_GAP_DAYS[5] ? 5 : null;
  const next = (last + 1) as DunningStage;
  if (next > 5) return null;
  if (daysSinceLast >= STAGE_GAP_DAYS[next]) return next;
  return null;
}

export async function runDunningLadder(): Promise<{ progressed: number; stages: Record<DunningStage, number> }> {
  const debtors = await debtorsList(500);
  const { siteName } = await getBranding();
  let progressed = 0;
  const stages: Record<DunningStage, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const d of debtors) {
    const { stage: last, at } = await lastStageFired(d.customerId);
    const daysSinceLast = at ? Math.floor((Date.now() - at.getTime()) / 86_400_000) : 999;
    const stage = nextStageFor(last, daysSinceLast);
    if (!stage) continue;

    const { subject, title, body } = buildCopy(d, stage, siteName);

    if (stage <= 3) {
      await sendNotification({
        userId: d.customerId,
        type: "DEBT_REMINDER",
        channels: d.phone && stage >= 2 ? ["EMAIL", "SMS"] : ["EMAIL"],
        subject,
        title,
        body,
        data: { stage, totalOwed: d.totalOwed, templateUsed: TEMPLATE(stage) },
      });
    }

    if (stage === 4) {
      await prisma.customerProfile.updateMany({
        where: { userId: d.customerId, riskRating: "LOW" },
        data: { riskRating: "MEDIUM" },
      });
      await notifyManagers(
        `Customer ${d.firstName} flagged for collections`,
        `Balance ${AUD.format(d.totalOwed)} overdue. Follow up or assign to collections agency.`,
        d.customerId,
      );
    }

    if (stage === 5) {
      await prisma.customerProfile.updateMany({
        where: { userId: d.customerId, riskRating: { in: ["LOW", "MEDIUM"] } },
        data: { riskRating: "HIGH" },
      });
      await notifyManagers(
        `Write-off candidate — ${d.firstName}`,
        `Balance ${AUD.format(d.totalOwed)} is >60 days overdue. Decide: pursue externally, or forgive via ` +
          `the booking's payment console → "Write off balance" (books the debt closed and stops this ladder). ` +
          `Stage 5 repeats every 30 days until the balance clears one way or the other.`,
        d.customerId,
      );
    }

    // Stage-fired marker — the source of truth for `lastStageFired` next tick.
    await prisma.communicationLog.create({
      data: {
        customerId: d.customerId,
        channel: "EMAIL",
        direction: "OUTBOUND",
        subject,
        body,
        templateUsed: TEMPLATE(stage),
      },
    });

    await writePaymentAudit(prisma, {
      action: `dunning.stage${stage}`,
      entity: "Payment",
      entityId: `customer:${d.customerId}`,
      userId: d.customerId,
      status: "SUCCESS",
      newData: { stage, totalOwed: d.totalOwed, daysSinceLast, previousStage: last },
    });

    await trackServer({
      event: SERVER_EVENTS.dunningAdvanced,
      distinctId: d.customerId,
      properties: {
        stage,
        previousStage: last,
        totalOwedAud: d.totalOwed,
        daysSinceLast,
      },
    });

    progressed += 1;
    stages[stage] += 1;
  }

  logger.info({ progressed, stages, debtors: debtors.length }, "dunning-ladder completed");
  return { progressed, stages };
}

async function notifyManagers(subject: string, body: string, customerRef: string): Promise<void> {
  const managers = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
    take: 5,
  });
  for (const m of managers) {
    await sendNotification({
      userId: m.id,
      type: "INCIDENT_REPORTED",
      channels: ["EMAIL", "IN_APP"],
      subject,
      title: subject,
      body,
      data: { customerRef },
    });
  }
}

export function startDunningLadderScheduler() {
  registerWorker(QUEUE, async () => runDunningLadder());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "30 8 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-dunning" },
  );
}
