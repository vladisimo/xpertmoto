/**
 * Zod schemas powering the customer onboarding wizard. These mirror the
 * relevant slices of `src/lib/validators/booking.ts` (Step 4 of the
 * booking wizard) but split per onboarding step so each tRPC procedure
 * validates a tightly-scoped payload.
 *
 * Used by:
 *   - src/server/trpc/router/onboarding.ts (server-side validation)
 *   - src/components/onboarding/step-*.tsx (client-side react-hook-form
 *     resolvers)
 */
import { z } from "zod";

import { AU_STATES, licenceExpirySchema, passportExpirySchema } from "@/lib/validators/identity";

const AU_PHONE = /^[\d\s+()-]{8,15}$/;

/** Step 1 — profile basics. firstName/lastName/email come from User and
 * are not editable in the wizard, so this schema does not include them. */
export const onboardingProfileSchema = z
  .object({
    dateOfBirth: z.string().min(1, "We need your date of birth to verify your age."),
    addressLine1: z.string().min(1, "Please enter your street address."),
    addressLine2: z.string().optional().default(""),
    suburb: z.string().min(1, "Please enter your suburb."),
    state: z.string().min(1, "Please enter your state."),
    postcode: z
      .string()
      .min(3, "Please enter a valid postcode.")
      .max(10, "That postcode looks too long."),
    country: z.string().min(1, "Please enter your country.").default("Australia"),
    phone: z
      .string()
      .min(1, "Please enter a contact phone number.")
      .refine((v) => AU_PHONE.test(v), {
        message: "Please enter a valid phone number (e.g. 0412 345 678).",
      }),
    emergencyContactName: z
      .string()
      .min(1, "Please enter the name of an emergency contact."),
    emergencyContactPhone: z
      .string()
      .min(1, "Please enter a phone number for your emergency contact.")
      .refine((v) => AU_PHONE.test(v), {
        message: "Please enter a valid phone number for your emergency contact.",
      }),
    emergencyContactRelationship: z
      .string()
      .min(1, "What's their relationship to you? (e.g. Parent, Partner, Friend)"),
  })
  .superRefine((v, ctx) => {
    const dob = new Date(v.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: "That date of birth doesn't look right — use the date picker.",
      });
      return;
    }
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: "You must be at least 18 years old to hire a vehicle.",
      });
    } else if (age > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: "Please check your date of birth — that doesn't seem right.",
      });
    }
  });
export type OnboardingProfileValues = z.infer<typeof onboardingProfileSchema>;

/** Step 3 — identity documents. Validation diverges by `identityPath`.
 * Fields are typed as plain `z.string()` (defaulting to "" at the
 * client) so the form data uses the same type for input and output —
 * .optional().default() chains produce divergent input/output shapes
 * that confuse the react-hook-form resolver. The superRefine below
 * does the real per-field requiredness checks. */
export const onboardingIdentitySchema = z
  .object({
    identityPath: z.enum(["AU_LICENCE", "INTERNATIONAL"], {
      errorMap: () => ({ message: "Please tell us which licence you'll use." }),
    }),
    licenceNumber: z.string(),
    // Plain string here so the resolver's input type matches the form
    // data type (the form starts with empty string). The superRefine
    // below validates the value against AU_STATES when identityPath is
    // AU_LICENCE.
    licenceState: z.string(),
    licenceCountry: z.string(),
    licenceExpiry: z.string(),
    licenceClass: z.string(),
    licenceImageFrontKey: z.string(),
    licenceImageBackKey: z.string(),
    passportNumber: z.string(),
    passportCountry: z.string(),
    passportExpiry: z.string(),
    passportImageKey: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.licenceExpiry) {
      const r = licenceExpirySchema.safeParse(v.licenceExpiry);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceExpiry"],
          message: r.error.issues[0]?.message ?? "Your licence has expired.",
        });
      }
    }
    if (v.passportExpiry) {
      const r = passportExpirySchema.safeParse(v.passportExpiry);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["passportExpiry"],
          message: r.error.issues[0]?.message ?? "Your passport has expired.",
        });
      }
    }

    if (v.identityPath === "AU_LICENCE") {
      if (!v.licenceNumber || v.licenceNumber.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceNumber"],
          message: "Enter the licence number printed on your card.",
        });
      }
      if (!v.licenceState) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceState"],
          message: "Pick the state that issued your licence.",
        });
      } else if (!(AU_STATES as readonly string[]).includes(v.licenceState)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceState"],
          message: "Pick a valid state.",
        });
      }
      if (!v.licenceExpiry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceExpiry"],
          message: "Your licence expiry date is required.",
        });
      }
      if (!v.licenceImageFrontKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceImageFrontKey"],
          message: "Please upload a photo of the front of your licence.",
        });
      }
      return;
    }

    // INTERNATIONAL
    if (!v.licenceNumber || v.licenceNumber.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["licenceNumber"],
        message: "Enter the IDP number.",
      });
    }
    if (!v.licenceCountry || v.licenceCountry.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["licenceCountry"],
        message: "Enter the country that issued your IDP (2-letter code).",
      });
    } else if (!/^[A-Za-z]{2}$/u.test(v.licenceCountry.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["licenceCountry"],
        message: "Use a 2-letter ISO country code (e.g. US, GB, NZ).",
      });
    }
    if (!v.licenceExpiry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["licenceExpiry"],
        message: "Your IDP expiry date is required.",
      });
    }
    if (!v.licenceImageFrontKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["licenceImageFrontKey"],
        message: "Please upload a photo of your International Driving Permit.",
      });
    }
    if (!v.passportNumber || v.passportNumber.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passportNumber"],
        message: "Enter your passport number.",
      });
    }
    if (!v.passportCountry || v.passportCountry.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passportCountry"],
        message: "Enter the country that issued your passport.",
      });
    }
    if (!v.passportExpiry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passportExpiry"],
        message: "Your passport expiry date is required.",
      });
    }
    if (!v.passportImageKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passportImageKey"],
        message: "Please upload a photo of your passport.",
      });
    }
  });
export type OnboardingIdentityValues = z.infer<typeof onboardingIdentitySchema>;

/** Step 4 — consent acceptance. Each consent must be explicitly checked;
 * marketing sub-flags are independent (you can accept the marketing doc
 * but opt out of every channel — the doc itself describes that you'll
 * still receive transactional messages). */
export const onboardingConsentsSchema = z.object({
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Hire to continue." }),
  }),
  acceptedPrivacy: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Privacy Policy to continue." }),
  }),
  acceptedCancellation: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Cancellation Policy to continue." }),
  }),
  acceptedMarketing: z.literal(true, {
    errorMap: () => ({ message: "You must acknowledge the Marketing Consent document to continue." }),
  }),
  marketingEmailOptIn: z.boolean().default(false),
  marketingSmsOptIn: z.boolean().default(false),
});
export type OnboardingConsentsValues = z.infer<typeof onboardingConsentsSchema>;

/** Step 5 — signature. Captured client-side as a PNG data URL; uploaded
 * by `onboarding.generateSignedPdfs` server-side which decodes, persists
 * to S3 once, and reuses the resulting key across all four PDFs. */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u;
export const onboardingSignatureSchema = z.object({
  signatureDataUrl: z
    .string()
    .min(1, "Please draw your signature.")
    .regex(PNG_DATA_URL, "Signature was not captured as a PNG."),
});
export type OnboardingSignatureValues = z.infer<typeof onboardingSignatureSchema>;
