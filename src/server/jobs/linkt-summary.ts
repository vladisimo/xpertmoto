import { createElement } from "react";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatCurrency } from "@/lib/utils";
import { getBranding } from "@/lib/branding";
import { sendEmail } from "@/lib/email";
import { getTollSummaryStats, type TollSummaryRow } from "@/server/services/linkt";

import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "linkt-summary" as const;

const STATUS_LABEL: Record<TollSummaryRow["status"], string> = {
  MATCHED: "Matched",
  NO_BOOKING: "No booking",
  UNMATCHED: "Unmatched",
};

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const appUrl = () => (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "https://xpertmoto.com.au").replace(/\/$/, "");

/**
 * Weekly toll-sync digest — emails ADMIN / MANAGER back-office users an
 * all-time toll summary plus a last-7-days table. Replaces the orphaned Sentry
 * "no successful etoll-sync completion" alert with a branded report. Returns
 * the number of emails sent.
 */
export async function runWeeklyTollSummary(): Promise<number> {
  const recipients = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { email: true },
  });
  const emails = recipients.map((r) => r.email).filter((e): e is string => !!e);
  if (emails.length === 0) return 0;

  const now = new Date();
  const stats = await getTollSummaryStats(prisma, { now });
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (stats.recentTruncated) {
    logger.info(
      { shown: stats.recent.length },
      "linkt-summary: recent toll rows truncated to cap for the digest email",
    );
  }

  const { siteName } = await getBranding();
  const healthy = stats.lastSync?.status === "SUCCESS" && stats.unmatchedToBooking === 0;

  const props = {
    siteName,
    periodLabel: `${fmtDate(since)} – ${fmtDate(now)}`,
    totalTolls: stats.totalTolls.toLocaleString("en-AU"),
    matchedToBooking: stats.matchedToBooking.toLocaleString("en-AU"),
    unmatchedToBooking: stats.unmatchedToBooking.toLocaleString("en-AU"),
    withPlate: stats.withPlate.toLocaleString("en-AU"),
    withoutPlate: stats.withoutPlate.toLocaleString("en-AU"),
    lastSyncStatus: stats.lastSync?.status ?? null,
    lastSyncAt: stats.lastSync?.finishedAt ? fmtDateTime(stats.lastSync.finishedAt) : null,
    healthy,
    truncated: stats.recentTruncated,
    rows: stats.recent.map((r) => ({
      date: fmtDateTime(r.eventAt),
      plate: r.plate,
      location: r.tollpoint,
      amount: formatCurrency(r.amountCents / 100),
      status: STATUS_LABEL[r.status],
      booking: r.matchedBooking,
    })),
    portalUrl: `${appUrl()}/staff/fleet/tolls`,
  };

  const subject = `${siteName} — weekly toll summary`;
  // Render the branded React Email once; the content is identical per recipient.
  const { default: LinktSyncSummary } = await import("../../../emails/linkt-sync-summary");
  const { render } = await import("@react-email/render");
  const html = await render(createElement(LinktSyncSummary, props));
  const text = [
    `${siteName} — weekly toll summary`,
    "",
    `Total tolls: ${props.totalTolls}`,
    `Matched to a booking: ${props.matchedToBooking}`,
    `Not matched to a booking: ${props.unmatchedToBooking}`,
    `With a registration plate: ${props.withPlate}`,
    `No registration plate: ${props.withoutPlate}`,
    "",
    props.lastSyncStatus
      ? `Last sync: ${props.lastSyncStatus}${props.lastSyncAt ? ` (${props.lastSyncAt})` : ""}`
      : "No sync has completed yet.",
    "",
    `Toll reconciliation: ${props.portalUrl}`,
  ].join("\n");

  // Sent via sendEmail directly (not sendNotification) — this is an internal
  // ops digest, mirroring analytics-alert.ts. Avoids adding a NotificationType
  // enum value (a schema change) for an admin-only email.
  let sent = 0;
  await Promise.all(
    emails.map((to) =>
      sendEmail({ to, subject, html, text, log: { purpose: "linkt-weekly-summary" } })
        .then(() => {
          sent++;
        })
        .catch((err) =>
          logger.error({ to, err: String(err) }, "linkt-summary: email failed"),
        ),
    ),
  );
  logger.info({ sent, recipients: emails.length }, "linkt-summary: weekly toll digest sent");
  return sent;
}

/**
 * Register the BullMQ worker + cron schedule. Called from worker.ts at boot.
 * Fires Monday 08:00 Brisbane, matching the weekly revenue summary.
 */
export function startLinktSummaryScheduler(): void {
  registerWorker(QUEUE, async () => runWeeklyTollSummary());
  monitorCron(QUEUE, "0 8 * * 1", "Australia/Brisbane");
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "weekly",
    {},
    { repeat: { pattern: "0 8 * * 1", tz: "Australia/Brisbane" }, jobId: "repeat-weekly" },
  );
}
