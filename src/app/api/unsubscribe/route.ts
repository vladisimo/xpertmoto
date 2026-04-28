import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return new NextResponse("Missing token", { status: 400 });

  const payload = verifyUnsubscribeToken(token);
  if (!payload) return new NextResponse("Invalid or expired token", { status: 400 });

  const now = new Date();
  try {
    await prisma.customerProfile.update({
      where: { userId: payload.customerId },
      data:
        payload.channel === "SMS"
          ? { marketingSmsUnsubscribedAt: now, marketingSmsOptIn: false }
          : { marketingEmailUnsubscribedAt: now, marketingOptIn: false },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), customerId: payload.customerId },
      "unsubscribe: profile update failed",
    );
    return new NextResponse("Could not complete unsubscribe", { status: 500 });
  }

  const html = `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>Unsubscribed — Scootering</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:6rem auto;padding:0 1rem;color:#0a0a0a}h1{margin-bottom:.5rem}p{color:#525252;line-height:1.5}</style>
</head><body>
<h1>You've been unsubscribed</h1>
<p>We've stopped sending marketing ${payload.channel === "SMS" ? "SMS messages" : "emails"} to you.</p>
<p>Booking confirmations, reminders, and other transactional notifications will continue so you don't miss anything important about your hires.</p>
<p>Changed your mind? You can re-enable marketing messages any time from your account preferences.</p>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  return GET(req);
}
