import { z } from "zod";

/**
 * Shared shapes for `AnalyticsSegment.filter`, `AnalyticsFunnel.steps`,
 * and `AnalyticsAlert.metric`. Used on both the tRPC write path (zod
 * validation) and the client-side form components (type inference).
 */

// ---------------------------------------------------------------------
// Segments — a named snapshot of the analytics filter bar state.
// Intentionally narrow: range/segment/country/utm/wizard/step/dow/hour
// + the wizard-cart columns. Stored as JSON on AnalyticsSegment.filter.
// ---------------------------------------------------------------------

export const SEGMENT_FILTER_SCHEMA = z.object({
  range: z.enum(["TODAY", "7D", "30D", "90D"]).optional(),
  segment: z.enum(["ALL", "MOBILE", "DESKTOP", "TABLET", "BOT_EXCL"]).optional(),
  country: z.string().length(2).optional(),
  landingPath: z.string().min(1).max(500).optional(),
  utmSource: z.string().min(1).max(200).optional(),
  utmMedium: z.string().min(1).max(200).optional(),
  utmCampaign: z.string().min(1).max(200).optional(),
  referrerDomain: z.string().min(1).max(200).optional(),
  wizardStepEq: z.number().int().min(1).max(6).optional(),
  dow: z.number().int().min(0).max(6).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  pickupDepotId: z.string().min(1).max(64).optional(),
  categoryId: z.string().min(1).max(64).optional(),
  vehicleId: z.string().min(1).max(64).optional(),
  discountCode: z.string().min(1).max(64).optional(),
});

export type SegmentFilter = z.infer<typeof SEGMENT_FILTER_SCHEMA>;

// ---------------------------------------------------------------------
// Funnels — ordered list of steps, each a path match, an event match,
// or an outcome match. Evaluated by the `funnels.evaluate` tRPC
// procedure which counts sessions passing each step in order.
// ---------------------------------------------------------------------

export const FUNNEL_STEP_SCHEMA = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("path"),
    label: z.string().min(1).max(80),
    match: z.string().min(1).max(500), // exact path match; supports trailing wildcard via "*" suffix
  }),
  z.object({
    kind: z.literal("event"),
    label: z.string().min(1).max(80),
    eventKind: z.enum([
      "CLICK",
      "CTA_CLICK",
      "FLEET_VIEW",
      "FLEET_CLICK",
      "SEARCH",
      "DISCOUNT_ATTEMPTED",
      "DISCOUNT_APPLIED",
      "WIZARD_STEP_ENTER",
      "SCROLL_DEPTH",
      "EXIT_INTENT",
      "RAGE_CLICK",
    ]),
    target: z.string().min(1).max(120).optional(),
  }),
  z.object({
    kind: z.literal("outcome"),
    label: z.string().min(1).max(80),
    outcome: z.enum(["CONVERTED", "ABANDONED_WIZARD", "BOUNCED", "LEFT"]),
  }),
  z.object({
    kind: z.literal("wizardStep"),
    label: z.string().min(1).max(80),
    minStep: z.number().int().min(1).max(6),
  }),
]);

export type FunnelStep = z.infer<typeof FUNNEL_STEP_SCHEMA>;

export const FUNNEL_STEPS_SCHEMA = z.array(FUNNEL_STEP_SCHEMA).min(2).max(8);

// ---------------------------------------------------------------------
// Alerts — metric keys that the evaluator knows how to measure. Each
// value maps to a computation in `evaluateAlertMetric`.
// ---------------------------------------------------------------------

export const ALERT_METRICS = [
  "sessions_last_hour",
  "bounces_last_hour",
  "conversions_last_hour",
  "abandoned_wizard_last_hour",
  "exit_intents_last_hour",
  "rage_clicks_last_hour",
  "dead_clicks_last_hour",
  "at_risk_count",
  "conversion_rate_last_24h",
  "bounce_rate_last_24h",
  "avg_engagement_score_last_24h",
] as const;

export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_METRIC_LABEL: Record<AlertMetric, string> = {
  sessions_last_hour: "Sessions in last hour",
  bounces_last_hour: "Bounces in last hour",
  conversions_last_hour: "Conversions in last hour",
  abandoned_wizard_last_hour: "Abandoned wizards in last hour",
  exit_intents_last_hour: "Exit-intent events in last hour",
  rage_clicks_last_hour: "Rage-click events in last hour",
  dead_clicks_last_hour: "Dead-click events in last hour",
  at_risk_count: "Sessions currently at risk",
  conversion_rate_last_24h: "Conversion rate (last 24h, 0–1)",
  bounce_rate_last_24h: "Bounce rate (last 24h, 0–1)",
  avg_engagement_score_last_24h: "Avg engagement score (last 24h)",
};

export const ALERT_OPERATORS = [">", "<", ">=", "<=", "=="] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];

export const ALERT_SCHEMA = z.object({
  name: z.string().min(1).max(120),
  metric: z.enum(ALERT_METRICS),
  operator: z.enum(ALERT_OPERATORS),
  threshold: z.number().finite(),
  notifyEmails: z.array(z.string().email()).min(1).max(20),
  cooldownMinutes: z.number().int().min(5).max(1440).default(60),
  isActive: z.boolean().default(true),
});

export type AlertInput = z.infer<typeof ALERT_SCHEMA>;

/**
 * Pure operator evaluator. Used by the BullMQ job to decide whether
 * the observed value crosses the threshold, and by tests.
 */
export function evaluateOperator(
  value: number,
  operator: AlertOperator,
  threshold: number,
): boolean {
  switch (operator) {
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
  }
}

/**
 * Does this alert's cooldown window allow it to fire right now?
 * Returns true when `lastFiredAt` is null or older than
 * `cooldownMinutes` ago. Pure — the evaluator passes `now` so tests
 * can use a fixed clock.
 */
export function cooldownElapsed(
  lastFiredAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): boolean {
  if (!lastFiredAt) return true;
  return now.getTime() - lastFiredAt.getTime() >= cooldownMinutes * 60_000;
}
