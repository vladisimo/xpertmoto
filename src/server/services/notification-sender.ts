import type {
  CampaignRecipientStatus,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
  Prisma,
} from "@prisma/client";

import { htmlToText, sendEmail, type EmailAttachment } from "@/lib/email";
import { getEmailBrandingVars } from "@/lib/email-branding-vars";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { sendPushToUser } from "@/lib/push";
import { sendSms } from "@/lib/sms";
import { downloadFile } from "@/lib/storage";
import { renderTemplate } from "@/server/trpc/router/communication";

import { canSend, categoryForType, type ConsentGateResult } from "./consent";
import { evaluateNotificationGate } from "./notification-gate";

/**
 * A reference to a document customer-facing emails can attach. The resolver
 * (see `resolveAttachments`) loads the PDF bytes from S3/MinIO at send time
 * so callers don't have to plumb buffers through their event handlers.
 *
 * Resolution failures (missing PDF, storage outage) are logged and dropped
 * — the email body still ships and the portal copy remains the source of
 * truth.
 */
export type AttachmentRef =
  | { kind: "invoice"; invoiceId: string }
  | { kind: "adjustment-note"; adjustmentNoteId: string }
  | { kind: "rental-agreement"; agreementId: string }
  | { kind: "return-assessment"; assessmentId: string }
  | { kind: "receipt"; paymentId: string };

async function loadKey(key: string, label: string): Promise<Buffer | null> {
  try {
    return await downloadFile(key);
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message, key, label },
      "resolveAttachments: failed to download PDF",
    );
    return null;
  }
}

async function resolveOne(
  ref: AttachmentRef,
): Promise<EmailAttachment | null> {
  switch (ref.kind) {
    case "invoice": {
      const row = await prisma.invoice.findUnique({
        where: { id: ref.invoiceId },
        select: { invoiceNumber: true, pdfKey: true },
      });
      if (!row?.pdfKey) return null;
      const content = await loadKey(row.pdfKey, `invoice:${ref.invoiceId}`);
      if (!content) return null;
      return {
        filename: `tax-invoice-${row.invoiceNumber}.pdf`,
        content,
        contentType: "application/pdf",
      };
    }
    case "adjustment-note": {
      const row = await prisma.adjustmentNote.findUnique({
        where: { id: ref.adjustmentNoteId },
        select: { adjustmentNumber: true, pdfKey: true, type: true },
      });
      if (!row?.pdfKey) return null;
      const content = await loadKey(
        row.pdfKey,
        `adjustment-note:${ref.adjustmentNoteId}`,
      );
      if (!content) return null;
      const docKind = row.type === "DECREASE" ? "credit-note" : "debit-note";
      return {
        filename: `${docKind}-${row.adjustmentNumber}.pdf`,
        content,
        contentType: "application/pdf",
      };
    }
    case "rental-agreement": {
      const row = await prisma.rentalAgreement.findUnique({
        where: { id: ref.agreementId },
        select: { agreementNumber: true, pdfKey: true },
      });
      if (!row?.pdfKey) return null;
      const content = await loadKey(
        row.pdfKey,
        `rental-agreement:${ref.agreementId}`,
      );
      if (!content) return null;
      return {
        filename: `rental-agreement-${row.agreementNumber}.pdf`,
        content,
        contentType: "application/pdf",
      };
    }
    case "return-assessment": {
      const row = await prisma.returnAssessment.findUnique({
        where: { id: ref.assessmentId },
        select: { assessmentNumber: true, pdfKey: true },
      });
      if (!row?.pdfKey) return null;
      const content = await loadKey(
        row.pdfKey,
        `return-assessment:${ref.assessmentId}`,
      );
      if (!content) return null;
      return {
        filename: `return-assessment-${row.assessmentNumber}.pdf`,
        content,
        contentType: "application/pdf",
      };
    }
    case "receipt": {
      const row = await prisma.payment.findUnique({
        where: { id: ref.paymentId },
        select: { receiptNumber: true, receiptPdfKey: true },
      });
      if (!row?.receiptPdfKey || !row.receiptNumber) return null;
      const content = await loadKey(
        row.receiptPdfKey,
        `receipt:${ref.paymentId}`,
      );
      if (!content) return null;
      return {
        filename: `receipt-${row.receiptNumber}.pdf`,
        content,
        contentType: "application/pdf",
      };
    }
  }
}

