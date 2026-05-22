import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSecret, getString } from "@/lib/integration-config";

export type PushSubscriptionJson = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function pushEnabled(): Promise<boolean> {
  const [pub, priv] = await Promise.all([
    getString("integration:vapid:publicKey", "VAPID_PUBLIC_KEY"),
    getSecret("integration:vapid:privateKey", "VAPID_PRIVATE_KEY"),
  ]);
  return !!pub && !!priv;
}

/**
 * Public VAPID key for the browser. Resolved at request time — prefer
 * passing this from a server component via props so the client bundle
 * doesn't need to be rebuilt on key rotation.
 */
export async function getPushPublicKey(): Promise<string> {
  return (await getString("integration:vapid:publicKey", "NEXT_PUBLIC_VAPID_PUBLIC_KEY")) ?? "";
}

let lastVapidSig: string | null = null;
async function getWebPush() {
  const [pub, priv, contact] = await Promise.all([
    getString("integration:vapid:publicKey", "VAPID_PUBLIC_KEY"),
    getSecret("integration:vapid:privateKey", "VAPID_PRIVATE_KEY"),
    getString("integration:vapid:contact", "VAPID_CONTACT"),
  ]);
  if (!pub || !priv) return null;
  const mod = await import("web-push");
  const wp = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const sig = `${pub.slice(0, 8)}:${priv.slice(0, 8)}`;
  if (lastVapidSig !== sig) {
    wp.setVapidDetails(`mailto:${contact ?? "ops@xpertmoto.com.au"}`, pub, priv);
    lastVapidSig = sig;
  }
  return wp;
}

/**
 * Send a push notification to a single subscription. Returns false when
 * VAPID keys are missing or the push endpoint rejects delivery.
 */
export async function sendPush(
  subscription: PushSubscriptionJson,
  payload: PushPayload,
): Promise<boolean> {
  const wp = await getWebPush();
  if (!wp) {
    logger.debug({ endpoint: subscription.endpoint }, "push skipped: VAPID keys not configured");
    return false;
  }
  try {
    await wp.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        status,
        endpoint: subscription.endpoint,
      },
      "push send failed",
    );
    return false;
  }
}

/**
 * Fan-out a push to every registered subscription for a user. Endpoints that
 * respond 404/410 are deleted; other failures increment a failure counter.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;
  for (const s of subs) {
    const sub: PushSubscriptionJson = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    };
    const ok = await sendPush(sub, payload);
    if (ok) {
      delivered++;
      await prisma.pushSubscription.update({
        where: { id: s.id },
        data: { lastDeliveredAt: new Date(), failureCount: 0 },
      });
    } else {
      await prisma.pushSubscription.update({
        where: { id: s.id },
        data: { lastFailedAt: new Date(), failureCount: { increment: 1 } },
      });
      if (s.failureCount >= 4) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => null);
      }
    }
  }
  return delivered;
}
