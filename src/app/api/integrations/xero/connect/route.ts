import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { buildAuthorizeUrl, xeroEnabled } from "@/lib/xero";
import { withAudit } from "@/lib/with-audit";

export const GET = withAudit({ name: "api.integrations.xero.connect", entity: "XeroIntegration" }, handleGet);

async function handleGet(req: Request) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "SUPER_ADMIN"].includes(session.user.role ?? "")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!(await xeroEnabled())) return new NextResponse("Xero not configured", { status: 503 });

  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/integrations/xero/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const res = NextResponse.redirect(await buildAuthorizeUrl(redirectUri, state));
  res.cookies.set("xero_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
