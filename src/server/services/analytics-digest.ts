import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import { renderOpsNoticeEmail } from "@/lib/email-ops";
import { getQueue, registerWorker } from "@/server/jobs/queue";
import { isNotificationsPaused } from "@/server/services/notification-gate";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";

const QUEUE = "analytics-weekly-digest" as const;

export interface DigestAggregates {
  periodStart: Date;
  periodEnd: Date;
  totalSessions: number;
  uniqueVisitors: number;
  conversions: number;
  bounces: number;
  abandonedWizard: number;
  conversionRate: number;
  bounceRate: number;
  topLandingPath: { path: string; count: number } | null;
  topCountry: { country: string; count: number } | null;
  topAbandonedVehicle: { label: string; count: number } | null;
  exitIntents: number;
  rageClicks: number;
  vsPrevSessions: number | null;              // pct change vs prior 7d
  vsPrevConversionRate: number | null;         // pp delta vs prior 7d
}

/**
 * Compute the rolling 7-day digest + comparison to the prior 7-day
 * window. Pure reads — the composer never writes. Shared between the
 * BullMQ cron job and (potentially later) a preview endpoint on the
 * Admin settings page.
 */
export async function composeWeeklyDigest(
  client: PrismaClient,
  now: Date = new Date(),
): Promise<DigestAggregates> {
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const prevEnd = periodStart;
  const prevStart = new Date(periodStart.getTime() - 7 * 24 * 60 * 60_000);

  const [
    totalSessions,
    prevTotalSessions,
    uniqueRows,
    conversions,
    prevConversions,
    bounces,
    abandoned,
    landingGroups,
    countryGroups,
    vehicleGroups,
    exitIntents,
    rageClicks,
  ] = await Promise.all([
    client.visitorSession.count({ where: { startedAt: { gte: periodStart, lte: periodEnd } } }),
    client.visitorSession.count({ where: { startedAt: { gte: prevStart, lte: prevEnd } } }),
    client.visitorSession.groupBy({
      by: ["ipHash"],
      where: { startedAt: { gte: periodStart, lte: periodEnd }, ipHash: { not: null } },
    }),
    client.visitorSession.count({
      where: { startedAt: { gte: periodStart, lte: periodEnd }, outcome: "CONVERTED" },
    }),
    client.visitorSession.count({
      where: { startedAt: { gte: prevStart, lte: prevEnd }, outcome: "CONVERTED" },
    }),
    client.visitorSession.count({
      where: { startedAt: { gte: periodStart, lte: periodEnd }, outcome: "BOUNCED" },
    }),
    client.visitorSession.count({
      where: { startedAt: { gte: periodStart, lte: periodEnd }, outcome: "ABANDONED_WIZARD" },
    }),
    client.visitorSession.groupBy({
      by: ["landingPath"],
      where: { startedAt: { gte: periodStart, lte: periodEnd }, landingPath: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { landingPath: "desc" } },
      take: 1,
    }),
    client.visitorSession.groupBy({
      by: ["country"],
      where: { startedAt: { gte: periodStart, lte: periodEnd }, country: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { country: "desc" } },
      take: 1,
    }),
    client.visitorSession.groupBy({
      by: ["vehicleId"],
      where: {
        startedAt: { gte: periodStart, lte: periodEnd },
        outcome: "ABANDONED_WIZARD",
        vehicleId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { vehicleId: "desc" } },
      take: 1,
    }),
    client.visitorEvent.count({
      where: { occurredAt: { gte: periodStart, lte: periodEnd }, kind: "EXIT_INTENT" },
    }),
    client.visitorEvent.count({
      where: { occurredAt: { gte: periodStart, lte: periodEnd }, kind: "RAGE_CLICK" },
    }),
  ]);

  const conversionRate = totalSessions > 0 ? conversions / totalSessions : 0;
  const bounceRate = totalSessions > 0 ? bounces / totalSessions : 0;
  const prevConversionRate = prevTotalSessions > 0 ? prevConversions / prevTotalSessions : 0;

  let topAbandonedVehicle: { label: string; count: number } | null = null;
  const vehicleGroup = vehicleGroups[0];
  if (vehicleGroup?.vehicleId) {
    const v = await client.vehicle.findUnique({
      where: { id: vehicleGroup.vehicleId },
      select: { make: true, model: true, internalCode: true, rego: true },
    });
    const label = v
      ? `${v.make ?? ""} ${v.model ?? ""}`.trim() || v.internalCode || v.rego || vehicleGroup.vehicleId
      : vehicleGroup.vehicleId;
    topAbandonedVehicle = { label, count: vehicleGroup._count._all };
  }

  return {
    periodStart,
    periodEnd,
    totalSessions,
    uniqueVisitors: uniqueRows.length,
    conversions,
    bounces,
    abandonedWizard: abandoned,
    conversionRate,
    bounceRate,
    topLandingPath: landingGroups[0]?.landingPath
      ? { path: landingGroups[0].landingPath, count: landingGroups[0]._count._all }
      : null,
    topCountry: countryGroups[0]?.country
      ? { country: countryGroups[0].country, count: countryGroups[0]._count._all }
      : null,
    topAbandonedVehicle,
    exitIntents,
    rageClicks,
    vsPrevSessions:
      prevTotalSessions === 0
        ? null
        : (totalSessions - prevTotalSessions) / prevTotalSessions,
    vsPrevConversionRate:
      prevTotalSessions === 0 ? null : conversionRate - prevConversionRate,
  };
}

/**
 * Render the digest aggregates as plain-text email body. Kept simple
 * (no HTML) — staff inboxes render plain text reliably and the data
 * is scannable. Future iteration can swap in a React Email template.
 */
