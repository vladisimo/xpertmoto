import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAudit } from "@/lib/with-audit";

const bodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  userAgent: z.string().optional(),
});

export const POST = withAudit({ name: "api.push.subscribe", entity: "PushSubscription" }, handlePost);

async function handlePost(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { subscription, userAgent } = parsed.data;

  // Guard against subscription-hijack: if this endpoint already belongs to
  // another user, refuse — otherwise an authenticated attacker who knows
  // (or guesses) a victim's push endpoint could claim it and silence their
  // notifications. Only the row's existing owner may refresh its keys.
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    },
    update: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
      failureCount: 0,
    },
  });

  logger.info({ userId, endpoint: subscription.endpoint.slice(0, 60) }, "push subscription saved");
  return NextResponse.json({ ok: true });
}

export const DELETE = withAudit({ name: "api.push.unsubscribe", entity: "PushSubscription" }, handleDelete);

async function handleDelete(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  // Scope the delete to the caller's own subscription — without the userId
  // filter an authenticated attacker could unsubscribe any user whose push
  // endpoint they discover (e.g. by inspecting the service worker).
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId },
  });

  return NextResponse.json({ ok: true });
}
