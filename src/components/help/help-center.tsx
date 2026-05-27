"use client";

import Link from "next/link";
import { Rocket } from "lucide-react";
import { HELP_ARTICLES, featuredArticles } from "@/lib/help/manifest";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { Badge } from "@/components/ui/badge";

/**
 * Index content column. Deliberately minimal: a short intro plus the role-based
 * getting-started cards. Everything else is reachable from the sidebar menu, so
 * the landing stays uncluttered.
 */
export function HelpCenter({ basePath }: { basePath: string }) {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Help centre"
        title="Help & guides"
        description={`Learn how to run the back office. Start with the guide for your role below, or pick any of the ${HELP_ARTICLES.length} topics from the menu.`}
        help={false}
      />

      <PageSection title="Getting started" description="Pick the guide for your role." flush>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {featuredArticles().map((a) => (
            <Link
              key={a.slug}
              href={`${basePath}/${a.slug}`}
              className="group flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" aria-hidden />
                <Badge variant="secondary">{a.audience}</Badge>
              </div>
              <h3 className="text-base font-semibold text-foreground">{a.title}</h3>
              <p className="text-caption text-muted-foreground">{a.summary}</p>
            </Link>
          ))}
        </div>
      </PageSection>
    </div>
  );
}
