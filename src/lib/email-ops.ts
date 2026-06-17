import { getEmailBrandingVars } from "@/lib/email-branding-vars";
import { escapeText, renderEmailShell } from "@/lib/email-shell";

/**
 * Substitute `{{brandingVar}}` placeholders in a shell-rendered string with
 * resolved branding values, HTML-escaping each value. This is the same
 * double-brace contract `renderTemplate` uses for HTML mode — reimplemented
 * here so the pure string shell + this helper don't have to import the tRPC
 * router (`communication.renderTemplate`) and pull its dependency graph into
 * lib code. The shell only emits `{{name}}` placeholders (no triple-brace),
 * so a single-pass replace is sufficient.
 */
function resolveBranding(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? escapeText(vars[key]!) : match,
  );
}

/**
 * Render a branded HTML email for an internal operational alert (analytics
 * alert, weekly digest, etc.) sent to admins via `sendEmail` directly — i.e.
 * outside the `sendNotification` consent/branding pipeline.
 *
 * The plain `text` is rendered inside a `<pre>` so column-aligned ops content
 * (e.g. the analytics digest's "Metric  Value" rows) keeps its alignment in a
 * proportional-font HTML body, then wrapped in the shared shell so it carries
 * the same logo header + policy footer as every other email. The caller
 * should keep passing the raw `text` to `sendEmail` as the plain-text part.
 */
export async function renderOpsNoticeEmail(args: {
  subject: string;
  text: string;
}): Promise<string> {
  const vars = await getEmailBrandingVars();
  const shell = renderEmailShell({
    preheader: args.subject,
    title: args.subject,
    body: `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;">${escapeText(
      args.text,
    )}</pre>`,
  });
  return resolveBranding(shell, vars);
}
