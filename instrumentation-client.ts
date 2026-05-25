import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./src/lib/observability/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.NODE_ENV,
    enabled: process.env.NODE_ENV !== "test",
    beforeSend: scrubSentryEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
