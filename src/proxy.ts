import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";

const STAFF_ROLES = new Set(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]);
const MANAGER_ROLES = new Set(["MANAGER", "ADMIN", "SUPER_ADMIN"]);
const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

const VISITOR_COOKIE = "scootering_vid";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Platform > Server cost tab: sampled request logger. Disabled unless
 * PLATFORM_REQUEST_LOGGING=on. Writes ServerRequestLog rows that the
 * admin tab extrapolates to full traffic via `sampleWeight`.
 */
async function maybeSampleRequest(args: {
  method: string;
  path: string;
  userAgent?: string;
  ipAddress?: string;
  userId?: string;
  startedAt: number;
}): Promise<void> {
  if (process.env.PLATFORM_REQUEST_LOGGING !== "on") return;
  const rate = Math.max(1, Number(process.env.PLATFORM_REQUEST_SAMPLE_RATE ?? 10));
  if (Math.floor(Math.random() * rate) !== 0) return;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.serverRequestLog.create({
      data: {
        method: args.method,
        path: args.path,
        status: 200,
        durationMs: Date.now() - args.startedAt,
        sampleWeight: rate,
        ...(args.userAgent ? { userAgent: args.userAgent.slice(0, 512) } : {}),
        ...(args.ipAddress ? { ipAddress: args.ipAddress.slice(0, 64) } : {}),
        ...(args.userId ? { userId: args.userId } : {}),
      },
    });
  } catch {
    // Proxy must never break requests.
  }
}

export default async function proxy(req: NextRequest) {
  const proxyStartedAt = Date.now();
  const { pathname } = req.nextUrl;

  const reqId = req.headers.get("x-request-id") ?? randomUUID();
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const realIp = req.headers.get("x-real-ip") ?? "";
  const ip = forwardedFor.split(",")[0]?.trim() || realIp || "";

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", reqId);
  requestHeaders.set("x-audit-path", pathname);
  if (ip) requestHeaders.set("x-audit-ip", ip);

  const isCustomerArea = pathname.startsWith("/dashboard") || pathname.startsWith("/my-bookings");
  const isStaffArea = pathname.startsWith("/staff");
  const isAdminArea = pathname.startsWith("/admin");
  const requiresAuth = isCustomerArea || isStaffArea || isAdminArea;

  if (requiresAuth) {
    const session = await auth();

    if (!session?.user) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }

    const role = session.user.role;
    if (isStaffArea && (!role || !STAFF_ROLES.has(role))) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (isAdminArea && (!role || !ADMIN_ROLES.has(role))) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (pathname.startsWith("/admin/settings") && (!role || !ADMIN_ROLES.has(role))) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    void MANAGER_ROLES;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", reqId);

  // Fire-and-forget sampled server-request log (see helper above).
  const userAgent = req.headers.get("user-agent") ?? undefined;
  void maybeSampleRequest({
    method: req.method,
    path: pathname,
    ...(userAgent ? { userAgent } : {}),
    ...(ip ? { ipAddress: ip } : {}),
    startedAt: proxyStartedAt,
  });

  // Opaque visitor cookie for the Live Visitor View presence system.
  // Skipped on admin/staff areas (already authed) and on auth flows to avoid
  // tainting sign-in redirects.
  if (
    !req.cookies.get(VISITOR_COOKIE) &&
    !isStaffArea &&
    !isAdminArea &&
    !pathname.startsWith("/api/auth") &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/register")
  ) {
    response.cookies.set({
      name: VISITOR_COOKIE,
      value: `v_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "")}`,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VISITOR_COOKIE_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/fleet/:path*",
    "/locations/:path*",
    "/pricing/:path*",
    "/faq/:path*",
    "/contact/:path*",
    "/terms/:path*",
    "/admin/:path*",
    "/staff/:path*",
    "/manager/:path*",
    "/account/:path*",
    "/dashboard/:path*",
    "/booking/:path*",
    "/my-bookings/:path*",
  ],
};
