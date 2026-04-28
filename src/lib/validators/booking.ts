import { z } from "zod";

import {
  AU_STATES,
  enforceAtLeastOneValidId,
  licenceExpirySchema,
  passportExpirySchema,
} from "@/lib/validators/identity";

const AU_PHONE = /^[\d\s+()-]{8,15}$/;

export const searchStepSchema = z
  .object({
    pickupDepotId: z.string().min(1, "Please choose a pickup location."),
    returnDepotId: z.string().min(1, "Please choose a return location."),
    pickupDateTime: z.string().min(1, "Please select when you'd like to pick up."),
    returnDateTime: z.string().min(1, "Please select when you'll return the vehicle."),
    categoryId: z.string().min(1, "Please select a vehicle type."),
  })
  .superRefine((v, ctx) => {
    const pickup = new Date(v.pickupDateTime);
    const ret = new Date(v.returnDateTime);
    const now = new Date();
    if (pickup <= now) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pickupDateTime"],
        message: "Pickup must be in the future — choose an upcoming date and time.",
      });
    }
    if (ret <= pickup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnDateTime"],
        message: "Return must be after your pickup — check the dates.",
      });
      return;
    }
    const hours = (ret.getTime() - pickup.getTime()) / (1000 * 60 * 60);
    if (hours < 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnDateTime"],
        message: "Minimum hire is 4 hours — extend your return time a bit.",
      });
    }
  });
export type SearchStepValues = z.infer<typeof searchStepSchema>;

/**
 * Customer details step.
 *
 * Identity validation has two modes driven by `identityPath`:
 *
 * - `"AU_LICENCE"` — the customer holds an Australian driver's licence.
 *   Requires the full AU licence triplet (number + state + expiry); class
 *   is optional because not every state prints one. Passport is not
 *   needed.
 *
 * - `"INTERNATIONAL"` — the customer is using an International Driver's
 *   Permit. Requires the IDP triplet (number + licenceCountry + expiry)
 *   AND the passport triplet (number + country + expiry). Both documents
 *   are mandatory.
 *
 * - `null` or undefined — legacy mode (`wizard_intl_licence_flow=off`).
 *   Falls back to the pre-refactor "at least one valid ID" rule: either
 *   a licence triplet OR a passport triplet is sufficient. This keeps
 *   the flag-off rollout path identical to previous behaviour.
 */
export const detailsStepSchema = z
  .object({
    firstName: z.string().min(1, "We need your first name for the booking."),
    lastName: z.string().min(1, "We need your last name for the booking."),
    email: z.string().email("That doesn't look like a valid email — double-check for typos."),
    phone: z
      .string()
      .optional()
      .refine((v) => !v || AU_PHONE.test(v), {
        message: "Please enter a valid Australian phone number (e.g. 0412 345 678).",
      }),
    dateOfBirth: z.string().min(1, "We need your date of birth to verify your age."),
    // Identity path gate (optional — only set when wizard_intl_licence_flow is ON).
    identityPath: z.enum(["AU_LICENCE", "INTERNATIONAL"]).optional(),
    // Licence triplet (validation depends on identityPath — see superRefine).
    licenceNumber: z.string().optional().default(""),
    licenceState: z.enum(AU_STATES).optional(),
    // Issuing country for an International Driver's Permit (ISO-3166 alpha-2).
    licenceCountry: z.string().optional().default(""),
    licenceExpiry: z.string().optional().default(""),
    licenceClass: z.string().optional().default(""),
    // Passport triplet (required when identityPath = INTERNATIONAL).
    passportNumber: z.string().optional().default(""),
    passportCountry: z.string().optional().default(""),
    passportExpiry: z.string().optional().default(""),
    emergencyContactName: z.string().optional().default(""),
    emergencyContactPhone: z
      .string()
      .optional()
      .refine((v) => !v || AU_PHONE.test(v), {
        message: "Please enter a valid phone number for your emergency contact.",
      }),
  })
  .superRefine((v, ctx) => {
    // Age gate (18–100) on pickup-independent basis; server re-checks
    // against pickupDate which is the authoritative evaluation.
    const dob = new Date(v.dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
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
    }

    // Per-document expiry validation (fires whenever the expiry is supplied,
    // regardless of identityPath — a supplied-but-expired date is always
    // wrong).
    if (v.licenceExpiry) {
      const r = licenceExpirySchema.safeParse(v.licenceExpiry);
      if (!r.success) {
        const msg = r.error.issues[0]?.message ?? "Your licence has expired.";
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceExpiry"],
          message: msg,
        });
      }
    }
    if (v.passportExpiry) {
      const r = passportExpirySchema.safeParse(v.passportExpiry);
      if (!r.success) {
        const msg = r.error.issues[0]?.message ?? "Your passport has expired.";
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["passportExpiry"],
          message: msg,
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
      }
      if (!v.licenceExpiry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenceExpiry"],
          message: "Your licence expiry date is required.",
        });
      }
      return;
    }

    if (v.identityPath === "INTERNATIONAL") {
      // IDP block.
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
      // Passport block (mandatory alongside IDP).
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
      return;
    }

    // Legacy mode (identityPath unset) — mirror the server rule: at least
    // one complete ID triplet.
    enforceAtLeastOneValidId(
      {
        number: v.licenceNumber,
        state: v.licenceState,
        expiry: v.licenceExpiry,
        class: v.licenceClass,
      },
      {
        number: v.passportNumber,
        country: v.passportCountry,
        expiry: v.passportExpiry,
      },
      ctx,
      ["licenceNumber"],
    );
  });
export type DetailsStepValues = z.infer<typeof detailsStepSchema>;
