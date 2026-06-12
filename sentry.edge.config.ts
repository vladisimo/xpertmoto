import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./src/lib/observability/sentry-scrub";
import { sentryTracesSampleRate } from "./src/lib/observability/sentry-sample-rate";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: sentryTracesSampleRate(),
    environment: process.env.NODE_ENV,
    enabled: process.env.NODE_ENV !== "test",
    beforeSend: scrubSentryEvent,
  });
}
