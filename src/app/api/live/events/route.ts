import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  subscribePresence,
  subscribeChat,
  markStaffOnline,
  markStaffOffline,
} from "@/server/services/presence";

/**
 * Server-Sent Events endpoint for the Live Visitor View. Two shapes:
 *
 *   ?role=staff     → presence feed (every visitor) + all chat channels
 *                     for LIVE_VIEW conversations. Requires staff auth.
 *   (no query)      → visitor feed: chat events for their own conversation
 *                     only. Identity from the `xpertmoto_vid` cookie.
 *
 * The route owns one Redis subscriber per HTTP connection. On disconnect
 * the subscriber is torn down. A 25-second keep-alive comment frame keeps
 * intermediaries from idling the connection closed.
 */

const KEEPALIVE_MS = 25_000;
const VISITOR_COOKIE = "xpertmoto_vid";

type SSEController = ReadableStreamDefaultController<Uint8Array>;

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get("role");
  const wantStaff = role === "staff";

  if (wantStaff) {
    const session = await auth();
    if (
      !session?.user ||
      !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)
    ) {
      return new Response("Unauthorised", { status: 401 });
    }
    return openStaffStream(session.user.id);
  }

  const vid = readVisitorCookie(req);
  if (!vid) return new Response("No visitor cookie", { status: 400 });
  return openVisitorStream(vid);
}

function readVisitorCookie(req: NextRequest): string | null {
  return req.cookies.get(VISITOR_COOKIE)?.value ?? null;
}

async function openStaffStream(staffId: string): Promise<Response> {
  const encoder = new TextEncoder();

  let presenceHandle: { unsubscribe: () => Promise<void> } | null = null;
  let chatHandle:
    | { unsubscribe: () => Promise<void>; expand: (id: string) => Promise<void> }
    | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller: SSEController) {
      controller.enqueue(encoder.encode(sseFrame({ type: "ready", role: "staff" })));
      await markStaffOnline(staffId);

      presenceHandle = await subscribePresence((event) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event)));
        } catch {
          // controller closed
        }
      });

      // Subscribe to all LIVE_VIEW conversations with recent activity.
      // New conversations surface via the presence feed — staff UI can
      // open them and the per-conversation subscribe happens client-side
      // via a separate EventSource (or we expand the Redis subscription
      // here on demand). To keep this endpoint simple, we prime with the
      // currently-active set; client refreshes if a new conversation
      // appears.
      const activeConvs = await prisma.supportConversation.findMany({
        where: {
          source: "LIVE_VIEW",
          lastMessageAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 4) },
        },
        select: { id: true },
        take: 200,
      });

      chatHandle = await subscribeChat(
        activeConvs.map((c) => c.id),
        (event) => {
          try {
            controller.enqueue(encoder.encode(sseFrame(event)));
          } catch {
            // controller closed
          }
        },
      );

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          if (keepalive) clearInterval(keepalive);
        }
      }, KEEPALIVE_MS);
    },
    async cancel() {
      if (keepalive) clearInterval(keepalive);
      await presenceHandle?.unsubscribe();
      await chatHandle?.unsubscribe();
      await markStaffOffline(staffId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function openVisitorStream(visitorSessionId: string): Promise<Response> {
  const encoder = new TextEncoder();

  const session = await prisma.visitorSession.findUnique({
    where: { id: visitorSessionId },
    select: { conversationId: true },
  });

  let chatHandle: { unsubscribe: () => Promise<void> } | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller: SSEController) {
      controller.enqueue(
        encoder.encode(
          sseFrame({
            type: "ready",
            role: "visitor",
            conversationId: session?.conversationId ?? null,
          }),
        ),
      );

      if (session?.conversationId) {
        chatHandle = await subscribeChat([session.conversationId], (event) => {
          try {
            controller.enqueue(encoder.encode(sseFrame(event)));
          } catch {
            // closed
          }
        });
      }

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          if (keepalive) clearInterval(keepalive);
        }
      }, KEEPALIVE_MS);
    },
    async cancel() {
      if (keepalive) clearInterval(keepalive);
      await chatHandle?.unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
