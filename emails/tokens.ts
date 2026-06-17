/**
 * Single source of truth for the look of every XPERT Moto email — both the
 * React Email templates in `emails/*` (via `_layout.tsx`) AND the string
 * shell in `src/lib/email-shell.ts` (used for baked notification templates,
 * campaigns, and the generic plain-body wrap). Both consume these tokens so
 * every email — transactional, operational, or marketing — renders the same
 * branded design.
 *
 * Email clients don't understand CSS custom properties reliably, so we inline
 * hex values — but we inline them once, here. Template files and the shell
 * must not hardcode hex values; import from this module instead.
 *
 * Keep the brand hues (`primary`/`secondary`) in lockstep with the semantic
 * tokens in src/app/globals.css so customer-facing colours stay consistent
 * across the product and the inbox.
 */
export const EMAIL_COLORS = {
  // Core brand — matches tailwind `primary` and `secondary` tokens.
  primary: "#1B6B4A",
  primaryDark: "#134E37",
  secondary: "#F59E0B",

  // Neutral surfaces. `background` is the page colour behind the card;
  // `surface` is the card itself.
  background: "#F4F4F1",
  surface: "#FFFFFF",
  border: "#E5E5E2",

  // Text.
  textPrimary: "#111111",
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

/**
 * Email-safe font stack shared by the React layout and the string shell, so
 * type renders identically across both rendering paths.
 */
export const EMAIL_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Rubik,Helvetica,Arial,sans-serif";

export type EmailColor = (typeof EMAIL_COLORS)[keyof typeof EMAIL_COLORS];
