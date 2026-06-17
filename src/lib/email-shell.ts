import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../../emails/tokens";

/**
 * Produces a mobile-responsive HTML email shell: logo header, optional
 * eyebrow/title, body slot, CTA slot, and footer with policy links.
 *
 * Designed for email-client compatibility — `<table>` layout, inline
 * styles, no flexbox, no CSS variables, no external stylesheets. A small
 * `<style>` block carries `@media (max-width: 600px)` rules so the layout
 * degrades cleanly on phones (where most customers read email).
 *
 * This produces a string with `{{brandingVar}}` placeholders that the
 * `notification-sender` render step resolves before dispatch. Keep the
 * shell itself brand-neutral so a single deployment's branding config
 * drives the appearance.
 *
 * The colours + font come from `emails/tokens.ts`, shared with the React
 * Email templates' `_layout.tsx`, so both rendering paths look identical.
 */
export type ShellOptions = {
  /** Short preview text shown in inbox list. Keep under 100 chars. */
  preheader?: string;
  /** Large heading at the top of the content card. */
  title?: string;
  /** Small eyebrow text above the title (e.g. "Booking confirmed"). */
  eyebrow?: string;
  /** The primary body HTML — paragraphs, summary tables, etc. */
  body: string;
  /** Optional primary CTA rendered as a prominent button under the body. */
  cta?: { label: string; url: string };
  /** Small note under the CTA (e.g. "If the button doesn't work, paste…"). */
  ctaFootnote?: string;
  /**
   * Shown near the footer after the policy links; used for e.g. a
   * per-email opt-out line on MARKETING sends. Raw HTML — authors are
   * trusted, variable values in the content are escaped upstream.
   */
  footerNote?: string;
};

const PRIMARY = EMAIL_COLORS.primary;
const PRIMARY_DARK = EMAIL_COLORS.primaryDark;
const TEXT = EMAIL_COLORS.textPrimary;
const TEXT_MUTED = EMAIL_COLORS.textMuted;
const TEXT_SUBTLE = EMAIL_COLORS.textSubtle;
const BG = EMAIL_COLORS.background;
const SURFACE = EMAIL_COLORS.surface;
const BORDER = EMAIL_COLORS.border;