async function resolveAttachments(
  refs: readonly AttachmentRef[] | undefined,
): Promise<EmailAttachment[]> {
  if (!refs?.length) return [];
  const resolved = await Promise.all(refs.map((r) => resolveOne(r)));
  return resolved.filter((a): a is EmailAttachment => a !== null);
}

export type SendNotificationInput = {
  userId: string;
  type: NotificationType;
  category?: NotificationCategory;
  channels: readonly NotificationChannel[];
  subject?: string;
  title?: string;
  body: string;
  html?: string;
  data?: Prisma.InputJsonValue;
  templateKey?: string;
  bookingId?: string;
  campaignId?: string;
  sentById?: string;
  attachments?: readonly AttachmentRef[];
  /**
   * Per-recipient template variables (e.g. `{ firstName: "Alex" }`).
   * Merged with global branding vars (logo URL, policy URLs, legal name,
   * ABN, etc.) before the template is rendered. Caller-supplied values
   * take precedence.
   */
  variables?: Record<string, string>;
  /**
   * Optional idempotency key. When set, sending the same key twice within
   * DEDUP_WINDOW_MS is a no-op — guards against job-queue restarts or
   * double-fires of "24h before pickup" reminders. Typical shape:
   * `"booking-reminder-24h:<bookingId>"`, `"payment-receipt:<paymentId>"`.
   */
  dedupKey?: string;
};

export type ChannelResult =
  | {
      channel: NotificationChannel;
      status: "SENT" | "SKIPPED" | "FAILED" | "SUPPRESSED";
      providerMessageId?: string;
      reason?: string;
    };

export type SendNotificationResult = {
  results: ChannelResult[];
  logIds: string[];
  notificationIds: string[];
};

const toCampaignStatus = (ok: boolean): CampaignRecipientStatus =>
  ok ? "SENT" : "FAILED";

const toNotificationStatus = (ok: boolean) => (ok ? "SENT" : "FAILED");

// Dedup ledger. Redis-backed so every process that sends (web container,
// worker, future replicas) shares one ledger — the previous module-scope
// Map deduped per-process only, so the same dedupKey fired from the
// webhook (web) and a job (worker) sent twice. The Map stays as the local
// fast path and the no-Redis dev fallback. Mark happens only after a
// channel actually SENT (see call site), so failed sends remain retryable.
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEDUP_PREFIX = "notif-dedup:";
const sentDedupKeys = new Map<string, number>();

async function hasRecentlySent(key: string): Promise<boolean> {
  const at = sentDedupKeys.get(key);
  if (at !== undefined) {
    if (Date.now() - at <= DEDUP_WINDOW_MS) return true;
    sentDedupKeys.delete(key);
  }
  const redis = getRedis();
  if (!redis) return false;
  try {
    return (await redis.exists(`${DEDUP_PREFIX}${key}`)) === 1;
  } catch {
    // Redis down → local Map is the best we have; prefer sending twice
    // over not sending at all.
    return false;
  }
}

async function markSent(key: string): Promise<void> {
  sentDedupKeys.set(key, Date.now());
  // Prevent unbounded growth. 10k entries at ~100 bytes = ~1MB — fine.
  if (sentDedupKeys.size > 10_000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, t] of sentDedupKeys) {
      if (t < cutoff) sentDedupKeys.delete(k);
    }
  }
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`${DEDUP_PREFIX}${key}`, "1", "EX", Math.floor(DEDUP_WINDOW_MS / 1000));
  } catch {
    // non-fatal — the local entry still covers this process.
  }
}

