import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeCode } from "@/lib/xero";
import { logger } from "@/lib/logger";
import { withAudit } from "@/lib/with-audit";

export const GET = withAudit({ name: "api.integrations.xero.callback", entity: "XeroIntegration" }, handleGet);

async function handleGet(req: Request) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "SUPER_ADMIN"].includes(session.user.role ?? "")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) return NextResponse.redirect(`${url.origin}/admin/integrations?xero_error=${err}`);
  if (!code) return new NextResponse("Missing code", { status: 400 });

  const expectedState = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("xero_oauth_state="))
    ?.split("=")[1];
  if (!expectedState || expectedState !== returnedState) {
    return new NextResponse("State mismatch", { status: 400 });
  }

  try {
    await exchangeCode(code, `${url.origin}/api/integrations/xero/callback`);
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "xero oauth exchange failed",
    );
    return NextResponse.redirect(`${url.origin}/admin/integrations?xero_error=exchange`);
  }

  return NextResponse.redirect(`${url.origin}/admin/integrations?xero=connected`);
}
