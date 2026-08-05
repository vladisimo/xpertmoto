"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { AlertTriangle, Code2, Eye, Type } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Tiptap depends on browser APIs, lazy-load client-side only.
const WysiwygEditor = dynamic(
  () => import("./wysiwyg-editor").then((m) => m.WysiwygEditor),
  { ssr: false, loading: () => <WysiwygSkeleton /> },
);

export type TemplateFormat = "PLAIN_TEXT" | "HTML";
export type HtmlSurface = "VISUAL" | "SOURCE";

export type BodyEditorProps = {
  format: TemplateFormat;
  onFormatChange: (format: TemplateFormat) => void;
  body: string;
  onBodyChange: (body: string) => void;
  /** Rendered subject + body from `templatePreview`. */
  preview?: {
    subject?: string;
    body?: string;
    missingVariables?: readonly string[];
    unusedVariables?: readonly string[];
  };
  /** Shown under the body editor as the "current rendered subject". */
  subject?: string;
  variables?: readonly string[];
  placeholder?: string;
  /**
   * Hide the format toggle when the parent doesn't own format choice
   * (e.g. when sending on a single channel that's not EMAIL).
   */
  allowHtml?: boolean;
  /**
   * Lock the editor into HTML-only mode (no format toggle, body always
   * rendered through the WYSIWYG/Source pair). Used by the "Email HTML
   * override" section of the template editor.
   */
  htmlOnly?: boolean;
  /** Title/label shown above the editor. Defaults to "Body". */
  label?: string;
};

export function BodyEditor({
  format,
  onFormatChange,
  body,
  onBodyChange,
  preview,
  subject,
  variables = [],
  placeholder,
  allowHtml = true,
  htmlOnly = false,
  label = "Body",
}: BodyEditorProps) {
  // When htmlOnly is set, the effective format is always HTML regardless
  // of the `format` prop — the editor surface is locked to the WYSIWYG +
  // Source pair and the plain-text textarea is never rendered.
  const effectiveFormat: TemplateFormat = htmlOnly ? "HTML" : format;
  // Default to Source mode if the existing HTML contains constructs the
  // visual editor can't round-trip cleanly (tables, inline styles). Authors
  // can still switch to Visual, but we don't open a designer-imported email
  // in Visual and silently strip attributes.
  const initialSurface: HtmlSurface = useMemo(
    () => (looksLikeDesignerHtml(body) ? "SOURCE" : "VISUAL"),
    // Only check on mount; subsequent edits shouldn't yank the user between modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [htmlSurface, setHtmlSurface] = useState<HtmlSurface>(initialSurface);

  const renderedBody = preview?.body ?? body;
  const renderedSubject = preview?.subject ?? subject ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {allowHtml && !htmlOnly && (
          <Tabs value={format} onValueChange={(v) => onFormatChange(v as TemplateFormat)}>
            <TabsList className="h-8">
              <TabsTrigger value="PLAIN_TEXT" className="gap-1.5 text-xs">
                <Type className="h-3.5 w-3.5" /> Plain text
              </TabsTrigger>
              <TabsTrigger value="HTML" className="gap-1.5 text-xs">
                <Code2 className="h-3.5 w-3.5" /> HTML
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {effectiveFormat === "HTML" && (
            <Tabs value={htmlSurface} onValueChange={(v) => setHtmlSurface(v as HtmlSurface)}>
              <TabsList>
                <TabsTrigger value="VISUAL">Visual</TabsTrigger>
                <TabsTrigger value="SOURCE">Source</TabsTrigger>
              </TabsList>
              <TabsContent value="VISUAL" className="mt-3">
                <WysiwygEditor
                  value={body}
                  onChange={onBodyChange}
                  placeholder={placeholder}
                  variables={variables}
                />
              </TabsContent>
              <TabsContent value="SOURCE" className="mt-3">
                <textarea
                  className="min-h-80 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  spellCheck={false}
                  wrap="off"
                  value={body}
                  onChange={(e) => onBodyChange(e.target.value)}
                  placeholder="<p>Hi {{firstName}}…</p>"
                />
              </TabsContent>
            </Tabs>
          )}
          {effectiveFormat === "PLAIN_TEXT" && (
            <textarea
              className="min-h-80 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder={placeholder ?? "Hi {{firstName}}, your {{categoryName}} is ready for pickup…"}
            />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
            Preview
          </div>
          {preview && (preview.missingVariables?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <div>
                <div className="font-medium">Missing sample values</div>
                <div className="font-mono">
                  {preview.missingVariables!.map((v) => `{{${v}}}`).join(", ")}
                </div>
              </div>
            </div>
          )}
          <PreviewPane
            format={effectiveFormat}
            subject={renderedSubject}
            body={renderedBody}
            pending={!preview}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewPane({
  format,
  subject,
  body,
  pending,
}: {
  format: TemplateFormat;
  subject: string;
  body: string;
  /**
   * True while the server-side preview (variable substitution) is still in
   * flight. The HTML iframe must not render the raw template in the
   * meantime: literal `{{logoUrl}}` becomes a relative URL inside the
   * srcdoc document, firing a junk request that bounces off the auth
   * middleware and gets ORB-blocked as HTML-into-img.
   */
  pending?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
      {subject && (
        <div>
          <div className="eyebrow text-xs">Subject</div>
          <div className="font-medium">{subject}</div>
        </div>
      )}
      <div>
        <div className="eyebrow text-xs">Body</div>
        {format === "HTML" && pending ? (
          <WysiwygSkeleton />
        ) : format === "HTML" ? (
          <iframe
            title="Email body preview"
            className={cn(
              "mt-1 h-80 w-full rounded-md border border-border bg-white",
            )}
            srcDoc={wrapForPreview(body)}
            // allow-same-origin (without allow-scripts) keeps scripts blocked
            // but gives the srcdoc a real origin — an opaque origin can't load
            // same-host images through our Cross-Origin-Resource-Policy:
            // same-origin response header.
            sandbox="allow-same-origin"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-foreground">
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}

function WysiwygSkeleton() {
  return (
    <div className="min-h-80 animate-pulse rounded-md border border-border bg-muted/30" />
  );
}

/**
 * Returns true if the body contains HTML the visual editor cannot
 * round-trip losslessly — table layouts, inline styles — so we should
 * default to Source mode rather than silently stripping attributes.
 */
function looksLikeDesignerHtml(body: string): boolean {
  if (!body) return false;
  return /<table\b|\sstyle\s*=\s*["']/i.test(body);
}

/**
 * Wrap author HTML in a minimal document so the preview iframe renders a
 * sensible default font/colour. The iframe runs with sandbox="" so any
 * scripts are blocked regardless.
 */
function wrapForPreview(html: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Rubik, sans-serif; color: #111; margin: 16px; }
      img { max-width: 100%; height: auto; }
      a { color: #1B6B4A; }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}
