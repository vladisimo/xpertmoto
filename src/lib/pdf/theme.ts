import type { Branding } from "@/lib/branding";

/**
 * Token-based design system for every PDF rendered through
 * `@react-pdf/renderer`. Imported wherever a PDF needs a colour, a
 * typographic scale, or a spacing value — never hardcode a hex literal
 * or pixel size in a PDF component.
 *
 * Fonts: we ship with the bundled Helvetica family for now. The hooks
 * below expose `font.display` and `font.body` separately so a future
 * change can introduce branded typefaces (Space Grotesk + Rubik) via
 * `Font.register()` without touching any rendering code.
 */

const NEUTRAL = {
  ink: "#0F172A", // body text
  muted: "#475569", // labels, secondary text
  faint: "#94A3B8", // captions, footer
  divider: "#E2E8F0", // hairlines
  surface: "#F8FAFC", // table header band, side panels
  paper: "#FFFFFF", // page background
  alertBg: "#FFFBEB", // bond callout band
  alertBorder: "#F59E0B", // bond callout edge / MINOR severity (amber)
  warnStrong: "#EA580C", // MODERATE severity (orange) — between amber and red
  errorInk: "#B91C1C", // MAJOR severity (red)
  successInk: "#15803D",
} as const;

// Fixed accent for every PDF (header rule, document-number, table header,
// totals divider). Decoupled from `org.brandColor` so financial / legal
// documents always render with a professional dark accent regardless of
// how an operator customises their web/email branding.
const PDF_ACCENT = "#0F172A";

const SPACING = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  xxxl: 32,
  page: 40, // outer page margin
} as const;

const RADII = {
  sm: 2,
  md: 4,
  lg: 6,
  pill: 999,
} as const;

const FONT = {
  display: "Helvetica-Bold",
  body: "Helvetica",
  bodyBold: "Helvetica-Bold",
  bodyItalic: "Helvetica-Oblique",
} as const;

const SIZE = {
  micro: 7, // legal small print, audit trails
  caption: 8, // labels, footers
  body: 9.5, // default body
  bodyLg: 10.5, // emphasised body, table rows
  h3: 11, // section headings
  h2: 13, // page subheadings
  h1: 16, // page title in header
  doc: 18, // brand wordmark, document type chip
  hero: 22, // primary brand display (cover pages)
} as const;

export interface PdfTheme {
  colors: {
    ink: string;
    muted: string;
    faint: string;
    divider: string;
    surface: string;
    paper: string;
    alertBg: string;
    alertBorder: string;
    warnStrong: string;
    errorInk: string;
    successInk: string;
    /** Operator-configured brand colour, used for accents and rules. */
    brand: string;
    /** Subtle 8% tint of the brand for table headers and callouts. */
    brandTint: string;
  };
  spacing: typeof SPACING;
  radii: typeof RADII;
  font: typeof FONT;
  size: typeof SIZE;
}

/**
 * Compose a theme for PDF rendering. The brand accent is fixed to a
 * professional dark navy and ignores the operator's `brandColor` — see
 * the `PDF_ACCENT` comment above. The `branding` parameter is retained
 * for forward compatibility (logo, legal name, ABN are still read from
 * branding elsewhere in the PDF pipeline).
 */
export function makePdfTheme(_branding: Pick<Branding, "brandColor">): PdfTheme {
  return {
    colors: {
      ...NEUTRAL,
      brand: PDF_ACCENT,
      brandTint: tintFromHex(PDF_ACCENT, 0.08),
    },
    spacing: SPACING,
    radii: RADII,
    font: FONT,
    size: SIZE,
  };
}

/**
 * Produce a soft tint for a hex colour. `react-pdf` does not support
 * CSS `rgba()` alpha consistently across all viewers, so we blend with
 * white at issue time and emit a solid hex.
 */
function tintFromHex(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const blend = (c: number) => Math.round(c * alpha + 255 * (1 - alpha));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(blend(r))}${toHex(blend(g))}${toHex(blend(b))}`;
}