export function renderDigestEmail(d: DigestAggregates): { subject: string; text: string } {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const signed = (n: number, unit: "%" | "pp" | "sessions" = "%") => {
    if (n === 0) return `flat`;
    const prefix = n > 0 ? "+" : "";
    if (unit === "pp") return `${prefix}${(n * 100).toFixed(2)}pp`;
    if (unit === "sessions") return `${prefix}${Math.round(n).toLocaleString("en-AU")}`;
    return `${prefix}${(n * 100).toFixed(1)}%`;
  };
  const rangeLabel = `${d.periodStart.toISOString().slice(0, 10)} → ${d.periodEnd.toISOString().slice(0, 10)}`;
  const subject = `[XPERT] Weekly analytics digest — ${d.totalSessions.toLocaleString("en-AU")} sessions, ${pct(d.conversionRate)} converted`;
  const lines = [
    `Weekly analytics digest for ${rangeLabel}`,
    "",
    `Sessions: ${d.totalSessions.toLocaleString("en-AU")}${d.vsPrevSessions != null ? ` (${signed(d.vsPrevSessions)} vs prior week)` : ""}`,
    `Unique visitors: ${d.uniqueVisitors.toLocaleString("en-AU")}`,
    `Conversions: ${d.conversions.toLocaleString("en-AU")}`,
    `Conversion rate: ${pct(d.conversionRate)}${d.vsPrevConversionRate != null ? ` (${signed(d.vsPrevConversionRate, "pp")} vs prior week)` : ""}`,
    `Bounce rate: ${pct(d.bounceRate)}`,
    `Abandoned wizards: ${d.abandonedWizard.toLocaleString("en-AU")}`,
    "",
    `Top landing page: ${d.topLandingPath ? `${d.topLandingPath.path} (${d.topLandingPath.count})` : "—"}`,
    `Top country: ${d.topCountry ? `${d.topCountry.country} (${d.topCountry.count})` : "—"}`,
    `Top abandoned vehicle: ${d.topAbandonedVehicle ? `${d.topAbandonedVehicle.label} (${d.topAbandonedVehicle.count})` : "—"}`,
    "",
    `Exit-intent events: ${d.exitIntents.toLocaleString("en-AU")}`,
    `Rage-click events: ${d.rageClicks.toLocaleString("en-AU")}`,
    "",
    "Full dashboard: /staff/live",
  ];
  return { subject, text: lines.join("\n") };
}

/**
 * Resolve the list of recipients for the digest — every manager+ user
 * with a non-null email. Run-time lookup (not configured in alerts)
 * because managers churn and a hardcoded list drifts.
 */
async function resolveRecipients(client: PrismaClient): Promise<string[]> {
  const users = await client.user.findMany({
    where: {
      role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
      status: "ACTIVE",
    },
    select: { email: true },
  });
  return users.map((u) => u.email).filter((e): e is string => typeof e === "string" && e.length > 0);
}

export async function runWeeklyDigest(): Promise<{ recipients: number; sent: number }> {
  if (await isNotificationsPaused()) {
    logger.info("analytics-digest: suppressed — notifications paused");
    return { recipients: 0, sent: 0 };
  }
  const digest = await composeWeeklyDigest(prisma);

  // Mirror the weekly aggregates into PostHog so the bounce/conversion/
  // top-path trends are chartable there, not just emailed once. distinctId
  // "system" — this is an org-wide rollup, not a per-person event.
  await trackServer({
    event: SERVER_EVENTS.analyticsWeeklyDigest,
    distinctId: "system",
    // Org-wide rollup keyed on the "system" sentinel — not a person.
    processPerson: false,
    properties: {
      periodStart: digest.periodStart.toISOString(),
      periodEnd: digest.periodEnd.toISOString(),
      totalSessions: digest.totalSessions,
      uniqueVisitors: digest.uniqueVisitors,
      conversions: digest.conversions,
      bounces: digest.bounces,
      abandonedWizard: digest.abandonedWizard,
      conversionRate: digest.conversionRate,
      bounceRate: digest.bounceRate,
      exitIntents: digest.exitIntents,
      rageClicks: digest.rageClicks,
      topLandingPath: digest.topLandingPath?.path ?? null,
      topCountry: digest.topCountry?.country ?? null,
      vsPrevSessions: digest.vsPrevSessions,
      vsPrevConversionRate: digest.vsPrevConversionRate,
    },
  });

  const { subject, text } = renderDigestEmail(digest);
  // Render the branded HTML once (identical per run); reuse for all recipients.
  // `<pre>` inside the shell preserves the digest's column-aligned rows. Keep
  // `text` as the plain-text alternative.
  const html = await renderOpsNoticeEmail({ subject, text });
  const recipients = await resolveRecipients(prisma);
  let sent = 0;
  await Promise.all(
    recipients.map(async (to) => {
      try {
        await sendEmail({ to, subject, html, text });
        sent++;
      } catch (err) {
        logger.error({ to, err: String(err) }, "analytics-digest: send failed");
      }
    }),
  );
  logger.info({ recipients: recipients.length, sent }, "analytics-digest: completed");
  return { recipients: recipients.length, sent };
}

/**
 * Register the digest worker + schedule. Runs every Monday at 08:00
 * Brisbane so Sunday's tail is included and managers see it first
 * thing Monday.
 */
export function startAnalyticsDigestScheduler(): void {
  registerWorker(QUEUE, async () => runWeeklyDigest());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "weekly",
    {},
    {
      repeat: { pattern: "0 8 * * 1", tz: "Australia/Brisbane" },
      jobId: "analytics-weekly-digest",
    },
  );
}
