/**
 * Trace sampling, env-tunable without a deploy. Sampling was hardcoded at
 * 0.1 in production across all four runtimes (server/edge/client/worker);
 * under load that volume both costs quota and buffers enough spans to
 * matter for memory. 0.05 is plenty for latency percentiles at this
 * traffic; raise it temporarily via env when investigating.
 *
 * SENTRY_TRACES_SAMPLE_RATE covers the Node/edge runtimes;
 * NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE is the build-time-inlined variant
 * the browser bundle can see. Out-of-range or non-numeric values fall back
 * to the default rather than silently disabling tracing.
 */
export function sentryTracesSampleRate(): number {
  const raw =
    process.env.SENTRY_TRACES_SAMPLE_RATE ??
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return process.env.NODE_ENV === "production" ? 0.05 : 1.0;
}
