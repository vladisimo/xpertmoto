import { prisma } from "@/lib/prisma";
import { writeAuditAsync } from "@/server/services/audit";
import { headerIp, headerReqId, headerUserAgent } from "@/lib/request-meta";

export type AuditableHandler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

export type WithAuditOptions = {
  /** Short machine name: "api.push.subscribe", "webhooks.stripe" */
  name: string;
  /** Entity class, e.g. "PushSubscription", "Webhook". */
  entity: string;
};

/**
 * Wrap an App Router route handler to emit an audit row on every invocation.
 *
 * Category is inferred from the name prefix: names starting with "webhooks."
 * are WEBHOOK, everything else is API. IP, UA, session, duration, and
 * HTTP status are captured automatically.
 */
export function withAudit<Ctx = { params: Promise<Record<string, string>> }>(
  { name, entity }: WithAuditOptions,
  handler: AuditableHandler<Ctx>,
): (req: Request, ctx?: Ctx) => Promise<Response> {
  const category = name.startsWith("webhooks.") ? "WEBHOOK" : "API";
  return async (req, ctx) => {
    const start = Date.now();
    let response: Response;
    let threw: unknown;
    try {
      response = await handler(req, ctx as Ctx);
    } catch (err) {
      threw = err;
      response = new Response("Internal Server Error", { status: 500 });
    }

    let userId: string | undefined;
    if (category === "API") {
      try {
        // Dynamic import keeps NextAuth out of the module graph for webhook
        // routes whose tests never intend to resolve it.
        const { auth } = await import("@/lib/auth");
        const session = await auth();
        userId = session?.user?.id;
      } catch {
        // session resolution failure must not break the audit
      }
    }

    const url = (() => {
      try {
        return new URL(req.url);
      } catch {
        return null;
      }
    })();

    writeAuditAsync(prisma, {
      userId,
      category,
      action: name,
      entity,
      method: req.method,
      path: url?.pathname,
      status: response.ok ? "SUCCESS" : response.status >= 400 && response.status < 500 ? "DENIED" : "FAILURE",
      durationMs: Date.now() - start,
      reqId: headerReqId(req.headers),
      errorCode: response.ok ? undefined : String(response.status),
      ipAddress: headerIp(req.headers),
      userAgent: headerUserAgent(req.headers),
    });

    if (threw) throw threw;
    return response;
  };
}
