import { initTRPC, TRPCError } from "@trpc/server";
import * as Sentry from "@sentry/nextjs";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Context } from "./context";
import type { UserRole } from "@prisma/client";
import { writeAuditAsync } from "@/server/services/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { needsOnboarding } from "@/lib/onboarding-status";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

const USER_FACING_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "METHOD_NOT_SUPPORTED",
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
  "CLIENT_CLOSED_REQUEST",
  "UNPROCESSABLE_CONTENT",
  "PARSE_ERROR",
]);

const sentryMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const result = await next();
  if (!result.ok) {
    const err = result.error;
    const code = err instanceof TRPCError ? err.code : "INTERNAL_SERVER_ERROR";
    if (!USER_FACING_CODES.has(code)) {
      Sentry.captureException(err.cause ?? err, {
        tags: { trpcPath: path, trpcType: type, trpcCode: code },
        extra: { reqId: ctx.reqId },
        user: ctx.session?.user
          ? { id: ctx.session.user.id, email: ctx.session.user.email ?? undefined }
          : undefined,
      });
    }
  }
  return result;
});

/**
 * Audit meta shape. `true` is the legacy opt-in for queries. The object form
 * lets a procedure declare which input field (or ctx value) points to the
 * affected customer — the middleware then tags the row with
 * `entity='User', entityId=<resolvedId>` so it's queryable per customer.
 */
export type AuditMeta =
  | boolean
  | {
      customerIdPath?:
        | string
        | ((input: unknown, ctx: Context) => string | undefined | null);
      bookingIdPath?:
        | string
        | ((input: unknown, ctx: Context) => string | undefined | null);
      entity?: string;
    };

type AuditMetaContainer = { audit?: AuditMeta };

export function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function resolveCustomerId(
  meta: AuditMeta | undefined,
  input: unknown,
  ctx: Context,
): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const p = meta.customerIdPath;
  if (!p) return undefined;
  const raw = typeof p === "function" ? p(input, ctx) : getByPath(input, p);
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function resolveBookingId(
  meta: AuditMeta | undefined,
  input: unknown,
  ctx: Context,
): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const p = meta.bookingIdPath;
  if (!p) return undefined;
  const raw = typeof p === "function" ? p(input, ctx) : getByPath(input, p);
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Automatic audit capture for every tRPC call. Mutations are always logged;
 * queries are only logged when the procedure is marked `.meta({ audit: true })`.
 * A resolver can opt out of the auto row by setting `ctx.skipAutoAudit = true`
 * (useful when the resolver emits a richer manual `writeAudit` entry).
 *
 * Procedures that touch a specific customer should declare
 * `.meta({ audit: { customerIdPath: "customerId" } })` (or a function) so the
 * auto row is tagged with `entity='User', entityId=<customerId>` and appears
 * in that customer's Activity feed.
 */
