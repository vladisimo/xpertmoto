import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import {
  ALERT_METRIC_LABEL,
  cooldownElapsed,
  evaluateOperator,
  type AlertMetric,
  type AlertOperator,
} from "@/lib/analytics/segments";
import { getQueue, registerWorker } from "@/server/jobs/queue";

const QUEUE = "analytics-alert" as const;
const AT_RISK_WINDOW_MS = 5 * 60_000;

/**
 * Compute a single metric value from the analytics pipeline. Shared
 * between the BullMQ evaluator and the `alertPreview` tRPC procedure
 * so the two never drift out of sync.
 *
 * Keep this lean — each metric is a single query / groupBy call. Add
 * new metrics by extending the `AlertMetric` union in
 * `src/lib/analytics/segments.ts` and a case here.
 */
export async function evaluateAlertMetric(
  client: PrismaClient,
  metric: AlertMetric,
): Promise<number> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);

  switch (metric) {
    case "sessions_last_hour":
      return client.visitorSession.count({ where: { startedAt: { gte: hourAgo } } });
    case "bounces_last_hour":
      return client.visitorSession.count({
        where: { startedAt: { gte: hourAgo }, outcome: "BOUNCED" },
      });
    case "conversions_last_hour":
      return client.visitorSession.count({
        where: { startedAt: { gte: hourAgo }, outcome: "CONVERTED" },
      });
    case "abandoned_wizard_last_hour":
      return client.visitorSession.count({
        where: { startedAt: { gte: hourAgo }, outcome: "ABANDONED_WIZARD" },
      });
    case "exit_intents_last_hour":
      return client.visitorEvent.count({
        where: { occurredAt: { gte: hourAgo }, kind: "EXIT_INTENT" },
      });
    case "rage_clicks_last_hour":
      return client.visitorEvent.count({
        where: { occurredAt: { gte: hourAgo }, kind: "RAGE_CLICK" },
      });
    case "dead_clicks_last_hour":
      return client.visitorEvent.count({
        where: { occurredAt: { gte: hourAgo }, kind: "DEAD_CLICK" },
      });
    case "at_risk_count": {
      // Sessions currently in the wizard that fired EXIT_INTENT in
      // the last 5 min — matches the Live-tab at-risk flag.
      const cutoff = new Date(Date.now() - AT_RISK_WINDOW_MS);
      const rows = await client.visitorEvent.groupBy({
        by: ["sessionId"],
        where: { kind: "EXIT_INTENT", occurredAt: { gte: cutoff } },
      });
      if (rows.length === 0) return 0;
      return client.visitorSession.count({
        where: {
          id: { in: rows.map((r) => r.sessionId) },
          wizardStep: { not: null },
        },
      });
    }
    case "conversion_rate_last_24h": {
      const total = await client.visitorSession.count({
        where: { startedAt: { gte: dayAgo } },
      });
      if (total === 0) return 0;
      const converted = await client.visitorSession.count({
        where: { startedAt: { gte: dayAgo }, outcome: "CONVERTED" },
      });
      return converted / total;
    }
    case "bounce_rate_last_24h": {
      const total = await client.visitorSession.count({
        where: { startedAt: { gte: dayAgo } },
      });
      if (total === 0) return 0;
      const bounced = await client.visitorSession.count({
        where: { startedAt: { gte: dayAgo }, outcome: "BOUNCED" },
      });
      return bounced / total;
    }
    case "avg_engagement_score_last_24h": {
      const agg = await client.visitorSession.aggregate({
        where: { startedAt: { gte: dayAgo }, engagementScore: { not: null } },
        _avg: { engagementScore: true },
      });
      return agg._avg.engagementScore ?? 0;
    }
  }
}

/**
 * Evaluate every active alert, fire notifications for those that
 * trigger and whose cooldown window has elapsed. Returns a summary
 * that the BullMQ worker logs for audit.
 */
export async function runAnalyticsAlertEvaluation(): Promise<{
  checked: number;
  fired: number;
}> {
  const alerts = await prisma.analyticsAlert.findMany({ where: { isActive: true } });
  const now = new Date();
  let fired = 0;
  for (const alert of alerts) {
    try {
      const value = await evaluateAlertMetric(prisma, alert.metric as AlertMetric);
      const crossed = evaluateOperator(value, alert.operator as AlertOperator, alert.threshold);
      const mayFire = crossed && cooldownElapsed(alert.lastFiredAt, alert.cooldownMinutes, now);
      await prisma.analyticsAlert.update({
        where: { id: alert.id },
        data: {
          lastValue: value,
          lastCheckedAt: now,
          ...(mayFire ? { lastFiredAt: now } : {}),
        },
      });
      if (mayFire) {
        await sendAlertEmails(alert, value);
        fired++;
      }
    } catch (err) {
      logger.error(
        { alertId: alert.id, metric: alert.metric, err: String(err) },
        "analytics-alert: evaluation failed",
      );
    }
  }
  logger.info({ checked: alerts.length, fired }, "analytics-alert: completed");
  return { checked: alerts.length, fired };
}

async function sendAlertEmails(
  alert: { id: string; name: string; metric: string; operator: string; threshold: number; notifyEmails: unknown },
  value: number,
): Promise<void> {
  const emails = Array.isArray(alert.notifyEmails)
    ? (alert.notifyEmails as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  if (emails.length === 0) return;
  const label = ALERT_METRIC_LABEL[alert.metric as AlertMetric] ?? alert.metric;
  const subject = `[XPERT] Alert: ${alert.name}`;
  const body = [
    `Alert "${alert.name}" crossed its threshold.`,
    "",
    `Metric: ${label}`,
    `Condition: ${alert.operator} ${alert.threshold}`,
    `Observed: ${value.toLocaleString("en-AU", { maximumFractionDigits: 3 })}`,
    `Alert ID: ${alert.id}`,
    "",
    "View the live dashboard to investigate: /staff/live",
  ].join("\n");
  await Promise.all(
    emails.map((to) =>
      sendEmail({ to, subject, text: body }).catch((err) =>
        logger.error({ alertId: alert.id, to, err: String(err) }, "analytics-alert: email failed"),
      ),
    ),
  );
}

/**
 * Register the BullMQ worker + cron schedule. Called from
 * `src/server/jobs/worker.ts` at app boot. Fires every 5 minutes.
 */
export function startAnalyticsAlertScheduler(): void {
  registerWorker(QUEUE, async () => runAnalyticsAlertEvaluation());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "tick",
    {},
    {
      repeat: { pattern: "*/5 * * * *", tz: "Australia/Brisbane" },
      jobId: "analytics-alert-every-5m",
    },
  );
}
