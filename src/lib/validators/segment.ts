import { z } from "zod";

const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"] as const;

export const RiskRatingValues = ["LOW", "MEDIUM", "HIGH"] as const;

export const segmentFilterSchema = z.discriminatedUnion("dimension", [
  z.object({
    dimension: z.literal("AGE_RANGE"),
    min: z.number().int().min(16).max(120).optional(),
    max: z.number().int().min(16).max(120).optional(),
  }),
  z.object({
    dimension: z.literal("STATE"),
    states: z.array(z.enum(AU_STATES)).min(1),
  }),
  z.object({
    dimension: z.literal("POSTCODE_PREFIX"),
    prefixes: z.array(z.string().regex(/^\d{1,4}$/)).min(1),
  }),
  z.object({
    dimension: z.literal("DEPOT"),
    depotIds: z.array(z.string()).min(1),
  }),
  z.object({
    dimension: z.literal("LAST_RENTED_WITHIN"),
    days: z.number().int().positive().max(3650),
  }),
  z.object({
    dimension: z.literal("LAST_RENTED_BEFORE"),
    days: z.number().int().positive().max(3650),
  }),
  z.object({
    dimension: z.literal("NEVER_RENTED"),
  }),
  z.object({
    dimension: z.literal("TOTAL_SPEND_MIN"),
    amount: z.number().nonnegative(),
  }),
  z.object({
    dimension: z.literal("TOTAL_BOOKINGS_MIN"),
    count: z.number().int().nonnegative(),
  }),
  z.object({
    dimension: z.literal("CATEGORY_RENTED"),
    categoryIds: z.array(z.string()).min(1),
  }),
  z.object({
    dimension: z.literal("CATEGORY_NEVER_RENTED"),
    categoryIds: z.array(z.string()).min(1),
  }),
  z.object({
    dimension: z.literal("LICENCE_STATE"),
    states: z.array(z.enum(AU_STATES)).min(1),
  }),
  z.object({
    dimension: z.literal("LICENCE_EXPIRING_WITHIN"),
    days: z.number().int().positive().max(3650),
  }),
  z.object({
    dimension: z.literal("LOYALTY_POINTS_MIN"),
    points: z.number().int().nonnegative(),
  }),
  z.object({
    dimension: z.literal("RISK_RATING"),
    ratings: z.array(z.enum(RiskRatingValues)).min(1),
  }),
  z.object({
    dimension: z.literal("MARKETING_EMAIL_OPT_IN"),
    value: z.boolean(),
  }),
  z.object({
    dimension: z.literal("MARKETING_SMS_OPT_IN"),
    value: z.boolean(),
  }),
  z.object({
    dimension: z.literal("CUSTOMER_SINCE_BEFORE"),
    date: z.coerce.date(),
  }),
  z.object({
    dimension: z.literal("CUSTOMER_SINCE_AFTER"),
    date: z.coerce.date(),
  }),
  z.object({
    dimension: z.literal("BIRTHDAY_MONTH"),
    month: z.number().int().min(1).max(12),
  }),
]);

export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

export const segmentFiltersSchema = z.object({
  combinator: z.literal("AND").default("AND"),
  filters: z.array(segmentFilterSchema).min(1),
});

export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;

export const segmentCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  filters: segmentFiltersSchema,
});

export const segmentUpdateSchema = segmentCreateSchema.partial().extend({
  id: z.string(),
});
