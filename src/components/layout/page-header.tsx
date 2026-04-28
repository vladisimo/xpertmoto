import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  title: string;
  description?: React.ReactNode;
  /** Ordered list from root → current. Current page is the last item and
   *  should usually have no href. */
  breadcrumbs?: Breadcrumb[];
  /** Right-aligned action slot — typically buttons. */
  actions?: React.ReactNode;
  /** Optional small label above the title (e.g. "Customer"). */
  eyebrow?: string;
}

/**
 * Standard page header. Use at the top of every authenticated page.
 * Enforces consistent H1 sizing, spacing, and breadcrumb pattern.
 */
export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, description, breadcrumbs, actions, eyebrow, className, ...props }, ref) => {
    return (
      <header ref={ref} className={cn("space-y-4", className)} {...props}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                    {crumb.href && !isLast ? (
                      <Link
                        href={crumb.href}
                        className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-foreground" : undefined}>
                        {crumb.label}
                      </span>
                    )}
                    {!isLast && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="page-header-lead min-w-0 space-y-1">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1 className="h1">{title}</h1>
            {description && (
              <p className="max-w-2xl text-body text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
              {actions}
            </div>
          )}
        </div>
      </header>
    );
  },
);
PageHeader.displayName = "PageHeader";
