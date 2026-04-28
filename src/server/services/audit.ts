import type { AuditCategory, AuditStatus, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logger } from "@/lib/logger";
import { headerIp, headerReqId, headerUserAgent } from "@/lib/request-meta";
import { sanitize } from "./audit-sanitize";

export type AuditEntry = {
  userId?: string | null;
  // When set, the row is tagged with the admin who initiated the
  // impersonation session. Middleware auto-populates this from the
  // session; manual callers only need to pass it in explicit
  // impersonation flows.
  impersonatorId?: string | null;
  category?: AuditCategory;
  action: string;
  entity: string;
  entityId?: string;
  method?: string;
  path?: string;
  status?: AuditStatus;
  durationMs?: number;
  depotId?: string | null;
  reqId?: string;
  errorCode?: string;
  previousData?: unknown;
  newData?: unknown;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Write an audit row. Failures are swallowed — audit writes must never break
 * the originating operation.
 */
export async function writeAudit(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        impersonatorId: entry.impersonatorId ?? null,
        category: entry.category ?? "MUTATION",
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        method: entry.method,
        path: entry.path,
        status: entry.status ?? "SUCCESS",
        durationMs: entry.durationMs,
        depotId: entry.depotId ?? null,
        reqId: entry.reqId,
        errorCode: entry.errorCode,
        previousData: entry.previousData === undefined ? undefined : (sanitize(entry.previousData) as never),
        newData: entry.newData === undefined ? undefined : (sanitize(entry.newData) as never),
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  } catch (e) {
    logger.error({ err: e, audit: { action: entry.action, entity: entry.entity } }, "audit log write failed");
  }
}

/**
 * Opt a resolver out of the auto-audit middleware. Call at the top of any
 * procedure that emits a richer manual `writeAudit` entry — prevents a
 * duplicate bare-minimum row from landing alongside the curated one.
 */
export function skipAutoAudit(ctx: unknown): void {
  (ctx as { skipAutoAudit?: boolean }).skipAutoAudit = true;
}

/**
 * Record the customer this resolver is acting on. Used when `customerId`
 * isn't in the input (e.g. update/delete by documentId) but the resolver
 * can look it up. The auto-audit middleware reads this via
 * `.meta({ audit: { customerIdPath: readCapturedCustomerId } })`.
 */
export function captureCustomerId(ctx: unknown, customerId: string | null | undefined): void {
  if (customerId) {
    (ctx as { capturedCustomerId?: string }).capturedCustomerId = customerId;
  }
}

export function readCapturedCustomerId(_input: unknown, ctx: unknown): string | undefined {
  return (ctx as { capturedCustomerId?: string }).capturedCustomerId;
}

/**
 * Fire-and-forget wrapper. Queues the write on the microtask queue so it
 * doesn't block the caller's response path.
 */
export function writeAuditAsync(prisma: PrismaClient, entry: AuditEntry): void {
  queueMicrotask(() => {
    void writeAudit(prisma, entry);
  });
}

/**
 * Write a companion audit row keyed to a customer (entity='User'). Use in
 * booking / incident / return / inspection resolvers that already emit a
 * rich primary row (e.g. entity='Booking') — this second row surfaces the
 * event on that customer's Activity tab. Both rows share reqId so they can
 * be correlated.
 */
export function writeCustomerAuditAsync(
  prisma: PrismaClient,
  customerId: string | null | undefined,
  entry: Omit<AuditEntry, "entity" | "entityId">,
): void {
  if (!customerId) return;
  writeAuditAsync(prisma, { ...entry, entity: "User", entityId: customerId });
}

/**
 * Emit a PAGE_VIEW audit row from an authenticated server-component layout.
 * Skips when no session is present so we don't log anonymous traffic.
 *
 * Rows are tagged entity='User', entityId=userId so they surface on the
 * customer/staff Activity tab alongside that user's mutations.
 */
export function capturePageView(
  prisma: PrismaClient,
  headers: Headers,
  session: Session | null,
  path: string,
): void {
  if (!session?.user?.id) return;
  writeAuditAsync(prisma, {
    userId: session.user.id,
    category: "PAGE_VIEW",
    action: "page.view",
    entity: "User",
    entityId: session.user.id,
    method: "GET",
    path,
    status: "SUCCESS",
    depotId: session.user.depotId ?? null,
    reqId: headerReqId(headers),
    ipAddress: headerIp(headers),
    userAgent: headerUserAgent(headers),
  });
}
