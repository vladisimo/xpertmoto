import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { getSecret, getString } from "@/lib/integration-config";
import { logger } from "@/lib/logger";
import { getBranding } from "@/lib/branding";
import { recordEmailSend, type EmailLogContext } from "@/server/services/email-cost";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  /** Pre-rendered HTML body. Prefer passing `react` instead. */
  html?: string;
  /** Plain-text fallback. */
  text?: string;
  /** React Email component (will be rendered to HTML + text). */
  react?: ReactElement;
  /** Deprecated alias for `text` — kept for back-compat with older callers. */
  body?: string;
  from?: string;
  /**
   * Files to attach. Resend's envelope ceiling is ~40 MB; we cap our combined
   * payload at MAX_ATTACHMENT_BYTES (10 MB) and warn-and-drop oversized
   * attachments rather than failing the send — the body still goes out so
   * the customer at least learns the document exists, and the portal copy
   * remains the source of truth.
   */
  attachments?: EmailAttachment[];
  /** Optional attribution for the Platform > Email cost tab. */
  log?: EmailLogContext;
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function trimAttachments(
  attachments: EmailAttachment[] | undefined,
): EmailAttachment[] {
  if (!attachments?.length) return [];
  const kept: EmailAttachment[] = [];
  let running = 0;
  for (const att of attachments) {
    const size = att.content.length;
    if (running + size > MAX_ATTACHMENT_BYTES) {
      logger.warn(
        {
          filename: att.filename,
          sizeBytes: size,
          runningTotalBytes: running,
          capBytes: MAX_ATTACHMENT_BYTES,
        },
        "sendEmail: dropping attachment over total size cap",
      );
      continue;
    }
    kept.push(att);
    running += size;
  }
  return kept;
}

/**
 * Derive a plain-text fallback from an HTML email body. Good enough for
 * Gmail/Outlook spam-filter heuristics that penalise HTML-only messages —
 * not meant to be a pixel-perfect text rendering. No new dependency.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type SendResult = { id?: string; via: "resend" | "smtp" | "console" };

async function fromAddress(override?: string): Promise<string> {
  if (override) return override;
  const branding = await getBranding();
  const raw =
    (await getString("integration:resend:from", "EMAIL_FROM")) ??
    "no-reply@scootering.com.au";
  // If the caller (or env var) already provided a "Name <addr>" formatted
  // string, respect it. Otherwise prepend the branding site name so
  // recipients see the current trading name as the sender.
  if (/^\s*.+<.+@.+>\s*$/.test(raw)) return raw;
  return `${branding.siteName} <${raw}>`;
}

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const html = payload.html ?? (payload.react ? await render(payload.react) : undefined);
  const text =
    payload.text ??
    payload.body ??
    (payload.react ? await render(payload.react, { plainText: true }) : undefined);

  if (!html && !text) {
    throw new Error("sendEmail: must provide html, text, body, or react");
  }

  const from = await fromAddress(payload.from);
  const logCtx = payload.log ?? {};
  const attachments = trimAttachments(payload.attachments);

  // 1. Resend (preferred when API key set)
  const resendKey = await getSecret("integration:resend:apiKey", "RESEND_API_KEY");
  if (resendKey) {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);
    // Resend requires one of html or text (not both empty). Pass undefined
    // when a part is missing so clients don't render an empty alternative.
    const res = await resend.emails.send({
      from,
      to: payload.to,
      subject: payload.subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(attachments.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString("base64"),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
      // At least one of html/text is required by Resend; we guarded this
      // above with the "must provide" check.
    } as Parameters<typeof resend.emails.send>[0]);
    if (res.error) {
      await recordEmailSend({
        provider: "resend",
        toEmail: payload.to,
        fromEmail: from,
        subject: payload.subject,
        status: "failed",
        errorMessage: res.error.message,
        ctx: logCtx,
      });
      throw new Error(`Resend failed: ${res.error.message}`);
    }
    await recordEmailSend({
      provider: "resend",
      providerMessageId: res.data?.id ?? null,
      toEmail: payload.to,
      fromEmail: from,
      subject: payload.subject,
      status: "sent",
      ctx: logCtx,
    });
    return { id: res.data?.id, via: "resend" };
  }

  // 2. SMTP (Mailpit in dev, any SMTP server in prod)
  if (process.env.SMTP_HOST) {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      tls: {
        // Opt-out for dev/staging servers with self-signed or private-CA
        // certificates. Default is strict verification.
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
      },
    });
    const info = await transport.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html,
      text,
      ...(attachments.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });
    await recordEmailSend({
      provider: "smtp",
      providerMessageId: info.messageId ?? null,
      toEmail: payload.to,
      fromEmail: from,
      subject: payload.subject,
      status: "sent",
      ctx: logCtx,
    });
    return { id: info.messageId, via: "smtp" };
  }

  // 3. Dev fallback — route through pino so PII (recipient email) is redacted
  logger.info(
    {
      email: payload.to,
      subject: payload.subject,
      body: text ?? html,
      attachmentNames: attachments.map((a) => a.filename),
    },
    "dev email (no provider configured)",
  );
  await recordEmailSend({
    provider: "console",
    toEmail: payload.to,
    fromEmail: from,
    subject: payload.subject,
    status: "sent",
    ctx: logCtx,
  });
  return { via: "console" };
}
