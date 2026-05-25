"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Full-page markdown renderer for help articles. Tailwind-typography isn't in
 * this project, so we map react-markdown's elements to semantic classes
 * directly (same approach as the support chat panel, but with a fuller
 * heading hierarchy, GFM tables, and in-app `<Link>` routing for relative
 * back-office hrefs). Semantic tokens only — no hardcoded palette tones.
 */
export function HelpMarkdown({ source }: { source: string }) {
  return (
    <div className="max-w-3xl text-body text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="h2 mb-4 mt-8 first:mt-0">{children}</h1>,
          h2: ({ children }) => (
            <h2 className="h3 mb-3 mt-8 border-b border-border pb-2 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-6 text-base font-semibold text-foreground">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-4 leading-relaxed last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-4 ml-5 list-disc space-y-1.5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-4 ml-5 list-decimal space-y-1.5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => {
            const internal = href?.startsWith("/");
            if (internal) {
              return (
                <Link
                  href={href!}
                  className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            );
          },
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-4 overflow-x-auto rounded-md bg-muted p-3 text-sm last:mb-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-4 border-l-2 border-primary/40 pl-4 italic text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-8 border-border" />,
          img: ({ src, alt }) => {
            const url = typeof src === "string" ? src : "";
            if (!url) return null;
            // Use the alt text as a caption too — keeps screenshots labelled.
            return (
              <figure className="my-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={alt ?? ""}
                  loading="lazy"
                  className="w-full rounded-md border border-border"
                />
                {alt ? (
                  <figcaption className="mt-2 text-caption text-muted-foreground">
                    {alt}
                  </figcaption>
                ) : null}
              </figure>
            );
          },
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-border px-3 py-2 align-top">{children}</td>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