export function renderEmailShell(opts: ShellOptions): string {
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${PRIMARY};">${opts.eyebrow}</p>`
    : "";
  const title = opts.title
    ? `<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:${TEXT};">${opts.title}</h1>`
    : "";
  const cta = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px 0;">
         <tr><td align="center" bgcolor="${PRIMARY}" style="border-radius:8px;">
           <a href="${opts.cta.url}" target="_blank" rel="noopener"
              style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
             ${opts.cta.label}
           </a>
         </td></tr>
       </table>`
    : "";
  const ctaFootnote = opts.ctaFootnote
    ? `<p style="margin:12px 0 0 0;font-size:13px;line-height:1.5;color:${TEXT_SUBTLE};">${opts.ctaFootnote}</p>`
    : "";
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BG};opacity:0;">${opts.preheader}</div>`
    : "";
  const footerNote = opts.footerNote
    ? `<p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:${TEXT_SUBTLE};">${opts.footerNote}</p>`
    : "";

  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{{siteName}}</title>
  <style>
    /* Reset a handful of email-client quirks so the base layout renders
       predictably on Outlook, Gmail mobile and iOS Mail. */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    a { color: ${PRIMARY}; }
    /* Mobile: phone reads at ~320-420 wide. Drop padding, scale type. */
    @media only screen and (max-width: 600px) {
      .outer { padding: 12px !important; }
      .card { padding: 24px 20px !important; }
      h1 { font-size: 22px !important; }
      .summary td { font-size: 14px !important; }
      .cta a { padding: 14px 20px !important; font-size: 15px !important; }
    }
    @media (prefers-color-scheme: dark) {
      body.email-body { background: #151616 !important; }
      .card { background: #1E1F20 !important; color: #F3F3F2 !important; }
      .card h1, .card p, .card td { color: #F3F3F2 !important; }
      .card .muted { color: #B5B5B3 !important; }
      .card .subtle { color: #8E8E8C !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background:${BG};font-family:${EMAIL_FONT_STACK};color:${TEXT};">
  ${preheader}
  <table role="presentation" class="outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 0 16px 0;">
          <a href="{{appUrl}}" target="_blank" rel="noopener" style="text-decoration:none;">
            <img src="{{logoUrl}}" alt="{{siteName}}" height="36"
                 style="display:block;border:0;height:36px;width:auto;max-width:220px;" />
          </a>
        </td></tr>
        <tr><td class="card" style="background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:32px 28px;">
          ${eyebrow}
          ${title}
          <div style="font-size:15px;line-height:1.55;color:${TEXT};">
            ${opts.body}
          </div>
          <div class="cta" style="text-align:center;">
            ${cta}
          </div>
          ${ctaFootnote}
        </td></tr>
        <tr><td style="padding:24px 4px 8px 4px;font-size:12px;line-height:1.6;color:${TEXT_MUTED};">
          <p style="margin:0 0 8px 0;">
            <a href="{{termsUrl}}" target="_blank" rel="noopener" style="color:${TEXT_MUTED};text-decoration:underline;">Terms of service</a>
            &nbsp;·&nbsp;
            <a href="{{privacyUrl}}" target="_blank" rel="noopener" style="color:${TEXT_MUTED};text-decoration:underline;">Privacy policy</a>
            &nbsp;·&nbsp;
            <a href="{{refundPolicyUrl}}" target="_blank" rel="noopener" style="color:${TEXT_MUTED};text-decoration:underline;">Refund policy</a>
            &nbsp;·&nbsp;
            <a href="{{supportUrl}}" target="_blank" rel="noopener" style="color:${TEXT_MUTED};text-decoration:underline;">Contact us</a>
          </p>
          <p class="muted" style="margin:0 0 2px 0;font-weight:600;color:${TEXT_MUTED};">{{legalName}}</p>
          <p class="subtle" style="margin:0;color:${TEXT_SUBTLE};">
            ABN {{abn}} &middot; {{supportEmail}}
          </p>
          ${footerNote}
          <p class="subtle" style="margin:16px 0 0 0;color:${TEXT_SUBTLE};">&copy; {{currentYear}} {{legalName}}. Ride safe.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Escape a plain-text string for safe interpolation into HTML. Use this
 * before slotting an untrusted/plain body (e.g. a notification `body` that
 * may contain `<`, `&`, or a customer-supplied name) into the shell, since
 * `paragraphs()` does NOT escape. Mirrors the escaping `renderTemplate`
 * applies to `{{double-brace}}` values so both paths are consistent.
 */
export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convenience helper: turn `\n\n` into paragraph separators so existing
 * plain-text bodies can be slotted into the shell without hand-wrapping
 * every paragraph in `<p>`. NOT HTML-escaping — it assumes the source is
 * trusted template author HTML (escape plain bodies with `escapeText()`
 * first). Blank lines between text blocks become `</p><p>` boundaries.
 */
export function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 16px 0;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/**
 * Summary table: a list of label/value rows (e.g. "Pickup: 4 May @ 10am").
 * Renders as a two-column `<table>` — email-safe where flex/grid isn't.
 */
export function summaryTable(
  rows: Array<{ label: string; value: string }>,
): string {
  if (rows.length === 0) return "";
  const lastIdx = rows.length - 1;
  const cells = rows
    .map(({ label, value }, i) => {
      const border = i === lastIdx ? "" : `border-bottom:1px solid ${BORDER};`;
      return `<tr>
           <td style="padding:10px 14px;${border}font-size:13px;color:${TEXT_MUTED};white-space:nowrap;vertical-align:top;">${label}</td>
           <td style="padding:10px 14px;${border}font-size:15px;color:${TEXT};font-weight:600;vertical-align:top;">${value}</td>
         </tr>`;
    })
    .join("");
  return `<table role="presentation" class="summary" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="margin:20px 0;border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;">
    ${cells}
  </table>`;
}

export const SHELL_COLORS = {
  PRIMARY,
  PRIMARY_DARK,
  TEXT,
  TEXT_MUTED,
  TEXT_SUBTLE,
  BG,
  SURFACE,
  BORDER,
};
