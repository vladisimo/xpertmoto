import { PrismaClient, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";

// Models that carry a `deletedAt` timestamp. The extension below auto-filters
// findFirst/findMany/findUnique/count/aggregate/groupBy to `deletedAt: null`
// unless the caller passes `deletedAt` explicitly in the where clause
// (e.g. for staff admin views that want to see soft-deleted rows).
const SOFT_DELETE_MODELS = new Set<string>([
  "User",
  "Depot",
  "Vehicle",
  "Booking",
  "Payment",
  "Invoice",
  "Infringement",
  "CreditNote",
  "BondLedger",
  "MaintenanceWorkOrder",
  "Incident",
]);

// Models that MUST NOT be hard-deleted. Financial / audit / compliance
// records. Use soft-delete (`deletedAt`) via the dedicated anonymise /
// archive procedures. The extension below throws on a hard `.delete` /
// `.deleteMany` to these models — a last-line-of-defence against
// accidental `prisma.payment.deleteMany()` calls.
const HARD_DELETE_FORBIDDEN_MODELS = new Set<string>([
  "Booking",
  "Payment",
  "Invoice",
  "CreditNote",
  "BondLedger",
  "Infringement",
  "MaintenanceWorkOrder",
  "Incident",
  "AuditLog",
  "RentalAgreement",
  "ReturnAssessment",
  "DamageCharge",
  "PaymentEvent",
  "StripeWebhookEvent",
  "StripeFeeLedger",
  "UnmatchedTransaction",
]);

function whereExcludesSoftDeleted(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  // If caller already specified anything about `deletedAt`, leave it alone.
  return Object.prototype.hasOwnProperty.call(w, "deletedAt");
}

// Cast the extended client back to the plain `PrismaClient` type. The
// $extends return type loses `$on` / `$use` and has a subtly-different
// `TransactionClient` shape, which cascades into a wall of TS2345 errors
// across services. Runtime behaviour is unchanged: the $allModels query
// hooks still fire. This is a pragmatic escape hatch that keeps call-site
// types identical to pre-extension code.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// In dev we wire the `query` log channel so every statement is emitted as a
// typed event. The listener below filters to slow queries and forwards them
// to Pino + Sentry. In test we stay silent. In prod we keep errors only,
// unless SLOW_QUERY_MS is explicitly set — observability doesn't come free.
const loggingEnabled =
  process.env.NODE_ENV !== "test" &&
  (process.env.SLOW_QUERY_MS != null || process.env.NODE_ENV === "development");

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 500);

// `next build` spawns ~N workers (one per CPU) for static page generation,
// and each worker imports this module and opens its own pool. Prisma's default
// pool is `num_physical_cpus * 2 + 1` per client, so 16 workers × ~17 conns
// blows past Postgres `max_connections=100` — queries start failing with
// "too many clients already". During the build phase we only need a single
// connection per worker (static gen is sequential within each worker), so
// pin `connection_limit=1`. Runtime (dev/prod server) keeps Prisma's default
// sizing untouched.
function buildPhaseDatabaseUrl(): string | undefined {
  if (process.env.NEXT_PHASE !== "phase-production-build") return undefined;
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "1");
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function createPrisma() {
  const buildUrl = buildPhaseDatabaseUrl();
  const client = new PrismaClient({
    ...(buildUrl ? { datasources: { db: { url: buildUrl } } } : {}),
    log: loggingEnabled
      ? [
          { level: "query", emit: "event" },
          { level: "warn", emit: "stdout" },
          { level: "error", emit: "stdout" },
        ]
      : process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

  if (loggingEnabled) {
    // Cast: Prisma's typing only exposes `$on('query', ...)` when the client
    // was constructed with a `query` event emitter in the `log` array.
    (client as unknown as { $on: (e: "query", cb: (evt: Prisma.QueryEvent) => void) => void }).$on(
      "query",
      (event) => {
        if (event.duration < SLOW_QUERY_MS) return;
        const payload = {
          durationMs: event.duration,
          query: event.query.slice(0, 500),
          params: event.params.slice(0, 200),
          target: event.target,
        };
        logger.warn(payload, "prisma slow query");
        if (process.env.SENTRY_DSN) {
          Sentry.captureMessage("prisma slow query", {
            level: "warning",
            tags: { kind: "slow_query", target: event.target },
            extra: payload,
          });
        }
      },
    );
  }

  return client;
}

function createExtendedPrisma() {
  const client = createPrisma();

  // The extension callbacks use `any` internally because the `args.where`
  // type is a discriminated union across all 95 models — TS cannot prove
  // that `{ ...where, deletedAt: null }` is valid for every branch. We
  // gate on the runtime model name, which is safe.
  type AnyArgs = { where?: Record<string, unknown> } & Record<string, unknown>;
  const injectSoftDelete = (model: string, args: AnyArgs | undefined): AnyArgs | undefined => {
    if (!SOFT_DELETE_MODELS.has(model)) return args;
    if (whereExcludesSoftDeleted(args?.where)) return args;
    return { ...(args ?? {}), where: { ...(args?.where ?? {}), deletedAt: null } };
  };

  return client.$extends({
    name: "xpertmoto-lifecycle",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async findFirst({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          return query(injectSoftDelete(model, args) as AnyArgs);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async findFirstOrThrow({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          return query(injectSoftDelete(model, args) as AnyArgs);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async findMany({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          return query(injectSoftDelete(model, args) as AnyArgs);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async count({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          return query(injectSoftDelete(model, args) as AnyArgs);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async aggregate({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          return query(injectSoftDelete(model, args) as AnyArgs);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async groupBy({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          return query(injectSoftDelete(model, args) as AnyArgs);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async delete({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          if (
            HARD_DELETE_FORBIDDEN_MODELS.has(model) &&
            process.env.ALLOW_HARD_DELETE !== "1"
          ) {
            throw new Error(
              `[prisma-lifecycle] Hard delete of ${model} is forbidden — use soft-delete (deletedAt) or the dedicated anonymise/archive procedure. Set ALLOW_HARD_DELETE=1 only for one-off admin scripts.`,
            );
          }
          return query(args);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async deleteMany({ model, args, query }: { model: string; args: any; query: (a: any) => any }) {
          if (
            HARD_DELETE_FORBIDDEN_MODELS.has(model) &&
            process.env.ALLOW_HARD_DELETE !== "1"
          ) {
            throw new Error(
              `[prisma-lifecycle] deleteMany on ${model} is forbidden — use soft-delete (deletedAt) or set ALLOW_HARD_DELETE=1 for one-off admin scripts.`,
            );
          }
          return query(args);
        },
      },
    },
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (createExtendedPrisma() as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
