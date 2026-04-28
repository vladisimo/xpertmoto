import { render as renderEmail } from "@react-email/render";
import { createElement } from "react";

import DebtReminderEmail from "../../../emails/debt-reminder";
import { DEBT_REMINDER_RULES } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { debtorsList, type Debtor } from "@/server/services/admin-risk-signals";
import { sendNotification } from "@/server/services/notification-sender";
import { getBranding } from "@/lib/branding";

import { getQueue, registerWorker } from "./queue";

const QUEUE = "debt-reminder" as const;

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

/**
 * Build the rendered email + plain-text fallback for one debtor. Shared
 * between the daily job and the manual admin trigger so both deliver the
 * same look + breakdown.
 */
export async function buildDebtReminderEmail(
  d: Debtor,
  siteName: string,
  portalUrl: string,
): Promise<{ subject: string; title: string; body: string; html: string }> {
  const total = AUD.format(d.totalOwed);
  const parts: string[] = [];
  if (d.bookingDebt > 0) parts.push(`${AUD.format(d.bookingDebt)} on open bookings`);
  if (d.invoiceDebt > 0) parts.push(`${AUD.format(d.invoiceDebt)} in overdue invoices`);
  if (d.infringementDebt > 0)
    parts.push(`${AUD.format(d.infringementDebt)} in outstanding tolls / infringements`);
  const breakdown = parts.length ? ` (${parts.join(", ")})` : "";
  const html = await renderEmail(
    createElement(DebtReminderEmail, {
      customerName: d.firstName,
      totalOwed: total,
      bookingDebt: d.bookingDebt > 0 ? AUD.format(d.bookingDebt) : null,
      invoiceDebt: d.invoiceDebt > 0 ? AUD.format(d.invoiceDebt) : null,
      infringementDebt: d.infringementDebt > 0 ? AUD.format(d.infringementDebt) : null,
      portalUrl,
      siteName,
    }),
  );
  return {
    subject: `${siteName} — ${total} outstanding on your account`,
    title: "Outstanding balance reminder",
    body:
      `Hi ${d.firstName}, our records show you have a balance of ${total} outstanding with ${siteName}${breakdown}. ` +
      `Please log in to your account to settle this as soon as possible, or reply to this message if you believe this is in error.`,
    html,
  };
}

/**
 * Daily at 09:00 AEST. For every customer with an outstanding balance
 * (booking.balanceDue + overdue invoices + unpaid infringements), send one
 * email+SMS reminder. Dedup: skip anyone who received a DEBT_REMINDER
 * within the cooldown window.
 */
export async function runDebtReminder(): Promise<number> {
  const debtors = await debtorsList(500);
  const cutoff = new Date(Date.now() - DEBT_REMINDER_RULES.cooldownDays * 86_400_000);
  const { siteName } = await getBranding();
  const portalUrl = `${
    process.env.AUTH_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  }/dashboard`;
  let sent = 0;

  for (const d of debtors) {
    if (d.totalOwed < DEBT_REMINDER_RULES.minOutstandingAud) continue;
    if (d.lastReminderAt && d.lastReminderAt > cutoff) continue;

    const { subject, title, body, html } = await buildDebtReminderEmail(d, siteName, portalUrl);
    const res = await sendNotification({
      userId: d.customerId,
      type: "DEBT_REMINDER",
      channels: d.phone ? ["EMAIL", "SMS"] : ["EMAIL"],
      subject,
      title,
      body,
      html,
      templateKey: "debt-reminder",
      data: {
        totalOwed: d.totalOwed,
        bookingDebt: d.bookingDebt,
        invoiceDebt: d.invoiceDebt,
        infringementDebt: d.infringementDebt,
        trigger: "scheduled",
      },
    });
    if (res.results.some((r) => r.status === "SENT")) sent += 1;
  }

  logger.info({ debtors: debtors.length, sent }, "debt-reminder completed");
  return sent;
}

export function startDebtReminderScheduler() {
  registerWorker(QUEUE, async () => runDebtReminder());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "0 9 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