const auditMiddleware = t.middleware(async ({ ctx, path, type, input, meta, next }) => {
  const start = Date.now();
  const result = await next();
  const auditMeta = (meta as AuditMetaContainer | undefined)?.audit;
  const auditOptIn =
    auditMeta === true || (typeof auditMeta === "object" && auditMeta !== null);
  // The resolver's ctx is a downstream-spread of this middleware's `ctx`
  // (tRPC clones inside `next({ ctx })` via protectedProcedure), so state
  // the resolver writes onto ctx — `skipAutoAudit`, `capturedCustomerId` —
  // isn't visible on our local `ctx`. The middleware-result exposes the
  // final ctx the resolver saw; read downstream state from there.
  const resolverCtx = (result as { ctx?: Context }).ctx;
  const effectiveCtx = resolverCtx ?? ctx;
  const skip =
    (effectiveCtx as { skipAutoAudit?: boolean }).skipAutoAudit === true ||
    (ctx as { skipAutoAudit?: boolean }).skipAutoAudit === true;
  if (skip) return result;
  if (type === "query" && !auditOptIn) return result;
  if (type === "subscription") return result;

  const status = result.ok
    ? "SUCCESS"
    : result.error.code === "FORBIDDEN" || result.error.code === "UNAUTHORIZED"
      ? "DENIED"
      : "FAILURE";

  const customerId = resolveCustomerId(auditMeta, input, effectiveCtx);
  const bookingId = resolveBookingId(auditMeta, input, effectiveCtx);
  const metaEntity = typeof auditMeta === "object" && auditMeta ? auditMeta.entity : undefined;
  const entity = metaEntity ?? (customerId ? "User" : (path.split(".")[0] ?? "tRPC"));
  const entityId = customerId ?? undefined;

  if (
    process.env.NODE_ENV !== "production" &&
    type === "mutation" &&
    typeof auditMeta === "object" &&
    auditMeta !== null &&
    auditMeta.customerIdPath !== undefined &&
    !customerId
  ) {
    logger.warn(
      { path },
      "audit: meta.customerIdPath did not resolve to a customer id",
    );
  }

  writeAuditAsync(ctx.prisma, {
    userId: ctx.session?.user?.id,
    impersonatorId: ctx.session?.impersonatorId ?? null,
    category: type === "mutation" ? "MUTATION" : "QUERY",
    action: path,
    entity,
    entityId,
    method: "tRPC",
    path,
    status,
    durationMs: Date.now() - start,
    depotId: ctx.session?.user?.depotId ?? null,
    reqId: ctx.reqId,
    errorCode: result.ok ? undefined : result.error.code,
    newData: input,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  // Companion row keyed to the affected booking so the event surfaces on the
  // booking's Activity tab — mirrors the entity='User' row tagged via
  // customerIdPath. Reaches here only when the resolver did NOT skipAutoAudit
  // (early-returned at the `skip` check above), so the 8 manual entity='Booking'
  // rows are never doubled. Guard skips the rare case where the primary row is
  // already this exact Booking row (meta.entity='Booking' + bookingIdPath).
  if (bookingId && !(entity === "Booking" && entityId === bookingId)) {
    writeAuditAsync(ctx.prisma, {
      userId: ctx.session?.user?.id,
      impersonatorId: ctx.session?.impersonatorId ?? null,
      category: type === "mutation" ? "MUTATION" : "QUERY",
      action: path,
      entity: "Booking",
      entityId: bookingId,
      method: "tRPC",
      path,
      status,
      durationMs: Date.now() - start,
      depotId: ctx.session?.user?.depotId ?? null,
      reqId: ctx.reqId,
      errorCode: result.ok ? undefined : result.error.code,
      newData: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
  return result;
});

/**
 * CSRF defence for mutations. Uses the modern Fetch-Metadata headers (all
 * major browsers now set Sec-Fetch-Site / Sec-Fetch-Mode) plus a fallback
 * Origin-vs-Host check. Rejects cross-site mutations at the tRPC layer so
 * a malicious site can't hijack a logged-in browser into triggering a
 * state change via a simple form-encoded POST.
 *
 * Queries are unaffected (they're idempotent + transformer=superjson makes
 * them effectively no-op for simple-request forgery). Subscriptions are
 * WebSocket-upgrade-driven and get their own path.
 */
const csrfMiddleware = t.middleware(async ({ ctx, type, path, next }) => {
  if (type !== "mutation") return next();
  const h = ctx.headers;
  // Tests and server-side callers build a context without headers — skip
  // the origin check there. Real HTTP traffic always has a Headers object
  // provided by Next.js / fetch, so this doesn't weaken the prod control.
  if (!h || typeof h.get !== "function") return next();
  const fetchSite = h.get("sec-fetch-site");
  if (fetchSite) {
    // Browsers emit sec-fetch-site for every fetch/xhr. Allow same-origin
    // and same-site; reject cross-site. Server-to-server callers omit the
    // header entirely and fall through to the Origin check below.
    if (fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
      logger.warn({ path, fetchSite }, "csrf: cross-site mutation blocked");
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Cross-site request blocked (CSRF).",
      });
    }
    return next();
  }
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        logger.warn({ path, origin, host }, "csrf: origin-host mismatch");
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Origin mismatch (CSRF).",
        });
      }
    } catch {
      throw new TRPCError({ code: "FORBIDDEN", message: "Malformed origin." });
    }
  }
  return next();
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure
  .use(csrfMiddleware)
  .use(auditMiddleware)
  .use(sentryMiddleware);

