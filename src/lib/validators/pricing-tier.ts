import { z } from "zod";

export const PRICING_TIER_SCOPES = ["CATEGORY", "MODEL", "VEHICLE"] as const;
export type PricingTierScope = (typeof PRICING_TIER_SCOPES)[number];

export const TIER_MODES = ["PROGRESSIVE", "PER_WEEK"] as const;
export type TierMode = (typeof TIER_MODES)[number];

const tierRowSchema = z
  .object({
    minDays: z
      .number({ invalid_type_error: "Enter a day count" })
      .int("Use whole numbers")
      .min(1, "Must be at least 1 day")
      .max(3650, "Keep it under 10 years"),
    maxDays: z
      .number({ invalid_type_error: "Enter a day count" })
      .int("Use whole numbers")
      .min(1, "Must be at least 1 day")
      .max(3650, "Keep it under 10 years"),
    tierMode: z.enum(TIER_MODES).default("PROGRESSIVE"),
    // Used when tierMode = PROGRESSIVE. Falls back to 0 for PER_WEEK rows.
    tierTotal: z
      .number({ invalid_type_error: "Enter an amount" })
      .nonnegative("Must be zero or greater")
      .max(999999, "Too large")
      .default(0),
    // Used when tierMode = PER_WEEK.
    pricePerWeek: z
      .number({ invalid_type_error: "Enter an amount" })
      .nonnegative("Must be zero or greater")
      .max(999999, "Too large")
      .nullable()
      .optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((row, ctx) => {
    if (row.tierMode === "PER_WEEK") {
      if (row.pricePerWeek == null || row.pricePerWeek <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricePerWeek"],
          message: "Per-week tiers need a positive weekly rate",
        });
      }
    }
  });

export type PricingTierRowInput = z.infer<typeof tierRowSchema>;

const scopeTarget = z.object({
  scope: z.enum(PRICING_TIER_SCOPES),
  scopeId: z.string().min(1, "Pick a category, model, or vehicle"),
});

export const pricingTierListInputSchema = scopeTarget;

export const pricingTierDeleteInputSchema = scopeTarget;

/** Replace the entire tier ladder for a scope in a single transaction.
 *  Enforces: first tier starts at day 1; tiers are contiguous (each row
 *  starts the day after the previous ended); no overlaps; minDays ≤ maxDays. */
export const pricingTierReplaceInputSchema = scopeTarget
  .extend({
    tiers: z.array(tierRowSchema).max(50, "Too many tiers — keep it under 50"),
  })
  .superRefine((data, ctx) => {
    const { tiers } = data;
    if (tiers.length === 0) return;

    tiers.forEach((row, i) => {
      if (row.minDays > row.maxDays) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tiers", i, "maxDays"],
          message: "End day must be the same as or after the start day",
        });
      }
    });

    if (tiers[0]!.minDays !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", 0, "minDays"],
        message: "First tier must start at day 1",
      });
    }

    for (let i = 1; i < tiers.length; i++) {
      const prev = tiers[i - 1]!;
      const curr = tiers[i]!;
      if (curr.minDays !== prev.maxDays + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tiers", i, "minDays"],
          message: `Tier ${i + 1} must start at day ${prev.maxDays + 1}`,
        });
      }
    }
  });

export type PricingTierReplaceInput = z.infer<typeof pricingTierReplaceInputSchema>;
export type PricingTierListInput = z.infer<typeof pricingTierListInputSchema>;
export type PricingTierDeleteInput = z.infer<typeof pricingTierDeleteInputSchema>;
