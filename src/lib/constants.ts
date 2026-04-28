// Platform-vendor-agnostic defaults used only to seed SystemSetting when a
// deployment's database has never been configured. Runtime readers MUST
// call `getBranding()` from `@/lib/branding` (or the `org.*` settings)
// instead of importing these — a deployed customer configures their own
// trading name, legal name, ABN and social links via `/admin/settings`.
// These strings are deliberately generic placeholders so the absence of a
// real configuration is visible to the first admin who visits the site.
export const BRAND = {
  name: "Scooter Hire",
  legalName: "",
  tagline: "Ride Australia's best scooters & motorbikes",
  abn: "",
  acn: "",
  primary: "#1B6B4A",
  amber: "#F59E0B",
  sky: "#0EA5E9",
  bg: "#FAFAF9",
};

// Deployment-specific social links. Configure per deployment via the
// admin settings in a follow-up UI change; these defaults are empty to
// avoid pointing at another customer's social channels.
export const SOCIAL_LINKS = {
  facebook: "",
  instagram: "",
  linkedin: "",
  googleReviews: "",
} as const;

export const GST_RATE = 0.1;

export const BOOKING_RULES = {
  minDurationDays: 1,
  maxDurationDays: 90,
  advanceWindowDays: 180,
  cutoffMinutesBeforePickup: 60,
  bufferHoursBetweenBookings: 2,
  lateReturnGraceHours: 1,
  // Flag post-rental distance if it exceeds this per-day average.
  // 500 km/day is well past typical city hire use; anything higher is
  // likely a commercial abuse pattern we want staff to look at.
  fleetAnomalyKmPerDay: 500,
};

export const TYRE_RULES = {
  minTreadDepthMm: 2.0,
  warningKmSinceLastReplacement: 10000,
  inspectionStaleDays: 30,
};

export const DEBT_REMINDER_RULES = {
  cooldownDays: 7,
  minOutstandingAud: 1,
};

export const CANCELLATION_POLICY = {
  fullRefundHours: 72,
  halfRefundHours: 24,
  adminFee: 25,
  noShowFee: 50,
};

export const NO_SHOW_RULES = {
  graceHours: 2,
  reminderMinutesBefore: 30,
};

/**
 * Early-return refund policy. Not referenced by CLAUDE.md §5 (which only
 * covers cancellation + late return) — staff-gated by design: the
 * calculator computes an offer, but nothing deducts automatically.
 *
 * - `minUnusedDays`: whole days of unused rental must exceed this threshold
 *   before any refund is offered. Prevents trivial refunds when a customer
 *   returns a few hours early.
 * - `adminFee`: per-refund admin deduction (AUD, GST-inclusive).
 */
export const EARLY_RETURN_POLICY = {
  minUnusedDays: 1,
  adminFee: 0,
};

/**
 * AUD price per 1M tokens for Claude Haiku 4.5. Sonnet/Opus could be added
 * later when the feature escalates. Values are Anthropic's published list
 * prices in USD (input $1, output $5, cache read $0.10, cache write $1.25
 * per 1M) multiplied by USD_AUD_RATE. Refresh manually on FX shifts — the
 * admin metrics page reports cost to two decimal places, so drift of a
 * few percent is fine.
 */
export const USD_AUD_RATE = 1.55;
export const CLAUDE_HAIKU_4_5_PRICING_AUD = {
  input: 1.0 * USD_AUD_RATE,
  output: 5.0 * USD_AUD_RATE,
  cacheRead: 0.1 * USD_AUD_RATE,
  cacheWrite: 1.25 * USD_AUD_RATE,
};

/**
 * AUD price per 1M tokens for Claude Sonnet 4.6. Used by the OCR /
 * document-extract service (licence + passport vision tool calls).
 * Anthropic list prices: input $3, output $15, cache read $0.30,
 * cache write $3.75 per 1M tokens. Refresh on FX shifts.
 */
export const CLAUDE_SONNET_4_6_PRICING_AUD = {
  input: 3.0 * USD_AUD_RATE,
  output: 15.0 * USD_AUD_RATE,
  cacheRead: 0.3 * USD_AUD_RATE,
  cacheWrite: 3.75 * USD_AUD_RATE,
};
