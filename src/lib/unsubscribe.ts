import { createHmac, timingSafeEqual } from "crypto";

import type { NotificationChannel } from "@prisma/client";

function getSigningKey(): string {
  return (
    process.env.UNSUBSCRIBE_SIGNING_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.SECRET_ENC_KEY ??
    "scootering-dev-unsub-key"
  );
}

type Payload = { customerId: string; channel: NotificationChannel; ts: number };

export function signUnsubscribeToken(payload: Omit<Payload, "ts">): string {
  const full: Payload = { ...payload, ts: Date.now() };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", getSigningKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): Payload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", getSigningKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
    if (!parsed.customerId || !parsed.channel) return null;
    return parsed;
  } catch {
    return null;
  }
}
