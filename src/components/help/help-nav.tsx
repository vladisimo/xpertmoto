"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import {
  HELP_CATEGORIES,
  articlesByCategory,
  type HelpArticle,
} from "@/lib/help/manifest";
import { searchArticles } from "@/lib/help/manifest.search";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The docs-style left navigation: a search box over a grouped list of every
 * article. Used inside both the desktop sticky sidebar and the mobile
 * disclosure. Highlights the article matching the current route.
 */
export function HelpNav({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const [query, setQuery] = React.useState("");
  const trimmed = query.trim();
  const results = trimmed.length >= 2 ? searchArticles(trimmed) : null;

  return (
    <nav aria-label="Help topics" className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guides…"
          aria-label="Search the help centre"
          className="h-9 pl-9"
        />
      </div>

      {results ? (
        <div className="space-y-px">
          {results.length === 0 ? (
            <p className="px-2 py-1 text-caption text-muted-foreground">No matching guides.</p>
          ) : (
            results.map((a) => (
              <NavLink key={a.slug} article={a} basePath={basePath} pathname={pathname} />
            ))
          )}
        </div>
      ) : (
        // Category blocks flow into two balanced columns; `break-inside-avoid`
        // keeps each category (and its nested articles) together in one column.
        <div className="sm:columns-2 sm:gap-x-5">
          {HELP_CATEGORIES.map((category) => {
            const articles = articlesByCategory(category.id);
            if (articles.length === 0) return null;
            return (
              <div key={category.id} className="mb-4 break-inside-avoid">
                <p className="mb-0.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.label}
                </p>
                {/* Indent + guide line so articles read as nested under the category */}
                <div className="ml-3 space-y-px border-l border-border pl-2">
                  {articles.map((a) => (
                    <NavLink key={a.slug} article={a} basePath={basePath} pathname={pathname} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}

function NavLink({
  article,
  basePath,
  pathname,
}: {
  article: HelpArticle;
  basePath: string;
  pathname: string;
}) {
  const href = `${basePath}/${article.slug}`;
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-md px-2 py-1 text-[13px] leading-snug transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {article.title}
    </Link>
  );
}
