"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  getCategory,
  articlesByCategory,
  type HelpArticle,
} from "@/lib/help/manifest";
import { navLabelForHref } from "@/lib/help/manifest.search";
import { PageSection } from "@/components/layout/page-section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { HelpMarkdown } from "./help-markdown";

interface HelpArticleViewProps {
  article: HelpArticle;
  /** Branding-substituted markdown body. */
  body: string;
  /** "/staff/help" or "/admin/help". */
  basePath: string;
}

export function HelpArticleView({ article, body, basePath }: HelpArticleViewProps) {
  const category = getCategory(article.category);
  const related = articlesByCategory(article.category).filter((a) => a.slug !== article.slug);

  return (
    <div className="space-y-8">
      {/* Keep the guide title/breadcrumbs in view while reading the body */}
      <div className="sticky top-0 z-10 -mx-3 border-b border-border bg-background/95 px-3 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <PageHeader
          eyebrow={category?.label ?? "Help"}
          title={article.title}
          description={article.summary}
          help={false}
          breadcrumbs={[
            { label: "Help", href: basePath },
            { label: category?.label ?? "Help", href: basePath },
            { label: article.title },
          ]}
          actions={<Badge variant="secondary">{article.audience}</Badge>}
        />
      </div>

      <HelpMarkdown source={body} />

      {article.relatedNav.length > 0 && (
        <PageSection title="Related pages" description="Jump straight to where this happens in the app.">
          <ul className="space-y-2">
            {article.relatedNav.map((href) => {
              // relatedNav hrefs are absolute app routes; render them as-is.
              const label = navLabelForHref(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {label}
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </PageSection>
      )}

      {related.length > 0 && (
        <PageSection title={`More in ${category?.label ?? "this section"}`} flush>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((a) => (
              <Link
                key={a.slug}
                href={`${basePath}/${a.slug}`}
                className="flex flex-col gap-1.5 rounded-md border bg-card p-4 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
                <p className="text-caption text-muted-foreground">{a.summary}</p>
              </Link>
            ))}
          </div>
        </PageSection>
      )}
    </div>
  );
}
