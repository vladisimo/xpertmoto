/**
 * Single source of truth for colours used across every Scootering email
 * template. Email clients don't understand CSS custom properties reliably,
 * so we inline hex values — but we inline them once, here. Template files
 * must not hardcode hex values; import from this module instead.
 *
 * Keep these in lockstep with the semantic tokens in src/app/globals.css
 * so customer-facing colours stay consistent across the product and the
 * inbox.
 */
export const EMAIL_COLORS = {
  // Core brand — matches tailwind `primary` and `secondary` tokens.
  primary: "#1B6B4A",
  secondary: "#F59E0B",

  // Neutral surfaces.
  background: "#FAFAF9",
  surface: "#ffffff",
  border: "#e5e5e5",

  // Text.
  textPrimary: "#1a1a1a",
  textMuted: "#666666",
  textSubtle: "#888888",

  // Feedback tones.
  successSurface: "#F0FDF4",
  successBorder: "#86EFAC",
  successText: "#064E3B",

  warningSurface: "#FFFBEB",
  warningBorder: "#FCD34D",
  warningText: "#78350F",
  warningAccentText: "#92400E",

  errorSurface: "#FEF2F2",
  errorText: "#DC2626",
} as const;

export type EmailColor = (typeof EMAIL_COLORS)[keyof typeof EMAIL_COLORS];
