import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAudit } from "@/lib/with-audit";
import { updateTwilioStatus } from "@/server/services/twilio-cost";

const TERMINAL_DELIVERED = new Set(["delivered"]);
const TERMINAL_FAILED = new Set(["failed", "undelivered"]);

const twilioStatusCallbackSchema = z.object({
  MessageSid: z.string().min(10).max(64),
  MessageStatus: z.string().min(1).max(32),
  ErrorCode: z.string().max(16).optional(),
  ErrorMessage: z.string().max(512).optional(),
  NumSegments: z.string().max(8).optional(),
  Price: z.string().max(32).optional(),
  PriceUnit: z.string().max(8).optional(),
});

async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const sig = req.headers.get("x-twilio-signature");
  if (!sig) return false;

  const twilio = await import("twilio");
  const validator = twilio.default.validateRequest;
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const url = new URL(req.url);
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}${url.pathname}`
    : req.url;
  return validator(token, sig, publicUrl, params);
}

export const POST = withAudit({ name: "webhooks.twilio", entity: "TwilioWebhook" }, handlePost);

async function handlePost(req: Request) {
  const raw = await req.text();
  const valid = await verifySignature(req, raw);
  if (!valid) {
    logger.warn("twilio webhook: invalid signature");
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const params = Object.fromEntries(new URLSearchParams(raw));
  const parsed = twilioStatusCallbackSchema.safeParse(params);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues },
      "twilio webhook: body shape unexpected — acknowledging",
    );
    return NextResponse.json({ ok: true });
  }
  const sid = parsed.data.MessageSid;
  const status = parsed.data.MessageStatus.toLowerCase();
  const errorCode = parsed.data.ErrorCode;

  await updateTwilioStatus(prisma, sid, {
    status,
    numSegments: parsed.data.NumSegments ? Number(parsed.data.NumSegments) : null,
    priceUsd: parsed.data.Price ?? null,
    errorCode: parsed.data.ErrorCode ?? null,
    errorMessage: parsed.data.ErrorMessage ?? null,
    deliveredAt: TERMINAL_DELIVERED.has(status) ? new Date() : null,
  });

  const next = TERMINAL_DELIVERED.has(status)
    ? "DELIVERED"
    : TERMINAL_FAILED.has(status)
      ? "FAILED"
      : null;

  if (next) {
    const updated = await prisma.notification.updateMany({
      where: { channel: "SMS", data: { path: ["twilioSid"], equals: sid } },
      data: { status: next },
    });
    logger.info(
      { sid, status, errorCode, matched: updated.count },
      "twilio status callback processed",
    );
  }

  return NextResponse.json({ ok: true });
}
