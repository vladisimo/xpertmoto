import { z } from "zod";

export const LICENCE_REQUIREMENTS = ["CAR", "RE", "R"] as const;
export type LicenceRequirement = (typeof LICENCE_REQUIREMENTS)[number];

// Phase A1 — strategies admins can pick for a given category. FULL keeps
// the legacy "charge 100% upfront" behaviour; FLAT/PERCENT collect just
// a booking fee and leave the rest to be paid at pickup; ZERO collects
// nothing online (the bond is still authorised).
export const ONLINE_PAYMENT_STRATEGIES = ["FULL", "FLAT", "PERCENT", "ZERO"] as const;
export type OnlinePaymentStrategyValue = (typeof ONLINE_PAYMENT_STRATEGIES)[number];

// Phase A2 — cadence for recurring charges on long-term hires.
export const BILLING_FREQUENCIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;
export type BillingFrequencyValue = (typeof BILLING_FREQUENCIES)[number];

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const decimal = z
  .number({ invalid_type_error: "Enter a number" })
  .nonnegative("Must be zero or greater")
  .max(999999, "Too large");

const optionalDecimal = z
  .number({ invalid_type_error: "Enter a number" })
  .nonnegative("Must be zero or greater")
  .max(999999, "Too large")
  .nullable()
  .optional();

const percent = z
  .number({ invalid_type_error: "Enter a number" })
  .min(0, "Must be zero or greater")
  .max(100, "Cannot exceed 100%")
  .nullable()
  .optional();

// Base object without the cross-field superRefine so `.partial()` still
// works for the update schema. The create/edit form uses categoryFormSchema
// (which adds the strategy-specific validation on top).
const categoryBaseSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(80, "Keep it under 80 characters"),
    slug: z
      .string()
      .trim()
      .min(1, "Slug is required")
      .max(80, "Keep it under 80 characters")
      .regex(SLUG_RE, "Use lowercase letters, numbers and hyphens only (e.g. 125cc-scooter)"),
    description: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
    engineCapacity: z
      .number({ invalid_type_error: "Enter an engine capacity in cc" })
      .int("Use whole numbers")
      .min(1, "Must be at least 1cc")
      .max(20000, "That looks too big — double check the value"),
    licenceRequired: z.enum(LICENCE_REQUIREMENTS, {
      errorMap: () => ({ message: "Pick CAR, RE or R (heavy classes not supported yet)" }),
    }),
    minAge: z
      .number({ invalid_type_error: "Enter an age" })
      .int("Use whole numbers")
      .min(16, "Minimum supported age is 16")
      .max(100, "That's not a valid age"),
    displayOrder: z.number().int().min(0).max(9999).default(0),
    baseDailyRate: decimal,
    baseWeeklyRate: decimal,
    baseMonthlyRate: decimal,
    bondAmount: decimal,
    images: z.array(z.string().url("Image URLs must be valid URLs")).max(10, "Maximum of 10 images").default([]),

    // Phase A1 — online payment strategy.
    onlinePaymentStrategy: z.enum(ONLINE_PAYMENT_STRATEGIES).default("FULL"),
    bookingFeeFlat: optionalDecimal,
    bookingFeePercent: percent,

    // Phase A2 — progressive billing for long-term hires. When
    // longTermMinDays is null/undefined progressive billing is disabled
    // for this category.
    longTermMinDays: z
      .number({ invalid_type_error: "Enter a day count" })
      .int("Use whole numbers")
      .min(1, "Must be at least 1 day")
      .max(365, "Keep it under a year")
      .nullable()
      .optional(),
    longTermDefaultFrequency: z.enum(BILLING_FREQUENCIES).default("WEEKLY"),
  });

export const categoryFormSchema = categoryBaseSchema.superRefine((data, ctx) => {
  // Strategy-specific fields must be present when the strategy needs them.
  if (data.onlinePaymentStrategy === "FLAT") {
    if (data.bookingFeeFlat == null || data.bookingFeeFlat <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bookingFeeFlat"],
        message: "Enter a flat booking fee (in AUD).",
      });
    }
  }
  if (data.onlinePaymentStrategy === "PERCENT") {
    if (data.bookingFeePercent == null || data.bookingFeePercent <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bookingFeePercent"],
        message: "Enter a deposit percentage (1–100).",
      });
    }
  }
});

export type CategoryFormInput = z.infer<typeof categoryFormSchema>;

export const categoryUpdateSchema = categoryBaseSchema.partial().extend({
  id: z.string().min(1),
});

export const categoryReorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

const disposeStatus = z.enum(["SOLD", "WRITTEN_OFF", "END_OF_LIFE", "STOLEN"]);

export const categoryArchiveSchema = z.object({
  id: z.string().min(1),
  vehicleActions: z
    .array(
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("REASSIGN"),
          vehicleId: z.string().min(1),
          targetCategoryId: z.string().min(1),
        }),
        z.object({
          action: z.literal("DISPOSE"),
          vehicleId: z.string().min(1),
          targetStatus: disposeStatus,
          reason: z.string().trim().min(1, "Reason is required"),
          salePrice: z.number().nonnegative().optional(),
        }),
      ]),
    )
    .default([]),
});

export type CategoryArchiveInput = z.infer<typeof categoryArchiveSchema>;
