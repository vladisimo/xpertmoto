import { z } from "zod";
import { CONSENT_DOC_KEYS } from "@/lib/consent-documents";

export const AU_STATES = [
  "QLD",
  "NSW",
  "VIC",
  "TAS",
  "SA",
  "WA",
  "NT",
  "ACT",
] as const;

export const OTHER_DOC_TYPES = [
  { value: "VISA", label: "Visa" },
  { value: "INTL_DRIVING_PERMIT", label: "Intl driving permit" },
  { value: "PROOF_OF_ADDRESS", label: "Proof of address" },
  { value: "OTHER", label: "Other" },
] as const;

export const otherDocumentSchema = z.object({
  type: z.enum([
    "PASSPORT",
    "LICENCE_FRONT",
    "LICENCE_BACK",
    "VISA",
    "INTL_DRIVING_PERMIT",
    "PROOF_OF_ADDRESS",
    "OTHER",
  ]),
  fileUrl: z.string().min(1, { message: "Upload a file" }),
  label: z.string().optional(),
  expiryDate: z.string().optional(),
});

export const signedConsentSchema = z.object({
  docKey: z.enum(CONSENT_DOC_KEYS),
  fileUrl: z.string().min(1),
  fileKey: z.string(),
  docVersion: z.string(),
  signedAt: z.string(),
});

/**
 * Form schema used across the entire new-customer wizard. All fields are
 * present from Step 1 onwards (rhf needs one form instance for all steps);
 * per-step validation is enforced at "Next" time via `form.trigger([...])`.
 */
export const wizardSchema = z
  .object({
    firstName: z.string().min(1, "Required"),
    lastName: z.string().min(1, "Required"),
    email: z.string().email("Must be a valid email"),
    phone: z.string().optional(),
    dateOfBirth: z.string().optional(),

    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    suburb: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().optional(),

    isInternational: z.boolean(),

    licenceNumber: z.string().optional(),
    licenceState: z.string().optional(),
    licenceClass: z.string().optional(),
    licenceExpiry: z.string().optional(),
    licenceImageFront: z.string().optional().or(z.literal("")),
    licenceImageBack: z.string().optional().or(z.literal("")),

    passportNumber: z.string().optional(),
    passportCountry: z.string().optional(),
    passportExpiry: z.string().optional(),
    passportImage: z.string().optional().or(z.literal("")),

    emergencyContactName: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    emergencyContactRelationship: z.string().optional(),

    marketingEmailOptIn: z.boolean(),
    marketingSmsOptIn: z.boolean(),

    staffNote: z.string().optional(),
    documents: z.array(otherDocumentSchema),

    // Signature captured during consent flow — PNG data-URL (first sign)
    // and server-returned storage key + URL for reuse.
    signatureDataUrl: z.string().optional(),
    signatureKey: z.string().optional(),
    signatureUrl: z.string().optional(),

    // Customer photo URL after upload.
    customerPhotoUrl: z.string().optional().or(z.literal("")),

    // Signed consent PDFs. One per CONSENT_DOC_KEYS entry.
    signedConsents: z.array(signedConsentSchema),
  })
  .refine(
    (v) => {
      if (v.isInternational) return Boolean(v.passportImage || v.passportNumber);
      return true;
    },
    {
      path: ["passportImage"],
      message: "Passport is required for international customers",
    },
  );

export type WizardFormValues = z.infer<typeof wizardSchema>;

export const DEFAULTS: WizardFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  country: "Australia",
  isInternational: false,
  licenceNumber: "",
  licenceState: "QLD",
  licenceClass: "",
  licenceExpiry: "",
  licenceImageFront: "",
  licenceImageBack: "",
  passportNumber: "",
  passportCountry: "",
  passportExpiry: "",
  passportImage: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  marketingEmailOptIn: false,
  marketingSmsOptIn: false,
  staffNote: "",
  documents: [],
  signatureDataUrl: undefined,
  signatureKey: undefined,
  signatureUrl: undefined,
  customerPhotoUrl: "",
  signedConsents: [],
};

export type WizardStepKey =
  | "identity"
  | "details"
  | "consent"
  | "finalise"
  | "review";

export const WIZARD_STEPS: { key: WizardStepKey; label: string; hint?: string }[] = [
  { key: "identity", label: "Identity", hint: "Drop passport or licence" },
  { key: "details", label: "Details", hint: "Review & fill gaps" },
  { key: "consent", label: "Consent", hint: "Hand tablet to customer" },
  { key: "finalise", label: "Finalise", hint: "Photo & extras" },
  { key: "review", label: "Review", hint: "Confirm & create" },
];
