/**
 * Per-event price estimates for Sentry observability quotas, in AUD.
 *
 * Sentry bills on reserved volume + on-demand at rates that vary by plan, so
 * we can't hardcode an authoritative number. These are *estimates* used to
 * give the Platform > Observability tab a projected-spend figure; override any
 * of them once your plan's true per-event rate is known via env:
 *
 *   SENTRY_PRICE_ERROR        AUD per accepted error      (default 0.0005)
 *   SENTRY_PRICE_TRANSACTION  AUD per accepted transaction (default 0.00003)
 *   SENTRY_PRICE_REPLAY       AUD per accepted replay      (default 0.004)
 *   SENTRY_PRICE_ATTACHMENT   AUD per accepted attachment  (default 0.0000003)
 *
 * Cost is derived on read (not stored on the snapshot) so re-pricing is just
 * an env change — no backfill needed.
 */

export const OBSERVABILITY_METRICS = ["error", "transaction", "replay", "attachment"] as const;
export type ObservabilityMetric = (typeof OBSERVABILITY_METRICS)[number];

const DEFAULT_RATES_AUD: Record<ObservabilityMetric, number> = {
  error: 0.0005,
  transaction: 0.00003,
  replay: 0.004,
  attachment: 0.0000003,
};

const ENV_KEYS: Record<ObservabilityMetric, string> = {
  error: "SENTRY_PRICE_ERROR",
  transaction: "SENTRY_PRICE_TRANSACTION",
  replay: "SENTRY_PRICE_REPLAY",
  attachment: "SENTRY_PRICE_ATTACHMENT",
};

/** Resolve the per-event AUD rate for a metric, honouring env overrides. */
export function ratePerEventAud(metric: string): number {
  if (!(metric in DEFAULT_RATES_AUD)) return 0;
  const key = ENV_KEYS[metric as ObservabilityMetric];
  const raw = process.env[key];
  if (raw != null && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_RATES_AUD[metric as ObservabilityMetric];
}

/** Estimated AUD cost for `quantity` accepted events of `metric`. */
export function estimateCostAud(metric: string, quantity: number): number {
  return ratePerEventAud(metric) * quantity;
}

/** True when any rate has been overridden from its placeholder default. */
export function hasCustomPricing(): boolean {
  return OBSERVABILITY_METRICS.some((m) => {
    const raw = process.env[ENV_KEYS[m]];
    return raw != null && raw.trim() !== "";
  });
}
