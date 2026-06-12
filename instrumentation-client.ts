import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./src/lib/observability/sentry-scrub";
import { sentryTracesSampleRate } from "./src/lib/observability/sentry-sample-rate";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: sentryTracesSampleRate(),
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.NODE_ENV,
    enabled: process.env.NODE_ENV !== "test",
    beforeSend: scrubSentryEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
