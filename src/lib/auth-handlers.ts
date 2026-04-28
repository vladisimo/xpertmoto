import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { headerIp } from "@/lib/request-meta";

// Cap abuse of OAuth endpoints (callback + signin redirect) per IP. The
// credentials login has its own email + IP limiter inside `authorize`;
// OAuth has no such hook, so apply a lightweight outer limit here. Keep
// the window comfortably wide so a user hitting "sign in" a few times
// doesn't trip, but tight enough that a callback-flood is throttled.
const OAUTH_WINDOW_SEC = 60;
const OAUTH_LIMIT = 30;

function isOauthPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/callback/") ||
    pathname.startsWith("/api/auth/signin/")
  );
}

async function applyOauthRateLimit(req: NextRequest): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!isOauthPath(pathname)) return null;
  const ip = headerIp(req.headers) ?? "unknown";
  const result = await rateLimit(
    `auth:oauth:ip:${ip}`,
    OAUTH_LIMIT,
    OAUTH_WINDOW_SEC,
  );
  if (result.ok) return null;
  return new Response(
    JSON.stringify({ error: "Too many requests" }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(
          Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
        ),
      },
    },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const blocked = await applyOauthRateLimit(req);
  if (blocked) return blocked;
  return handlers.GET(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  const blocked = await applyOauthRateLimit(req);
  if (blocked) return blocked;
  return handlers.POST(req);
}
