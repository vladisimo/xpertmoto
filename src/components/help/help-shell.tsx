import * as React from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { HELP_ARTICLES } from "@/lib/help/manifest";
import { HelpNav } from "./help-nav";

/**
 * Two-column docs layout for the help centre: a sticky left sidebar listing
 * every guide by category, and the content column on the right. The sidebar
 * collapses into a disclosure on mobile so article content leads.
 */
export function HelpShell({
  basePath,
  children,
}: {
  basePath: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-6 lg:p-8">
      <div className="lg:grid lg:grid-cols-[26rem_minmax(0,1fr)] lg:gap-10">
        {/* Desktop: sticky sidebar on the left */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] space-y-4 overflow-y-auto pb-8">
            <Link
              href={basePath}
              className="flex items-center gap-2 px-2 text-sm font-semibold text-foreground"
            >
              <BookOpen className="h-4 w-4 text-primary" aria-hidden />
              Help &amp; guides
            </Link>
            <HelpNav basePath={basePath} />
          </div>
        </aside>

        {/* Mobile: collapsible "all guides" disclosure above the content */}
        <details className="mb-5 rounded-lg border bg-card p-4 lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <BookOpen className="h-4 w-4 text-primary" aria-hidden />
            Browse all guides
            <span className="ml-auto text-caption font-normal text-muted-foreground">
              {HELP_ARTICLES.length}
            </span>
          </summary>
          <div className="mt-4">
            <HelpNav basePath={basePath} />
          </div>
        </details>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