export async function sendNotification(
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  const category = input.category ?? categoryForType(input.type);
  const results: ChannelResult[] = [];
  const logIds: string[] = [];
  const notificationIds: string[] = [];

  if (input.dedupKey && (await hasRecentlySent(input.dedupKey))) {
    logger.info(
      { dedupKey: input.dedupKey, type: input.type },
      "sendNotification: deduped, already sent within window",
    );
    return {
      results: input.channels.map((c) => ({ channel: c, status: "SKIPPED", reason: "DEDUPED" })),
      logIds,
      notificationIds,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, phone: true },
  });
  if (!user) {
    logger.warn({ userId: input.userId, type: input.type }, "sendNotification: user not found");
    return {
      results: input.channels.map((c) => ({ channel: c, status: "FAILED", reason: "CUSTOMER_NOT_FOUND" })),
      logIds,
      notificationIds,
    };
  }

  // Merge global branding vars (logo URL, policy URLs, legal name, ABN,
  // current year, etc.) with per-recipient caller variables. Caller wins
  // on conflict — e.g. a test send that wants to override `supportEmail`
  // or a marketing batch that injects a tokenised unsubscribe URL.
  const brandingVars = await getEmailBrandingVars();
  const vars: Record<string, string> = { ...brandingVars, ...(input.variables ?? {}) };
  const renderedSubject = renderTemplate(input.subject ?? "", vars, "PLAIN_TEXT");
  const renderedTitle = renderTemplate(input.title ?? "", vars, "PLAIN_TEXT");
  const renderedBody = renderTemplate(input.body, vars, "PLAIN_TEXT");
  const renderedHtml = input.html
    ? renderTemplate(input.html, vars, "HTML")
    : undefined;
  // Overlay the rendered strings onto the input so downstream log /
  // notification writes capture what was actually sent, not the template.
  const loggedInput: SendNotificationInput = {
    ...input,
    subject: renderedSubject || undefined,
    title: renderedTitle || undefined,
    body: renderedBody,
    html: renderedHtml,
  };

  for (const channel of input.channels) {
    const pauseGate = await evaluateNotificationGate(channel);
    if (!pauseGate.send) {
      const reason = pauseGate.reason;
      logger.info(
        { userId: input.userId, type: input.type, channel, reason },
        "sendNotification: suppressed by admin gate",
      );
      results.push({ channel, status: "SUPPRESSED", reason });
      const notifId = await prisma.notification
        .create({
          data: {
            userId: input.userId,
            type: input.type,
            category,
            channel,
            title: renderedTitle || renderedSubject || input.type,
            body: renderedBody,
            data: {
              ...((input.data ?? {}) as Record<string, unknown>),
              suppressedReason: reason,
            } as Prisma.InputJsonValue,
            status: "SUPPRESSED",
          },
          select: { id: true },
        })
        .then((n) => n.id)
        .catch((err) => {
          logger.warn({ err: err?.message }, "suppressed notification insert failed");
          return null;
        });
      if (notifId) notificationIds.push(notifId);
      const logId = await writeLog({
        input: loggedInput,
        channel,
        category,
        userId: input.userId,
        bookingId: input.bookingId,
        campaignId: input.campaignId,
        status: "FAILED",
        errorMessage: `SUPPRESSED:${reason}`,
      });
      if (logId) logIds.push(logId);
      continue;
    }

    const gate: ConsentGateResult = await canSend({
      customerId: input.userId,
      type: input.type,
      category,
      channel,
    });
    if (!gate.allowed) {
      results.push({ channel, status: "SKIPPED", reason: gate.reason });
      await writeLog({
        input: loggedInput,
        channel,
        category,
        userId: input.userId,
        bookingId: input.bookingId,
        campaignId: input.campaignId,
        status: "OPT_OUT",
        errorMessage: gate.reason,
      }).then((id) => id && logIds.push(id));
      continue;
    }

    try {
      // For EMAIL: prefer rendered HTML body; auto-derive plain-text
      // alternative if the caller didn't supply one, so HTML emails ship
      // with `multipart/alternative` without the caller remembering.
      const emailText =
        channel === "EMAIL" && renderedHtml && !input.body
          ? htmlToText(renderedHtml)
          : renderedBody;
      // Resolve attachments only for EMAIL — SMS/push/in-app can't carry
      // PDFs, and resolving means an S3/MinIO download per attachment.
      const emailAttachments =
        channel === "EMAIL"
          ? await resolveAttachments(input.attachments)
          : [];
      const providerId = await dispatch(channel, {
        to: channel === "EMAIL" ? user.email ?? "" : user.phone ?? "",
        userId: input.userId,
        subject: renderedSubject || renderedTitle,
        body: emailText,
        html: renderedHtml,
        title: renderedTitle || renderedSubject,
        attachments: emailAttachments,
      });
      results.push({ channel, status: "SENT", providerMessageId: providerId });

      // Provider message ids get merged into `data` so downstream status
      // webhooks (Twilio's status callback, Resend's email events) can
      // find the row by `data.twilioSid` / `data.resendId` and update
      // status to DELIVERED / FAILED asynchronously.
      const providerData =
        providerId && channel === "SMS"
          ? { twilioSid: providerId }
          : providerId && channel === "EMAIL"
            ? { resendId: providerId }
            : {};
      const mergedData = {
        ...((input.data ?? {}) as Record<string, unknown>),
        ...providerData,
      };

      const notifId = await prisma.notification
        .create({
          data: {
            userId: input.userId,
            type: input.type,
            category,
            channel,
            title: renderedTitle || renderedSubject || input.type,
            body: renderedBody,
            data: mergedData as Prisma.InputJsonValue,
            status: toNotificationStatus(true),
            sentAt: new Date(),
          },
          select: { id: true },
        })
        .then((n) => n.id)
        .catch((err) => {
          logger.warn({ err: err?.message }, "notification insert failed");
          return null;
        });
      if (notifId) notificationIds.push(notifId);

      const logId = await writeLog({
        input: loggedInput,
        channel,
        category,
        userId: input.userId,
        bookingId: input.bookingId,
        campaignId: input.campaignId,
        status: toCampaignStatus(true),
        providerMessageId: providerId,
      });
      if (logId) logIds.push(logId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, type: input.type, channel }, "sendNotification: dispatch failed");
      results.push({ channel, status: "FAILED", reason: message });
      const logId = await writeLog({
        input: loggedInput,
        channel,
        category,
        userId: input.userId,
        bookingId: input.bookingId,
        campaignId: input.campaignId,
        status: toCampaignStatus(false),
        errorMessage: message,
      });
      if (logId) logIds.push(logId);
    }
  }

  if (input.dedupKey && results.some((r) => r.status === "SENT")) {
    await markSent(input.dedupKey);
  }

  return { results, logIds, notificationIds };
}

