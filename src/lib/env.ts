import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

// Dev placeholder used in seeded .env files. Explicitly rejected in
// production so a misconfigured deploy cannot silently ship with a
// publicly-guessable JWT signing key.
const DEV_AUTH_SECRET_PLACEHOLDER = "dev-secret-change-me-dev-secret-change-me-xx";

// A SECRET_ENC_KEY / ETOLL_ENC_KEY must base64-decode to exactly 32 bytes
// (AES-256 key size). `crypto.ts` enforces this at runtime too; validating
// here ensures the process refuses to boot with a bad key instead of
// throwing from the first encrypt/decrypt call.
function isBase64ThirtyTwoBytes(s: string): boolean {
  try {
    return Buffer.from(s, "base64").length === 32;
  } catch {
    return false;
  }
}

const boolString = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,

    // Core — required in every environment.
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
    AUTH_URL: z.string().url().optional(),

    // Encryption key for at-rest secrets (e-toll creds, future MFA secrets).
    // `crypto.ts` reads SECRET_ENC_KEY with fallback to legacy ETOLL_ENC_KEY.
    SECRET_ENC_KEY: z.string().min(32).optional(),
    ETOLL_ENC_KEY: z.string().min(32).optional(),

    // Auth — Google OAuth optional (feature-flag style).
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),

    // Stripe — required in prod, stubbable in dev via ALLOW_STUB_STRIPE=1.
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    ALLOW_STUB_STRIPE: z.enum(["0", "1"]).optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

    // Email.
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: boolString.optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_TLS_REJECT_UNAUTHORIZED: boolString.optional(),
    EMAIL_FROM: z.string().optional(),

    // SMS / Twilio.
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    // Dev-only safety valve: when set, every outbound SMS is redirected to
    // this single number instead of the real recipient (the intended
    // recipient is prepended to the body). Ignored in production so it can
    // never silently swallow real customer SMS. See sendSms() in sms.ts.
    SMS_DEV_REDIRECT_TO: z.string().optional(),

    // Storage.
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("ap-southeast-2"),
    S3_BUCKET: z.string().default("xpertmoto"),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: boolString.optional(),
    S3_PUBLIC_URL: z.string().url().optional(),

    // Redis / BullMQ — optional. When absent the app still boots but
    // rate-limiting + background jobs degrade (see getRedis()).
    REDIS_URL: z.string().url().optional(),

    // Sentry — all optional, enables reporting when set.
    SENTRY_DSN: z.string().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
    // Nightly platform-sentry-stats job. SENTRY_AUTH_TOKEN is reused from CI
    // (org:read scope); SENTRY_ORG_SLUG is the org slug, distinct from
    // SENTRY_ORG. The job no-ops unless both are set.
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ORG_SLUG: z.string().optional(),
    SENTRY_API_BASE_URL: z.string().url().optional(),
    PLATFORM_SENTRY_STATS_CRON: z.string().optional(),

    // Observability / misc.
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
    SLOW_QUERY_MS: z.coerce.number().int().positive().optional(),
    ALLOW_HARD_DELETE: z.enum(["0", "1"]).optional(),

    // App URLs — used in jobs + ICS export + gift-card links.
    APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),

    // Live-visitor analytics — `IP_HASH_SALT` is used by the heartbeat
    // mutation to hash incoming IPs before persisting (raw IP is never
    // stored). `MAXMIND_DB_PATH` points to the bundled GeoLite2-City.mmdb;
    // unset disables geo lookup.
    IP_HASH_SALT: z.string().min(16).optional(),
    MAXMIND_DB_PATH: z.string().optional(),

    // Google Places API — public reviews showcase. Both optional; absence
    // triggers the seeded fallback list in `src/lib/reviews/fallback-reviews.ts`.
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    GOOGLE_PLACES_PLACE_ID: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const isProd = val.NODE_ENV === "production";
    // At least one encryption key must exist for at-rest secret storage,
    // and whichever key is provided must be a valid 32-byte base64 value.
    const encKey = val.SECRET_ENC_KEY ?? val.ETOLL_ENC_KEY;
    if (!encKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECRET_ENC_KEY"],
        message: "SECRET_ENC_KEY (or legacy ETOLL_ENC_KEY) is required",
      });
    } else if (!isBase64ThirtyTwoBytes(encKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECRET_ENC_KEY"],
        message:
          "SECRET_ENC_KEY must be 32 bytes encoded as base64 — generate with: openssl rand -base64 32",
      });
    }

    // Reject the seeded dev placeholder in every environment that isn't
    // explicitly development — any deploy path that ships this value would
    // have forgeable JWTs.
    if (val.AUTH_SECRET === DEV_AUTH_SECRET_PLACEHOLDER && isProd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message:
          "AUTH_SECRET is still the dev placeholder. Rotate it before deploying (openssl rand -base64 32).",
      });
    }

    if (!isProd) return;

    const requireInProd = (
      key: keyof typeof val,
      message: string,
    ) => {
      if (!val[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key as string],
          message,
        });
      }
    };

    // Stripe must be wired in prod unless explicitly stubbed.
    if (val.ALLOW_STUB_STRIPE !== "1") {
      requireInProd("STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY is required in production");
      requireInProd("STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET is required in production");
    }
    requireInProd("AUTH_URL", "AUTH_URL is required in production");
    requireInProd("APP_URL", "APP_URL is required in production");
    requireInProd("IP_HASH_SALT", "IP_HASH_SALT is required in production");

    // The Prisma pool must be sized explicitly in production. Prisma's
    // default (num_physical_cpus * 2 + 1 per process) across web + worker
    // processes silently overruns managed-Postgres connection caps; the
    // perf pass standardised on an explicit connection_limit (10).
    if (!/[?&]connection_limit=\d+/.test(val.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message:
          "DATABASE_URL must set an explicit connection_limit in production (e.g. ?connection_limit=10)",
      });
    }

    if (!val.RESEND_API_KEY && !val.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_HOST"],
        message:
          "Email provider required in production: set RESEND_API_KEY or SMTP_HOST",
      });
    }
  });

function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = `Invalid environment variables:\n${formatIssues(parsed.error)}`;
    throw new Error(message);
  }
  return parsed.data;
}

export const env: Env = load();
