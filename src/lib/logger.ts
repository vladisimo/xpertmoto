import pino, { type Logger } from "pino";

const isDev = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";

const redactPaths = [
  "*.password",
  "*.token",
  "*.authorization",
  "*.cookie",
  "*.licenceNumber",
  "*.licenceImageFront",
  "*.licenceImageBack",
  "*.passportNumber",
  "*.dateOfBirth",
  "*.emergencyContactName",
  "*.emergencyContactPhone",
  "*.address",
  "*.addressLine1",
  "*.addressLine2",
  "*.suburb",
  "*.postcode",
  "*.stripePaymentIntentId",
  "*.stripeChargeId",
  "*.stripeCustomerId",
  "*.stripePaymentMethodId",
  "*.stripeSetupIntentId",
  "*.pan",
  "*.cardNumber",
  "*.cvv",
  "*.cvc",
  "*.cardholderName",
  "*.email",
  "*.phone",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  // Visitor-analytics PII — geo and marketing attribution fields captured by
  // `live.heartbeat`. Raw IP never reaches here (only `ipHash`), but redact
  // anyway in case of accidental logging.
  "*.ipHash",
  "*.ipAddress",
  "*.country",
  "*.region",
  "*.city",
  "*.referrer",
  "*.utmSource",
  "*.utmMedium",
  "*.utmCampaign",
];

// HMR-safe singleton. Next.js dev re-imports this module across module
// realms (Node runtime, Edge runtime, instrumentation boot, route handler
// reloads). Without the globalThis cache, each re-import would build a new
// pino instance; pino-pretty's transport spawns a worker that pipes to
// `process.stdout`, and ~11 reloads later Node fires
// MaxListenersExceededWarning on stdout. Mirrors src/lib/prisma.ts.
const globalForLogger = globalThis as unknown as { logger?: Logger };

function createLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
    enabled: !isTest,
    base: {
      app: "scootering",
      env: process.env.NODE_ENV ?? "development",
    },
    redact: { paths: redactPaths, remove: false, censor: "[REDACTED]" },
    transport: isDev
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", singleLine: false },
        }
      : undefined,
  });
}

export const logger: Logger = globalForLogger.logger ?? createLogger();

if (process.env.NODE_ENV !== "production") globalForLogger.logger = logger;

export type { Logger };