async function dispatch(
  channel: NotificationChannel,
  args: {
    to: string;
    userId: string;
    subject: string;
    body: string;
    html?: string;
    title: string;
    attachments?: EmailAttachment[];
  },
): Promise<string | undefined> {
  switch (channel) {
    case "EMAIL": {
      const res = await sendEmail({
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.body,
        attachments: args.attachments,
      });
      return res.id;
    }
    case "SMS": {
      const res = await sendSms({ to: args.to, body: args.body });
      return res.sid;
    }
    case "PUSH": {
      const delivered = await sendPushToUser(args.userId, {
        title: args.title,
        body: args.body,
      });
      return delivered > 0 ? `push:${delivered}` : undefined;
    }
    case "IN_APP":
      return undefined;
    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

async function writeLog(args: {
  input: SendNotificationInput;
  channel: NotificationChannel;
  category: NotificationCategory;
  userId: string;
  bookingId?: string;
  campaignId?: string;
  status: CampaignRecipientStatus;
  providerMessageId?: string;
  errorMessage?: string;
}): Promise<string | null> {
  try {
    const log = await prisma.communicationLog.create({
      data: {
        customerId: args.userId,
        bookingId: args.bookingId ?? null,
        campaignId: args.campaignId ?? null,
        type: args.input.type,
        category: args.category,
        channel: args.channel,
        direction: "OUTBOUND",
        subject: args.input.subject ?? args.input.title ?? null,
        body: args.input.body,
        sentById: args.input.sentById ?? null,
        templateUsed: args.input.templateKey ?? null,
        providerMessageId: args.providerMessageId ?? null,
        status: args.status,
        errorMessage: args.errorMessage ?? null,
        attachmentRefs: (args.input.attachments ?? []) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return log.id;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "communicationLog insert failed");
    return null;
  }
}
