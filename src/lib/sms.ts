import { getSecret, getString } from "@/lib/integration-config";
import { logger } from "@/lib/logger";
import { recordTwilioSend, type TwilioLogContext } from "@/server/services/twilio-cost";

export type SmsPayload = {
  to: string;
  body: string;
  /** Optional attribution for the Platform > SMS cost tab. */
  log?: TwilioLogContext;
};

type SendResult = { sid?: string; via: "twilio" | "console" };

/**
 * Normalise AU phone numbers to E.164 (+61...). Accepts 04xx, 4xx, or +61
 * formats. Falls through unchanged for already-international numbers.
 */
export function normaliseAuPhone(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("04") && digits.length === 10) return `+61${digits.slice(1)}`;
  if (digits.startsWith("4") && digits.length === 9) return `+61${digits}`;
  if (digits.startsWith("61")) return `+${digits}`;
  return digits;
}

export async function sendSms(payload: SmsPayload): Promise<SendResult> {
  const to = normaliseAuPhone(payload.to);

  const [accountSid, authToken, fromNumber, appUrl] = await Promise.all([
    getString("integration:twilio:accountSid", "TWILIO_ACCOUNT_SID"),
    getSecret("integration:twilio:authToken", "TWILIO_AUTH_TOKEN"),
    getString("integration:twilio:fromNumber", "TWILIO_FROM_NUMBER"),
    getString("integration:app:publicUrl", "NEXT_PUBLIC_APP_URL"),
  ]);

  if (accountSid && authToken && fromNumber) {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({
      from: fromNumber,
      to,
      body: payload.body,
      ...(appUrl ? { statusCallback: `${appUrl}/api/webhooks/twilio` } : {}),
    });
    const numSegments =
      msg.numSegments != null ? Number(msg.numSegments) : null;
    await recordTwilioSend(
      msg.sid,
      to,
      payload.body,
      payload.log ?? {},
      {
        numSegments,
        priceUsd: msg.price ?? null,
        status: msg.status ?? "queued",
      },
    );
    return { sid: msg.sid, via: "twilio" };
  }

  logger.info({ phone: to, body: payload.body }, "dev sms (no provider configured)");
  return { via: "console" };
}
