import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageSectionProps extends React.HTMLAttributes<HTMLElement> {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Renders without a card surface — use inside pages that already provide one. */
  flush?: boolean;
  /** Renders as a native <details>/<summary> that can be toggled open/closed. */
  collapsible?: boolean;
  /** When collapsible, whether the section starts expanded. Defaults to false. */
  defaultOpen?: boolean;
  /** When collapsible, sharing a `name` with sibling <details> elements makes
   *  them behave as an exclusive accordion (native HTML behaviour). */
  name?: string;
}

/**
 * Standard content section inside a page. Provides consistent header,
 * spacing, and (by default) a card surface. Use for each grouped block
 * below the PageHeader.
 */
export const PageSection = React.forwardRef<HTMLElement, PageSectionProps>(
  (
    {
      title,
      description,
      actions,
      flush,
      collapsible,
      defaultOpen,
      name,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const surface = flush
      ? "space-y-4"
      : "rounded-lg border bg-card text-card-foreground shadow-sm p-4 sm:p-6 space-y-4";

    const headerInner = (
      <>
        <div className="min-w-0 space-y-1">
          {title && <h2 className="h3">{title}</h2>}
          {description && (
            <p className="text-caption text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </>
    );

    if (collapsible) {
      return (
        <details
          ref={ref as React.Ref<HTMLDetailsElement>}
          {...(defaultOpen ? { open: true } : {})}
          name={name}
          className={cn("group", surface, className)}
          {...(props as React.HTMLAttributes<HTMLDetailsElement>)}
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 select-none [&::-webkit-details-marker]:hidden">
            {headerInner}
            <ChevronDown
              aria-hidden
              className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          {children}
        </details>
      );
    }

    return (
      <section ref={ref} className={cn(surface, className)} {...props}>
        {(title || description || actions) && (
          <header className="flex flex-wrap items-start justify-between gap-3">
            {headerInner}
          </header>
        )}
        {children}
      </section>
    );
  },
);
PageSection.displayName = "PageSection";

export interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * When true, the shell fills its parent's height with a flex column and
   * hides outer overflow. Intended for index pages whose content must fit
   * the viewport so only a single inner region (e.g. a table body) scrolls.
   * Direct children opt into `flex-1 min-h-0` as needed.
   */
  full?: boolean;
}

/**
 * Standard page shell — wraps a PageHeader + N PageSections with the
 * canonical outer padding and vertical rhythm (`space-y-8` at root).
 * Use in every authenticated page as the top-level wrapper.
 *
 * Mobile note: padding tightens to `p-3` and rhythm to `space-y-5` below
 * the `sm` breakpoint to reclaim viewport on phones; tablet/desktop are
 * unchanged. Branched-render mobile bodies should still use this shell —
 * do not introduce a parallel `MobilePageShell`.
 */
export const PageShell = React.forwardRef<HTMLDivElement, PageShellProps>(
  ({ full, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "mx-auto w-full max-w-screen-2xl p-3 sm:p-6 lg:p-8",
        full
          ? "flex h-full flex-col gap-4 sm:gap-6 overflow-hidden"
          : "space-y-5 sm:space-y-6 lg:space-y-8",
        className,
      )}
      {...props}
    />
  ),
);
PageShell.displayName = "PageShell";
