import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSecret } from "@/lib/integration-config";
import { withAudit } from "@/lib/with-audit";
import { updateEmailStatus } from "@/server/services/email-cost";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";

const DELIVERED_TYPES = new Set(["email.delivered"]);
const FAILED_TYPES = new Set(["email.bounced", "email.complained", "email.failed"]);

/**
 * Resend webhooks are signed via Svix. Accept either the Svix signature header
 * (production) or fall back to a shared-secret header in dev. Only
 * RESEND_WEBHOOK_SECRET / SVIX_SECRET must be present to enforce verification.
 */
function verifySvix(
  secret: string,
  msgId: string,
  timestamp: string,
  sig: string,
  body: string,
): boolean {
  const secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");
  const signed = `${msgId}.${timestamp}.${body}`;
  const expected =
    "v1," +
    crypto.createHmac("sha256", secretBytes).update(signed).digest("base64");
  return sig
    .split(" ")
    .some((candidate) => {
      if (!candidate.startsWith("v1,")) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
      } catch {
        return false;
      }
    });
}

export const POST = withAudit({ name: "webhooks.resend", entity: "ResendWebhook" }, handlePost);

async function handlePost(req: Request) {
  const raw = await req.text();
  const secret = await getSecret("integration:resend:webhookSecret", "RESEND_WEBHOOK_SECRET");

  if (secret) {
    const msgId = req.headers.get("svix-id");
    const ts = req.headers.get("svix-timestamp");
    const sig = req.headers.get("svix-signature");
    if (!msgId || !ts || !sig || !verifySvix(secret, msgId, ts, sig, raw)) {
      logger.warn("resend webhook: invalid signature");
      return new NextResponse("Invalid signature", { status: 403 });
    }
  }

  let event: { type?: string; data?: { email_id?: string; to?: string[] | string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const type = event.type ?? "";
  const emailId = event.data?.email_id;
  if (!emailId) return NextResponse.json({ ok: true });

  const next = DELIVERED_TYPES.has(type)
    ? "DELIVERED"
    : FAILED_TYPES.has(type)
      ? "FAILED"
      : null;

  if (next) {
    const updated = await prisma.notification.updateMany({
      where: { channel: "EMAIL", data: { path: ["resendId"], equals: emailId } },
      data: { status: next },
    });
    logger.info({ emailId, type, matched: updated.count }, "resend webhook processed");
  }

  const now = new Date();
  if (type === "email.delivered") {
    await updateEmailStatus(prisma, emailId, { status: "delivered", deliveredAt: now });
  } else if (type === "email.bounced" || type === "email.complained") {
    await updateEmailStatus(prisma, emailId, { status: "bounced", bouncedAt: now });
  } else if (type === "email.failed") {
    await updateEmailStatus(prisma, emailId, { status: "failed" });
  } else if (type === "email.opened") {
    await updateEmailStatus(prisma, emailId, { openedAt: now });
  }

  // Gated: only bounces + spam complaints reach PostHog (sender-reputation
  // signals). `delivered`/`opened`/`failed` are intentionally NOT sent —
  // they're high-volume and low-signal. distinctId is the recipient resolved
  // via the resendId linkage.
  const commsEvent =
    type === "email.bounced"
      ? SERVER_EVENTS.commsEmailBounced
      : type === "email.complained"
        ? SERVER_EVENTS.commsEmailComplained
        : null;
  if (commsEvent) {
    const notif = await prisma.notification.findFirst({
      where: { channel: "EMAIL", data: { path: ["resendId"], equals: emailId } },
      select: { userId: true },
    });
    if (notif?.userId) {
      await trackServer({
        event: commsEvent,
        distinctId: notif.userId,
        properties: { type },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