/**
 * Rate-limit middleware factory. Composes onto any procedure.
 * Buckets by IP by default; pass `identifier` to add a second bucket
 * (e.g. email for login/register) — whichever trips first returns 429.
 */
export interface RateLimitOptions<TInput = unknown> {
  bucket: string;
  limit: number;
  windowSec: number;
  identifier?: (ctx: Context, input: TInput) => string | undefined;
}

export const trpcRateLimit = <TInput = unknown>(opts: RateLimitOptions<TInput>) =>
  t.middleware(async ({ ctx, input, path, next }) => {
    const ip = ctx.ipAddress ?? "unknown";
    const checks: Promise<{ ok: boolean }>[] = [
      rateLimit(`${opts.bucket}:ip:${ip}`, opts.limit, opts.windowSec),
    ];
    const idRaw = opts.identifier?.(ctx, input as TInput);
    if (idRaw) {
      checks.push(rateLimit(`${opts.bucket}:id:${idRaw}`, opts.limit, opts.windowSec));
    }
    const results = await Promise.all(checks);
    const blocked = results.find((r) => !r.ok);
    if (blocked) {
      writeAuditAsync(ctx.prisma, {
        userId: ctx.session?.user?.id ?? null,
        category: "API",
        action: "rate_limit.tripped",
        entity: "RateLimit",
        method: "tRPC",
        path,
        status: "DENIED",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: { bucket: opts.bucket, limit: opts.limit, windowSec: opts.windowSec },
      });
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
    }
    return next();
  });

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  // Sessions in the OAuth/magic-link step-up holding pattern (TOTP enrolled
  // but not yet verified for this sign-in) are treated as anonymous for
  // every protected procedure. The dedicated `stepUpProcedure` below opts
  // back in for the single mutation that completes the step-up.
  if (ctx.session.pending2fa === true) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Two-factor authentication required",
    });
  }
  // Customers who haven't completed onboarding are blocked from every
  // protected procedure — only the dedicated `onboardingProcedure` below
  // accepts them, so the wizard itself can run while the rest of the API
  // stays gated.
  if (ctx.session.requiresOnboarding === true) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Onboarding required",
    });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.session.user } });
});

/**
 * Like `protectedProcedure`, but accepts sessions still in the `pending2fa`
 * state. The only legitimate caller is the TOTP step-up mutation —
 * everything else MUST use `protectedProcedure` so a half-authenticated
 * session can't reach the rest of the API.
 */
export const stepUpProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.session.user } });
});

/**
 * Like `protectedProcedure`, but accepts sessions still in the
 * `requiresOnboarding` state. The only legitimate callers live in the
 * `onboarding` router — everything else MUST use `protectedProcedure` so
 * a non-onboarded session can't reach the rest of the API. Still rejects
 * `pending2fa` sessions: TOTP step-up always comes before onboarding.
 *
 * Admittance is profile-based, not role-based: any authenticated user
 * whose CustomerProfile still needs onboarding may run the wizard —
 * including back-office users (STAFF/MANAGER/ADMIN/SUPER_ADMIN) who now
 * carry a CustomerProfile so they can rent. We deliberately never set
 * `requiresOnboarding` on a back-office session (it would lock them out of
 * the whole back office via protectedProcedure), so this gate reads the
 * profile directly rather than trusting the session flag. A fully
 * onboarded user of any role is rejected so they can't re-enter the
 * consent-gated procedures.
 */
export const onboardingProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.session.pending2fa === true) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Two-factor authentication required",
    });
  }
  const profile = await ctx.prisma.customerProfile.findUnique({
    where: { userId: ctx.session.user.id },
    select: { onboardedAt: true, onboardingVersion: true },
  });
  if (!needsOnboarding(profile)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Onboarding already complete",
    });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.session.user } });
});

export const requireRole = (roles: UserRole[]) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    if (!roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx });
  });

export const staffProcedure = requireRole(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]);
export const managerProcedure = requireRole(["MANAGER", "ADMIN", "SUPER_ADMIN"]);
export const adminProcedure = requireRole(["ADMIN", "SUPER_ADMIN"]);
export const superAdminProcedure = requireRole(["SUPER_ADMIN"]);
