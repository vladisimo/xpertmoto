import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Fail-fast env validation. Throws with a Zod-formatted list of the
  // missing/invalid vars so the process never boots with partial config.
  // Edge runtime doesn't use the full env surface, so validation is
  // confined to the Node runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./src/lib/env");
    if (process.env.SENTRY_DSN) {
      await import("./sentry.server.config");
    }
  }
  if (process.env.NEXT_RUNTIME === "edge" && process.env.SENTRY_DSN) {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
