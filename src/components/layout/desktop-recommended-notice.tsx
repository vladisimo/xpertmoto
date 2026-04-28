import * as React from "react";
import { Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DesktopRecommendedNoticeProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Headline shown first. Defaults to "Best on a larger screen". */
  title?: string;
  /** One- or two-sentence explanation tailored to the page. */
  description?: React.ReactNode;
}

/**
 * Standard banner shown above the mobile fallback for inherently-wide
 * back-office views (Calendar, analytics dashboards). Set `className` to
 * `md:hidden` at the call site so the desktop view never sees it.
 */
export function DesktopRecommendedNotice({
  title = "Best on a larger screen",
  description,
  className,
  ...props
}: DesktopRecommendedNoticeProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border border-dashed bg-muted/40 p-4 text-card-foreground",
        className,
      )}
      {...props}
    >
      <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-body font-semibold">{title}</p>
        {description ? (
          <p className="text-caption text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
