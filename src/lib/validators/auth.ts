import { z } from "zod";

// All email inputs land in the DB lowercased + trimmed. Postgres text unique
// is case-sensitive, so without this, `Bob@Example.com` and `bob@example.com`
// would be distinct rows and an OAuth sign-in that returns lowercase would
// miss the existing record (or collide on insert). `preprocess` runs before
// `.email()` so surrounding whitespace isn't flagged as invalid.
const emailField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().email("Enter a valid email address"),
);

// Shared strength policy for every path that writes a new password
// (registration, self-set, password reset, change-password). CLAUDE.md §F1:
// 10 chars minimum plus complexity. Login/signin schemas deliberately
// accept any non-empty string so existing users with legacy weak passwords
// still get a bad-credentials response (not a policy-violation leak).
export const strongPasswordField = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .refine((v) => /[a-z]/.test(v), "Include at least one lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Include at least one uppercase letter")
  .refine((v) => /\d/.test(v), "Include at least one digit")
  .refine(
    (v) => /[^A-Za-z0-9]/.test(v),
    "Include at least one special character",
  );

export const registerInputSchema = z.object({
  email: emailField,
  password: strongPasswordField,
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  dateOfBirth: z.coerce.date().optional(),
  // APP-1 / APP-5 consent capture. The version the user accepted is stamped
  // server-side from `@/lib/consent-versions`, so the client can't claim a
  // different version than what was rendered.
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms & Conditions" }),
  }),
  acceptedPrivacy: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Privacy Policy" }),
  }),
  marketingOptIn: z.boolean().default(false),
  marketingSmsOptIn: z.boolean().default(false),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const forgotPasswordInputSchema = z.object({
  email: emailField,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

export const resetPasswordInputSchema = z.object({
  token: z.string().min(10, "Invalid token"),
  password: strongPasswordField,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

/** Used for the /profile/security route where a logged-in user sets
 *  a password for the first time (no currentPassword required). */
export const setPasswordInputSchema = z.object({
  password: strongPasswordField,
});
export type SetPasswordInput = z.infer<typeof setPasswordInputSchema>;
