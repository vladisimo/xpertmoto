"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";

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
  /** Mobile only: render a back chevron at the start of the title row.
   *  - `true` calls `router.back()`
   *  - a string is used as an href via `<Link>` */
  back?: true | string;
  /** Mobile only: collapse the actions slot into a "…" overflow Sheet so
   *  a dense action set doesn't wrap the title row. Use when there are
   *  more than ~2 actions. Desktop renders actions inline as today. */
  mobileActionsOverflow?: boolean;
  /** Mobile only: hide eyebrow / breadcrumbs to save vertical space.
   *  Desktop still shows them. Defaults to `false`. */
  mobileCompact?: boolean;
}

/**
 * Standard page header. Use at the top of every authenticated page.
 * Enforces consistent H1 sizing, spacing, and breadcrumb pattern.
 *
 * Mobile augmentations: `back` adds a leading chevron, `mobileCompact`
 * hides eyebrow/breadcrumbs, `mobileActionsOverflow` moves the actions
 * into a "…" Sheet. All are no-ops on `md+`.
 */
export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  (
    {
      title,
      description,
      breadcrumbs,
      actions,
      eyebrow,
      back,
      mobileActionsOverflow,
      mobileCompact,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <header ref={ref} className={cn("space-y-4", className)} {...props}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className={cn(mobileCompact && "hidden sm:block")}
          >
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
          <div className="page-header-lead flex min-w-0 items-start gap-2 sm:gap-3">
            {back ? <BackButton back={back} /> : null}
            <div className="min-w-0 space-y-1">
              {eyebrow && (
                <p className={cn("eyebrow", mobileCompact && "hidden sm:block")}>
                  {eyebrow}
                </p>
              )}
              <h1 className="h1">{title}</h1>
              {description && (
                <p
                  className={cn(
                    "max-w-2xl text-body text-muted-foreground",
                    mobileCompact && "hidden sm:block",
                  )}
                >
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <PageHeaderActions overflow={mobileActionsOverflow} title={title}>
              {actions}
            </PageHeaderActions>
          )}
        </div>
      </header>
    );
  },
);
PageHeader.displayName = "PageHeader";

function BackButton({ back }: { back: true | string }) {
  const router = useRouter();
  const className =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden";
  if (typeof back === "string") {
    return (
      <Link href={back} aria-label="Back" className={className}>
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => router.back()}
      className={className}
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
    </button>
  );
}

function PageHeaderActions({
  overflow,
  title,
  children,
}: {
  overflow?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const isMobile = useIsMobile();

  if (!overflow) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
        {children}
      </div>
    );
  }

  // Single-subtree render: on mobile, children live inside the Sheet body
  // only (so stateful action children mount once). On desktop, children
  // live inline. useIsMobile() is false on first render to preserve
  // hydration parity — the inline branch is the hydration-safe default.
  if (!isMobile) {
    return (
      <div className="flex w-auto shrink-0 flex-wrap items-center gap-2">
        {children}
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full justify-end">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Page actions"
          onClick={() => setOpen(true)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="flex flex-col gap-2 rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetTitle className="text-base font-semibold">
            {title} actions
          </SheetTitle>
          <div className="flex flex-col gap-2 [&>*]:w-full">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
